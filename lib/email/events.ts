import type {
  EmailEventType,
  MessageStatus,
  SuppressionReason,
  SuppressionScope,
} from '@/types/spec2';

/**
 * Efeitos dos eventos de e-mail (SPEC 2.0 §19).
 *
 * O provedor entrega eventos fora de ordem e repetidos — um `DELIVERED` pode
 * chegar depois de um `REPLIED`, e o mesmo webhook pode ser reentregue horas
 * depois. Por isso a regra aqui nao e "aplica o evento", e sim "qual e o estado
 * correto **dado tudo que ja se sabe**": o resultado de aplicar A e depois B e o
 * mesmo de aplicar B e depois A (§19.2, ultima linha).
 */

export type EmailEventEffects = {
  /** Novo estado da mensagem. `null` quando o evento nao muda o estado. */
  messageStatus: MessageStatus | null;
  /** Cancelar todos os proximos passos da sequencia deste lead. */
  cancelRemainingSteps: boolean;
  /** Suprimir o endereco. `null` quando nao ha supressao. */
  suppress: { scope: SuppressionScope; reason: SuppressionReason } | null;
  /** Gerar alerta operacional para o usuario (SPEC 2.0 §30.2). */
  raiseAlert: boolean;
  /** Criar tarefa humana. */
  createTask: boolean;
};

function effects(overrides: Partial<EmailEventEffects> = {}): EmailEventEffects {
  return {
    messageStatus: null,
    cancelRemainingSteps: false,
    suppress: null,
    raiseAlert: false,
    createTask: false,
    ...overrides,
  };
}

export type EventContext = {
  /** Quantos soft bounces ja foram registrados para este endereco, incluindo este. */
  softBounceCount: number;
  /** A partir de quantos soft bounces o endereco e suprimido (SPEC 2.0 §19.2). */
  softBounceLimit: number;
  /** Terminal audit events already accepted for this message. */
  terminalEvents?: ReadonlySet<'COMPLAINT' | 'UNSUBSCRIBED'>;
  /** Durable effect keys loaded from email_event_effects. */
  appliedEffectKeys?: ReadonlySet<string>;
};

export const DEFAULT_SOFT_BOUNCE_LIMIT = 3;

export function emailEventEffects(
  type: EmailEventType,
  context: EventContext = { softBounceCount: 1, softBounceLimit: DEFAULT_SOFT_BOUNCE_LIMIT },
): EmailEventEffects {
  switch (type) {
    case 'SCHEDULED':
      return effects({ messageStatus: 'SCHEDULED' });
    case 'QUEUED':
      return effects({ messageStatus: 'QUEUED' });
    case 'SENT':
      return effects({ messageStatus: 'SENT' });
    case 'DELIVERED':
      return effects({ messageStatus: 'DELIVERED' });

    // Adiamento temporario do provedor: nao muda o estado nem interrompe nada.
    case 'DEFERRED':
      return effects();

    case 'SOFT_BOUNCE':
      return context.softBounceCount >= context.softBounceLimit
        ? effects({
            messageStatus: 'BOUNCED',
            cancelRemainingSteps: true,
            suppress: { scope: 'EMAIL', reason: 'REPEATED_SOFT_BOUNCE' },
          })
        : effects();

    case 'HARD_BOUNCE':
      return effects({
        messageStatus: 'BOUNCED',
        cancelRemainingSteps: true,
        suppress: { scope: 'EMAIL', reason: 'HARD_BOUNCE' },
      });

    // Reclamacao e o evento mais grave: suprime na hora e avisa o usuario (§19.2).
    case 'COMPLAINT':
      return effects({
        cancelRemainingSteps: true,
        suppress: { scope: 'EMAIL', reason: 'COMPLAINT' },
        raiseAlert: true,
      });

    /**
     * Abertura e clique nao mudam estado de propósito: a metrica primaria da 2.0 e
     * resposta positiva, nao abertura, que e imprecisa (§18.5). Eles sao guardados
     * como evento e nada mais.
     */
    case 'OPENED':
    case 'CLICKED':
      return effects();

    case 'REPLIED':
      return effects({
        messageStatus: 'REPLIED',
        cancelRemainingSteps: true,
        createTask: true,
      });

    case 'UNSUBSCRIBED':
      return effects({
        cancelRemainingSteps: true,
        suppress: { scope: 'EMAIL', reason: 'UNSUBSCRIBE' },
      });

    case 'CANCELLED':
      return effects({ messageStatus: 'CANCELLED' });

    case 'FAILED':
      return effects({ messageStatus: 'FAILED' });
  }
}

