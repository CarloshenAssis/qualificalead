import type {
  CampaignStatus,
  EmailVerificationStatus,
  MessageStatus,
  PipelineStage,
  SenderAuthStatus,
  TemplateStatus,
} from '@/types/spec2';
import { canSendEmails } from '@/lib/campaigns/state';
import { isEmailStatusSendable } from '@/lib/email/sendability';

/**
 * Portao de envio (SPEC 2.0 §17.3).
 *
 * Esta funcao e a unica autoridade sobre "pode enviar?". Ela e pura e devolve
 * **todos** os motivos de bloqueio, nao apenas o primeiro: quem opera a campanha
 * precisa ver de uma vez o que falta, e nao descobrir um impedimento por vez.
 *
 * A regra mais importante do modulo e negativa: na duvida, nao envia. Nenhum
 * caminho abaixo tem um "senao, deixa passar" implicito.
 */

export type SendEligibilityInput = {
  campaignStatus: CampaignStatus;
  leadStage: PipelineStage | string;
  leadApproved: boolean;

  contactEmail: string | null;
  emailVerificationStatus: EmailVerificationStatus;
  isSuppressed: boolean;

  /** O contato ja respondeu em qualquer ponto da sequencia (SPEC 2.0 §3.4). */
  hasReplied: boolean;
  hasHardBounced: boolean;
  hasUnsubscribed: boolean;

  /** Ja existe mensagem para este mesmo passo (idempotencia, §17.4). */
  alreadySentForStep: boolean;

  /** Horas desde o ultimo envio para este contato. `null` = nunca houve. */
  hoursSinceLastSend: number | null;
  minIntervalHours: number;

  senderIsActive: boolean;
  senderSpf: SenderAuthStatus;
  senderDkim: SenderAuthStatus;
  senderDmarc: SenderAuthStatus;
  senderSentToday: number;
  senderDailyLimit: number;

  campaignSentToday: number;
  campaignDailyLimit: number;

  templateStatus: TemplateStatus;
  /** A mensagem renderizada contem identificacao do remetente e saida simples (§17.6). */
  messageHasIdentityAndOptOut: boolean;

  /** Horario local da empresa esta dentro da janela permitida (§17.5). */
  withinSendingWindow: boolean;
};

export type SendBlocker = { code: string; label: string };

export type SendEligibility = { allowed: boolean; blockers: SendBlocker[] };

/** E-mails que nunca podem ser agendados (SPEC 2.0 §10.3). */
/** Explicit allowlist: a future or malformed stage always fails closed. */
const SENDABLE_STAGES: ReadonlySet<string> = new Set([
  'APPROVED_FOR_EMAIL',
  'EMAIL_SEQUENCE_ACTIVE',
]);

export function checkSendEligibility(input: SendEligibilityInput): SendEligibility {
  const blockers: SendBlocker[] = [];
  const block = (code: string, label: string) => blockers.push({ code, label });

  if (!canSendEmails(input.campaignStatus)) {
    block('CAMPAIGN_NOT_ACTIVE', `Campanha em ${input.campaignStatus} nao envia e-mail.`);
  }

  if (!input.leadApproved) block('LEAD_NOT_APPROVED', 'Lead ainda nao foi aprovado.');

  if (!SENDABLE_STAGES.has(input.leadStage)) {
    block('LEAD_STAGE_BLOCKS', `Lead em ${input.leadStage} nao recebe novos e-mails.`);
  }

  if (!input.contactEmail?.trim()) block('NO_EMAIL', 'Contato sem endereco de e-mail.');

  if (!isEmailStatusSendable(input.emailVerificationStatus)) {
    block('EMAIL_NOT_SENDABLE', `E-mail em estado ${input.emailVerificationStatus}.`);
  }

  // Supressao vence qualquer outra regra (SPEC 2.0 §29.2).
  if (input.isSuppressed) block('SUPPRESSED', 'Endereco, contato ou empresa suprimido.');

  // Interrupcao imediata da automacao (SPEC 2.0 §3.4/§19.2).
  if (input.hasReplied) block('ALREADY_REPLIED', 'O contato ja respondeu.');
  if (input.hasHardBounced) block('HARD_BOUNCED', 'Endereco com bounce permanente.');
  if (input.hasUnsubscribed) block('UNSUBSCRIBED', 'Contato pediu descadastro.');

  if (input.alreadySentForStep) {
    block('DUPLICATE_STEP', 'Ja existe mensagem enviada para este passo da sequencia.');
  }

  if (
    input.hoursSinceLastSend !== null &&
    input.hoursSinceLastSend < input.minIntervalHours
  ) {
    block(
      'MIN_INTERVAL',
      `Intervalo minimo de ${input.minIntervalHours}h nao respeitado.`,
    );
  }

  if (!input.senderIsActive) block('SENDER_INACTIVE', 'Remetente inativo.');

  if (input.senderSpf !== 'PASS' || input.senderDkim !== 'PASS' || input.senderDmarc !== 'PASS') {
    block('SENDER_NOT_AUTHENTICATED', 'Remetente sem SPF, DKIM e DMARC validados.');
  }

  if (input.senderSentToday >= input.senderDailyLimit) {
    block('SENDER_DAILY_LIMIT', 'Limite diario do remetente atingido.');
  }

  if (input.campaignSentToday >= input.campaignDailyLimit) {
    block('CAMPAIGN_DAILY_LIMIT', 'Limite diario da campanha atingido.');
  }

  if (input.templateStatus !== 'APPROVED') {
    block('TEMPLATE_NOT_APPROVED', 'Template nao aprovado.');
  }

  if (!input.messageHasIdentityAndOptOut) {
    block('MISSING_IDENTITY_OR_OPT_OUT', 'Mensagem sem identificacao ou sem saida simples.');
  }

  if (!input.withinSendingWindow) {
    block('OUTSIDE_SENDING_WINDOW', 'Fora da janela de envio permitida.');
  }

  return { allowed: blockers.length === 0, blockers };
}

