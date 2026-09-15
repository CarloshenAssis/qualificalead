import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SENDING_WINDOW,
  buildIdempotencyKey,
  canRetry,
  checkSendEligibility,
  isWithinSendingWindow,
  jitterMinutes,
  type SendEligibilityInput,
} from '@/lib/email/eligibility';
import {
  DEFAULT_SOFT_BOUNCE_LIMIT,
  buildEventKey,
  emailEventEffects,
  mergeMessageStatus,
} from '@/lib/email/events';
import { checkSuppression, suppressionValue } from '@/lib/email/suppression';
import { EMAIL_EVENT_TYPES, MESSAGE_STATUSES } from '@/types/spec2';

/** Cenario em que tudo esta correto — cada teste desliga exatamente uma coisa. */
function eligibleInput(overrides: Partial<SendEligibilityInput> = {}): SendEligibilityInput {
  return {
    campaignStatus: 'ACTIVE',
    leadStage: 'APPROVED_FOR_EMAIL',
    leadApproved: true,
    contactEmail: 'maria@empresa.com.br',
    emailVerificationStatus: 'VALID',
    isSuppressed: false,
    hasReplied: false,
    hasHardBounced: false,
    hasUnsubscribed: false,
    alreadySentForStep: false,
    hoursSinceLastSend: null,
    minIntervalHours: 48,
    senderIsActive: true,
    senderSpf: 'PASS',
    senderDkim: 'PASS',
    senderDmarc: 'PASS',
    senderSentToday: 0,
    senderDailyLimit: 25,
    campaignSentToday: 0,
    campaignDailyLimit: 25,
    templateStatus: 'APPROVED',
    messageHasIdentityAndOptOut: true,
    withinSendingWindow: true,
    ...overrides,
  };
}

describe('portao de envio (SPEC 2.0 §17.3)', () => {
  it('libera o cenario completo', () => {
    const result = checkSendEligibility(eligibleInput());
    expect(result.allowed).toBe(true);
    expect(result.blockers).toEqual([]);
  });

  it('cada condicao da SPEC vira um bloqueio nomeado', () => {
    const cases: Array<[Partial<SendEligibilityInput>, string]> = [
      [{ campaignStatus: 'PAUSED' }, 'CAMPAIGN_NOT_ACTIVE'],
      [{ leadApproved: false }, 'LEAD_NOT_APPROVED'],
      [{ leadStage: 'DO_NOT_CONTACT' }, 'LEAD_STAGE_BLOCKS'],
      [{ contactEmail: null }, 'NO_EMAIL'],
      [{ contactEmail: '   ' }, 'NO_EMAIL'],
      [{ emailVerificationStatus: 'INVALID' }, 'EMAIL_NOT_SENDABLE'],
      [{ isSuppressed: true }, 'SUPPRESSED'],
      [{ hasReplied: true }, 'ALREADY_REPLIED'],
      [{ hasHardBounced: true }, 'HARD_BOUNCED'],
      [{ hasUnsubscribed: true }, 'UNSUBSCRIBED'],
      [{ alreadySentForStep: true }, 'DUPLICATE_STEP'],
      [{ hoursSinceLastSend: 2 }, 'MIN_INTERVAL'],
      [{ senderIsActive: false }, 'SENDER_INACTIVE'],
      [{ senderDkim: 'FAIL' }, 'SENDER_NOT_AUTHENTICATED'],
      [{ senderDmarc: 'UNKNOWN' }, 'SENDER_NOT_AUTHENTICATED'],
      [{ senderSentToday: 25 }, 'SENDER_DAILY_LIMIT'],
      [{ campaignSentToday: 25 }, 'CAMPAIGN_DAILY_LIMIT'],
      [{ templateStatus: 'DRAFT' }, 'TEMPLATE_NOT_APPROVED'],
      [{ messageHasIdentityAndOptOut: false }, 'MISSING_IDENTITY_OR_OPT_OUT'],
      [{ withinSendingWindow: false }, 'OUTSIDE_SENDING_WINDOW'],
    ];

    for (const [override, code] of cases) {
      const result = checkSendEligibility(eligibleInput(override));
      expect(result.allowed, code).toBe(false);
      expect(result.blockers.map((blocker) => blocker.code), code).toContain(code);
    }
  });

  it('reporta todos os impedimentos de uma vez', () => {
    const result = checkSendEligibility(
      eligibleInput({ campaignStatus: 'DRAFT', leadApproved: false, isSuppressed: true }),
    );
    expect(result.blockers.length).toBeGreaterThanOrEqual(3);
  });

  it('nenhum estado de e-mail nao agendavel escapa (SPEC 2.0 §10.3)', () => {
    for (const status of ['INVALID', 'BOUNCED', 'SUPPRESSED', 'DISPOSABLE'] as const) {
      expect(checkSendEligibility(eligibleInput({ emailVerificationStatus: status })).allowed,
        status).toBe(false);
    }
  });

  it('uma resposta ja registrada barra o envio mesmo com todo o resto valido', () => {
    expect(checkSendEligibility(eligibleInput({ hasReplied: true })).allowed).toBe(false);
  });
});

