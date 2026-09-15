import type { CampaignStatus } from '@/types/spec2';

/**
 * Maquina de estados da campanha (SPEC 2.0 §7.3/§7.4).
 *
 * A campanha e a unica coisa que autoriza envio. Por isso o estado nao e um
 * rotulo de interface: e a barreira que impede um rascunho de virar disparo. As
 * transicoes vivem aqui, num modulo puro, para que a regra seja testavel sem
 * banco e impossivel de contornar por engano em uma rota de API.
 */

const TRANSITIONS: Record<CampaignStatus, CampaignStatus[]> = {
  DRAFT: ['READY', 'CANCELLED'],
  // Volta para DRAFT e permitida: o usuario pode reabrir a configuracao antes de comecar.
  READY: ['DISCOVERING', 'DRAFT', 'CANCELLED'],
  DISCOVERING: ['ENRICHING', 'PAUSED', 'CANCELLED', 'FAILED'],
  ENRICHING: ['SCORING', 'PAUSED', 'CANCELLED', 'FAILED'],
  SCORING: ['REVIEW_REQUIRED', 'PAUSED', 'CANCELLED', 'FAILED'],
  REVIEW_REQUIRED: ['ACTIVE', 'PAUSED', 'CANCELLED'],
  ACTIVE: ['PAUSED', 'COMPLETED', 'CANCELLED', 'FAILED'],
  PAUSED: ['ACTIVE', 'COMPLETED', 'CANCELLED'],
  // Terminais: nao apagam historico, apenas param de produzir efeito (SPEC 2.0 §7.4).
  COMPLETED: [],
  CANCELLED: [],
  // Uma falha pode ser reprocessada, mas so voltando pela porta da frente (READY).
  FAILED: ['READY', 'CANCELLED'],
};

export const TERMINAL_CAMPAIGN_STATUSES: ReadonlySet<CampaignStatus> = new Set<CampaignStatus>([
  'COMPLETED',
  'CANCELLED',
]);

export function canTransition(from: CampaignStatus, to: CampaignStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function allowedTransitions(from: CampaignStatus): CampaignStatus[] {
  return [...TRANSITIONS[from]];
}

export function isTerminal(status: CampaignStatus): boolean {
  return TERMINAL_CAMPAIGN_STATUSES.has(status);
}

export class CampaignTransitionError extends Error {
  constructor(
    readonly from: CampaignStatus,
    readonly to: CampaignStatus,
  ) {
    super(`Transicao invalida de campanha: ${from} -> ${to}.`);
    this.name = 'CampaignTransitionError';
  }
}

export function assertTransition(from: CampaignStatus, to: CampaignStatus): void {
  if (!canTransition(from, to)) throw new CampaignTransitionError(from, to);
}

/**
 * Nenhum e-mail sai de uma campanha que nao esteja `ACTIVE` (SPEC 2.0 §7.4).
 * `REVIEW_REQUIRED` em especial: ela ja tem leads pontuados e mensagens prontas,
 * e e exatamente por isso que precisa ser barrada aqui.
 */
export function canSendEmails(status: CampaignStatus): boolean {
  return status === 'ACTIVE';
}

// --- Ativacao ---------------------------------------------------------------

/** Pre-condicoes de ativacao (SPEC 2.0 §7.4). */
export type ActivationChecklist = {
  hasVerifiedSender: boolean;
  hasSequence: boolean;
  hasLimits: boolean;
  hasUnsubscribePolicy: boolean;
  hasApprovedLeads: boolean;
};

export type ActivationResult =
  | { ok: true }
  | { ok: false; blockers: Array<{ code: string; label: string }> };

export function checkActivation(
  status: CampaignStatus,
  checklist: ActivationChecklist,
): ActivationResult {
  const blockers: Array<{ code: string; label: string }> = [];

  if (!canTransition(status, 'ACTIVE')) {
    blockers.push({
      code: 'INVALID_STATUS',
      label: `Campanha em ${status} nao pode ser ativada.`,
    });
  }

  if (!checklist.hasVerifiedSender) {
    blockers.push({
      code: 'NO_VERIFIED_SENDER',
      label: 'Nenhum remetente com SPF, DKIM e DMARC validos.',
    });
  }
  if (!checklist.hasSequence) {
    blockers.push({ code: 'NO_SEQUENCE', label: 'Campanha sem sequencia definida.' });
  }
  if (!checklist.hasLimits) {
    blockers.push({ code: 'NO_LIMITS', label: 'Limites diario e total nao configurados.' });
  }
  if (!checklist.hasUnsubscribePolicy) {
    blockers.push({
      code: 'NO_UNSUBSCRIBE_POLICY',
      label: 'Politica de descadastro ausente.',
    });
  }
  if (!checklist.hasApprovedLeads) {
    blockers.push({ code: 'NO_APPROVED_LEADS', label: 'Nenhum lead aprovado para contato.' });
  }

  return blockers.length ? { ok: false, blockers } : { ok: true };
}

// --- Orcamento e limites (SPEC 2.0 §8.5) ------------------------------------

export type CampaignUsage = {
  companiesDiscovered: number;
  websiteAudits: number;
  aiAnalyses: number;
  emailContacts: number;
  spentCents: number;
};

export type CampaignLimits = {
  max_companies: number;
  max_website_audits: number;
  max_ai_analyses: number;
  max_email_contacts: number;
  budget_limit_cents: number | null;
};

export type BudgetCheck = {
  allowed: boolean;
  /** Codigo do limite que barrou. `null` quando permitido. */
  blockedBy: string | null;
  label: string | null;
};

/**
 * Barreira de custo verificada **antes** de gastar, nunca depois (SPEC 2.0 §8.5).
 * `cost` e o custo estimado da proxima operacao, em centavos.
 */
export function checkBudget(
  limits: CampaignLimits,
  usage: CampaignUsage,
  operation: keyof Omit<CampaignUsage, 'spentCents'>,
  units = 1,
  estimatedCostCents = 0,
): BudgetCheck {
  const caps: Record<keyof Omit<CampaignUsage, 'spentCents'>, { max: number; label: string }> = {
    companiesDiscovered: { max: limits.max_companies, label: 'empresas' },
    websiteAudits: { max: limits.max_website_audits, label: 'auditorias de site' },
    aiAnalyses: { max: limits.max_ai_analyses, label: 'analises de IA' },
    emailContacts: { max: limits.max_email_contacts, label: 'contatos por e-mail' },
  };

  const cap = caps[operation];
  if (usage[operation] + units > cap.max) {
    return {
      allowed: false,
      blockedBy: 'LIMIT_REACHED',
      label: `Limite de ${cap.label} da campanha atingido (${cap.max}).`,
    };
  }

  if (limits.budget_limit_cents !== null && usage.spentCents + estimatedCostCents > limits.budget_limit_cents) {
    return {
      allowed: false,
      blockedBy: 'BUDGET_REACHED',
      label: 'Orcamento da campanha atingido.',
    };
  }

  return { allowed: true, blockedBy: null, label: null };
}