/**
 * Precedencia entre estados de mensagem, usada para processar eventos fora de
 * ordem (§19.2). Um estado so avanca: um `DELIVERED` atrasado que chega depois de
 * um `REPLIED` nao rebaixa a mensagem de volta para "entregue".
 */
const VALID_TRANSITIONS: Record<MessageStatus, ReadonlySet<MessageStatus>> = {
  SCHEDULED: new Set(['QUEUED', 'SENT', 'CANCELLED', 'FAILED']),
  QUEUED: new Set(['SENT', 'CANCELLED', 'FAILED']),
  SENT: new Set(['DELIVERED', 'BOUNCED', 'REPLIED']),
  DELIVERED: new Set(['BOUNCED', 'REPLIED']),
  BOUNCED: new Set(['REPLIED']),
  REPLIED: new Set(),
  CANCELLED: new Set(),
  FAILED: new Set(),
};

export function mergeMessageStatus(
  current: MessageStatus,
  incoming: MessageStatus | null,
): MessageStatus {
  if (!incoming) return current;
  if (incoming === current) return current;
  return VALID_TRANSITIONS[current].has(incoming) ? incoming : current;
}

export type ProcessedEmailEvent = {
  status: MessageStatus;
  effects: EmailEventEffects;
  duplicate: boolean;
  stateChanged: boolean;
  incompatible: boolean;
  /** Keys callers must insert before applying each effect (unique in PostgreSQL). */
  effectKeys: string[];
};

/** Pure orchestration helper: audit every key, but apply side effects exactly once. */
export function processEmailEvent(
  current: MessageStatus,
  type: EmailEventType,
  eventKey: string,
  processedKeys: ReadonlySet<string>,
  context?: EventContext,
): ProcessedEmailEvent {
  if (processedKeys.has(eventKey)) {
    return { status: current, effects: effects(), duplicate: true, stateChanged: false, incompatible: false, effectKeys: [] };
  }
  const eventEffects = emailEventEffects(type, context);
  const status = mergeMessageStatus(current, eventEffects.messageStatus);
  const terminal = type === 'COMPLAINT' || type === 'UNSUBSCRIBED';
  const conflictingTerminal = terminal && context?.terminalEvents?.size && !context.terminalEvents.has(type);
  const incompatible = Boolean(conflictingTerminal || (eventEffects.messageStatus && status === current && eventEffects.messageStatus !== current));
  if (incompatible) return { status: current, effects: effects(), duplicate: false, stateChanged: false, incompatible: true, effectKeys: [] };
  const candidates = [
    status !== current && 'STATUS', eventEffects.cancelRemainingSteps && 'CANCEL_SEQUENCE',
    eventEffects.suppress && 'SUPPRESSION', eventEffects.raiseAlert && 'ALERT',
    eventEffects.createTask && 'TASK',
  ].filter((value): value is string => Boolean(value)).map((kind) => `${eventKey}:${kind}`);
  const effectKeys = candidates.filter((key) => !context?.appliedEffectKeys?.has(key));
  if (effectKeys.length !== candidates.length) {
    return { status: current, effects: effects(), duplicate: false, stateChanged: false, incompatible: false, effectKeys: [] };
  }
  return { status, effects: eventEffects, duplicate: false, stateChanged: status !== current, incompatible: false, effectKeys };
}

/**
 * Deduplicacao de webhook: o mesmo evento reentregue produz a mesma chave, entao
 * o insert conflita em vez de contar duas vezes (SPEC 2.0 §26.5).
 */
export function buildEventKey(
  provider: string,
  providerEventId: string | null,
  messageId: string,
  type: EmailEventType,
  occurredAt: string,
): string {
  return providerEventId
    ? `${provider}:${providerEventId}`
    : `${provider}:${messageId}:${type}:${occurredAt}`;
}