describe('idempotencia (SPEC 2.0 §17.4)', () => {
  it('a chave deriva de lead + passo + contato', () => {
    expect(buildIdempotencyKey('lead-1', 'step-2', 'contact-3')).toBe('lead-1:step-2:contact-3');
  });

  it('a mesma combinacao sempre gera a mesma chave; combinacoes diferentes, chaves diferentes', () => {
    expect(buildIdempotencyKey('a', 'b', 'c')).toBe(buildIdempotencyKey('a', 'b', 'c'));
    expect(buildIdempotencyKey('a', 'b', 'c')).not.toBe(buildIdempotencyKey('a', 'b', 'd'));
    expect(buildIdempotencyKey('a', 'b', 'c')).not.toBe(buildIdempotencyKey('a', 'x', 'c'));
  });

  it('mensagem aceita pelo provedor nunca e reenviada', () => {
    for (const status of MESSAGE_STATUSES) {
      const expected = !['SENT', 'DELIVERED', 'BOUNCED', 'REPLIED', 'CANCELLED'].includes(status);
      expect(canRetry(status), status).toBe(expected);
    }
  });

  it('retry so e permitido para o que nao saiu', () => {
    expect(canRetry('SCHEDULED')).toBe(true);
    expect(canRetry('QUEUED')).toBe(true);
    expect(canRetry('FAILED')).toBe(true);
    expect(canRetry('SENT')).toBe(false);
  });
});

describe('janela de envio e jitter (SPEC 2.0 §17.5)', () => {
  it('dias uteis dentro do horario comercial', () => {
    expect(isWithinSendingWindow(3, 10)).toBe(true);
    expect(isWithinSendingWindow(1, 9)).toBe(true);
    expect(isWithinSendingWindow(5, 17)).toBe(true);
  });

  it('fim de semana e fora do horario sao barrados', () => {
    expect(isWithinSendingWindow(0, 10)).toBe(false);
    expect(isWithinSendingWindow(6, 10)).toBe(false);
    expect(isWithinSendingWindow(3, 8)).toBe(false);
    expect(isWithinSendingWindow(3, 18)).toBe(false);
  });

  it('a janela e configuravel', () => {
    const window = { allowedWeekdays: [6], startHour: 8, endHour: 12 };
    expect(isWithinSendingWindow(6, 9, window)).toBe(true);
    expect(isWithinSendingWindow(3, 9, window)).toBe(false);
    expect(DEFAULT_SENDING_WINDOW.allowedWeekdays).toEqual([1, 2, 3, 4, 5]);
  });

  it('o jitter e deterministico: um retry cai no mesmo minuto', () => {
    const key = 'lead-1:step-2:contact-3';
    expect(jitterMinutes(key)).toBe(jitterMinutes(key));
    expect(jitterMinutes(key)).toBeGreaterThanOrEqual(0);
    expect(jitterMinutes(key)).toBeLessThan(45);
  });

  it('chaves diferentes espalham os envios', () => {
    const values = new Set(
      Array.from({ length: 40 }, (_, index) => jitterMinutes(`lead-${index}:step-1:contact-1`)),
    );
    expect(values.size).toBeGreaterThan(5);
  });
});