// --- Idempotencia (SPEC 2.0 §17.4) ------------------------------------------

/**
 * Chave derivada de `campaign_lead_id + sequence_step_id + contact_id`.
 *
 * Deterministica de proposito: um retry recalcula exatamente a mesma chave, e a
 * unique constraint em `outbound_messages` transforma a segunda tentativa num
 * conflito em vez de num segundo e-mail na caixa da pessoa.
 */
export function buildIdempotencyKey(
  campaignLeadId: string,
  sequenceStepId: string,
  contactId: string,
): string {
  return `${campaignLeadId}:${sequenceStepId}:${contactId}`;
}

/** Estados em que a mensagem ja produziu efeito externo e nao pode ser reenviada. */
const CONSUMED_STATUSES: ReadonlySet<MessageStatus> = new Set<MessageStatus>([
  'SENT',
  'DELIVERED',
  'BOUNCED',
  'REPLIED',
]);

/**
 * Um retry so e legitimo quando a tentativa anterior nao chegou a sair. Uma
 * mensagem aceita pelo provedor nunca e reenviada, aconteca o que acontecer com
 * o nosso lado (SPEC 2.0 §17.4/§33.3).
 */
export function canRetry(status: MessageStatus): boolean {
  return !CONSUMED_STATUSES.has(status) && status !== 'CANCELLED';
}

// --- Janela de envio (SPEC 2.0 §17.5) ---------------------------------------

export type SendingWindow = {
  /** 0 = domingo. Padrao: dias uteis. */
  allowedWeekdays: number[];
  startHour: number;
  endHour: number;
};

export const DEFAULT_SENDING_WINDOW: SendingWindow = {
  allowedWeekdays: [1, 2, 3, 4, 5],
  startHour: 9,
  endHour: 18,
};

/**
 * `weekday` e `hour` devem vir no fuso da **empresa**, quando conhecido (§17.5).
 * Converter o horario e responsabilidade de quem chama — aqui so mora a regra.
 */
export function isWithinSendingWindow(
  weekday: number,
  hour: number,
  window: SendingWindow = DEFAULT_SENDING_WINDOW,
): boolean {
  if (!window.allowedWeekdays.includes(weekday)) return false;
  return hour >= window.startHour && hour < window.endHour;
}

/**
 * Jitter deterministico a partir da chave de idempotencia (§17.5): espalha os
 * envios sem depender de `Math.random`, para que um retry caia no mesmo minuto
 * em vez de criar uma rajada nova a cada tentativa.
 */
export function jitterMinutes(idempotencyKey: string, maxMinutes = 45): number {
  if (maxMinutes <= 0) return 0;
  let hash = 0;
  for (let index = 0; index < idempotencyKey.length; index += 1) {
    hash = (hash * 31 + idempotencyKey.charCodeAt(index)) % 100_000;
  }
  return hash % maxMinutes;
}