describe('eventos de e-mail (SPEC 2.0 §19)', () => {
  it('bounce permanente suprime e cancela a sequencia', () => {
    const effects = emailEventEffects('HARD_BOUNCE');
    expect(effects.messageStatus).toBe('BOUNCED');
    expect(effects.cancelRemainingSteps).toBe(true);
    expect(effects.suppress).toEqual({ scope: 'EMAIL', reason: 'HARD_BOUNCE' });
  });

  it('soft bounce so suprime ao atingir o limite configurado', () => {
    const early = emailEventEffects('SOFT_BOUNCE', {
      softBounceCount: 1,
      softBounceLimit: DEFAULT_SOFT_BOUNCE_LIMIT,
    });
    expect(early.suppress).toBeNull();
    expect(early.cancelRemainingSteps).toBe(false);

    const limit = emailEventEffects('SOFT_BOUNCE', {
      softBounceCount: DEFAULT_SOFT_BOUNCE_LIMIT,
      softBounceLimit: DEFAULT_SOFT_BOUNCE_LIMIT,
    });
    expect(limit.suppress).toEqual({ scope: 'EMAIL', reason: 'REPEATED_SOFT_BOUNCE' });
  });

  it('reclamacao suprime imediatamente e gera alerta', () => {
    const effects = emailEventEffects('COMPLAINT');
    expect(effects.suppress).toEqual({ scope: 'EMAIL', reason: 'COMPLAINT' });
    expect(effects.raiseAlert).toBe(true);
    expect(effects.cancelRemainingSteps).toBe(true);
  });

  it('resposta cancela os proximos passos e cria tarefa humana', () => {
    const effects = emailEventEffects('REPLIED');
    expect(effects.cancelRemainingSteps).toBe(true);
    expect(effects.createTask).toBe(true);
    expect(effects.messageStatus).toBe('REPLIED');
  });

  it('descadastro cancela e suprime', () => {
    const effects = emailEventEffects('UNSUBSCRIBED');
    expect(effects.cancelRemainingSteps).toBe(true);
    expect(effects.suppress).toEqual({ scope: 'EMAIL', reason: 'UNSUBSCRIBE' });
  });

  it('abertura e clique nao mudam estado — a metrica primaria e resposta (§18.5)', () => {
    for (const type of ['OPENED', 'CLICKED'] as const) {
      const effects = emailEventEffects(type);
      expect(effects.messageStatus, type).toBeNull();
      expect(effects.cancelRemainingSteps, type).toBe(false);
      expect(effects.suppress, type).toBeNull();
    }
  });

  it('adiamento temporario nao interrompe nada', () => {
    expect(emailEventEffects('DEFERRED')).toMatchObject({
      messageStatus: null,
      cancelRemainingSteps: false,
      suppress: null,
    });
  });

  it('todo tipo de evento da SPEC tem efeito definido', () => {
    for (const type of EMAIL_EVENT_TYPES) {
      expect(() => emailEventEffects(type), type).not.toThrow();
    }
  });
});

describe('eventos fora de ordem (SPEC 2.0 §19.2)', () => {
  it('um DELIVERED atrasado nao rebaixa uma mensagem ja respondida', () => {
    expect(mergeMessageStatus('REPLIED', 'DELIVERED')).toBe('REPLIED');
  });

  it('o estado avanca normalmente na ordem esperada', () => {
    expect(mergeMessageStatus('SCHEDULED', 'QUEUED')).toBe('QUEUED');
    expect(mergeMessageStatus('QUEUED', 'SENT')).toBe('SENT');
    expect(mergeMessageStatus('SENT', 'DELIVERED')).toBe('DELIVERED');
    expect(mergeMessageStatus('DELIVERED', 'REPLIED')).toBe('REPLIED');
  });

  it('evento sem efeito de estado preserva o estado atual', () => {
    expect(mergeMessageStatus('DELIVERED', null)).toBe('DELIVERED');
  });

  it('aplicar A depois B da o mesmo resultado que B depois A', () => {
    const forward = mergeMessageStatus(mergeMessageStatus('SENT', 'DELIVERED'), 'REPLIED');
    const backward = mergeMessageStatus(mergeMessageStatus('SENT', 'REPLIED'), 'DELIVERED');
    expect(forward).toBe(backward);
  });

  it('a chave do evento deduplica reentrega do webhook', () => {
    const withId = buildEventKey('provider', 'evt-1', 'msg-1', 'DELIVERED', '2026-09-15T12:00:00Z');
    expect(withId).toBe('provider:evt-1');
    expect(
      buildEventKey('provider', 'evt-1', 'msg-1', 'DELIVERED', '2026-09-15T13:00:00Z'),
    ).toBe(withId);

    // Sem id do provedor, a chave e composta — e ainda assim estavel.
    const composed = buildEventKey('provider', null, 'msg-1', 'DELIVERED', '2026-09-15T12:00:00Z');
    expect(composed).toBe(
      buildEventKey('provider', null, 'msg-1', 'DELIVERED', '2026-09-15T12:00:00Z'),
    );
    expect(composed).not.toBe(withId);
  });
});

describe('supressao (SPEC 2.0 §29.2)', () => {
  const entries = [
    { scope: 'EMAIL' as const, value: 'bloqueado@empresa.com', reason: 'HARD_BOUNCE' as const },
    { scope: 'DOMAIN' as const, value: 'concorrente.com.br', reason: 'MANUAL' as const },
    { scope: 'COMPANY' as const, value: 'company-99', reason: 'DO_NOT_CONTACT' as const },
    { scope: 'CONTACT' as const, value: 'contact-42', reason: 'UNSUBSCRIBE' as const },
  ];

  it('bloqueia pelo endereco exato, ignorando caixa e espacos', () => {
    const result = checkSuppression(
      { email: '  BLOQUEADO@Empresa.com ', contactId: null, companyId: null },
      entries,
    );
    expect(result.suppressed).toBe(true);
    expect(result.entry?.reason).toBe('HARD_BOUNCE');
  });

  it('bloqueia o dominio inteiro', () => {
    const result = checkSuppression(
      { email: 'qualquer.um@concorrente.com.br', contactId: null, companyId: null },
      entries,
    );
    expect(result.suppressed).toBe(true);
    expect(result.entry?.scope).toBe('DOMAIN');
  });

  it('bloqueia por contato e por empresa', () => {
    expect(
      checkSuppression({ email: null, contactId: 'contact-42', companyId: null }, entries)
        .suppressed,
    ).toBe(true);
    expect(
      checkSuppression({ email: null, contactId: null, companyId: 'company-99' }, entries)
        .suppressed,
    ).toBe(true);
  });

  it('nao bloqueia quem nao esta na lista', () => {
    const result = checkSuppression(
      { email: 'novo@outraempresa.com', contactId: 'contact-1', companyId: 'company-1' },
      entries,
    );
    expect(result.suppressed).toBe(false);
    expect(result.entry).toBeNull();
  });

  it('lista vazia nunca bloqueia', () => {
    expect(
      checkSuppression({ email: 'a@b.com', contactId: 'c', companyId: 'd' }, []).suppressed,
    ).toBe(false);
  });

  it('normaliza o valor antes de gravar, para bater na consulta', () => {
    expect(suppressionValue('EMAIL', '  Maria@Empresa.COM ')).toBe('maria@empresa.com');
    expect(suppressionValue('DOMAIN', '@Empresa.COM')).toBe('empresa.com');
    expect(suppressionValue('CONTACT', ' contact-1 ')).toBe('contact-1');
  });
});

describe('processamento auditavel e persistente', () => {
  it('evento incompatível é auditado sem efeitos', async () => {
    const { processEmailEvent } = await import('@/lib/email/events');
    expect(processEmailEvent('REPLIED', 'HARD_BOUNCE', 'late', new Set())).toMatchObject({
      status: 'REPLIED', incompatible: true, duplicate: false,
      effects: { suppress: null, cancelRemainingSteps: false, createTask: false }, effectKeys: [],
    });
  });
  it('efeitos têm chaves persistíveis e não são reaplicados', async () => {
    const { processEmailEvent } = await import('@/lib/email/events');
    const first = processEmailEvent('SENT', 'REPLIED', 'reply-1', new Set());
    expect(first.effectKeys).toEqual(['reply-1:STATUS', 'reply-1:CANCEL_SEQUENCE', 'reply-1:TASK']);
    const replayedEffect = processEmailEvent('SENT', 'REPLIED', 'reply-1', new Set(), {
      softBounceCount: 1, softBounceLimit: 3, appliedEffectKeys: new Set(first.effectKeys),
    });
    expect(replayedEffect.effects).toMatchObject({ createTask: false, cancelRemainingSteps: false });
  });
  it('terminais contraditórios não repetem efeitos', async () => {
    const { processEmailEvent } = await import('@/lib/email/events');
    const result = processEmailEvent('DELIVERED', 'UNSUBSCRIBED', 'u1', new Set(), {
      softBounceCount: 1, softBounceLimit: 3, terminalEvents: new Set(['COMPLAINT']),
    });
    expect(result).toMatchObject({ incompatible: true, effectKeys: [], effects: { suppress: null } });
  });
});
