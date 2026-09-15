import { describe, expect, it } from 'vitest';
import {
  BLOCKED_EMAIL_STATUSES,
  contactTier,
  emailDomain,
  isRoleBasedEmail,
  isSchedulable,
  normalizeEmail,
  selectPrimaryContact,
  type ContactCandidate,
} from '@/lib/contacts/priority';
import {
  DEFAULT_LOCK_SECONDS,
  RETRY_MAX_SECONDS,
  bearsCost,
  decideRetry,
  isLockExpired,
  lockExpiresAt,
  retryDelaySeconds,
} from '@/lib/jobs/retry';
import { EMAIL_VERIFICATION_STATUSES } from '@/types/spec2';

function contact(overrides: Partial<ContactCandidate> = {}): ContactCandidate {
  return {
    id: 'contact-1',
    email: 'maria.silva@empresa.com.br',
    role: null,
    name: 'Maria Silva',
    is_decision_maker: false,
    is_primary: false,
    email_verification_status: 'VALID',
    ...overrides,
  };
}

describe('normalizacao de e-mail (SPEC 2.0 §10)', () => {
  it('normaliza caixa e espacos', () => {
    expect(normalizeEmail('  Maria@Empresa.COM.BR ')).toBe('maria@empresa.com.br');
  });

  it('rejeita o que nao tem forma de e-mail', () => {
    for (const value of [null, undefined, '', 'sem-arroba', 'a@b', 'a b@c.com']) {
      expect(normalizeEmail(value), String(value)).toBeNull();
    }
  });

  it('extrai o dominio', () => {
    expect(emailDomain('Maria@Empresa.com.br')).toBe('empresa.com.br');
    expect(emailDomain('invalido')).toBeNull();
  });

  it('reconhece endereco institucional de area', () => {
    expect(isRoleBasedEmail('contato@empresa.com.br')).toBe(true);
    expect(isRoleBasedEmail('comercial@empresa.com.br')).toBe(true);
    expect(isRoleBasedEmail('maria.silva@empresa.com.br')).toBe(false);
  });
});

describe('agendabilidade (SPEC 2.0 §10.3)', () => {
  it('nenhum estado bloqueado e agendavel', () => {
    for (const status of EMAIL_VERIFICATION_STATUSES) {
      const schedulable = isSchedulable(contact({ email_verification_status: status }));
      expect(schedulable, status).toBe(!BLOCKED_EMAIL_STATUSES.has(status));
    }
  });

  it('endereco no-reply nunca e agendavel', () => {
    expect(isSchedulable(contact({ email: 'no-reply@empresa.com.br' }))).toBe(false);
    expect(isSchedulable(contact({ email: 'naoresponda@empresa.com.br' }))).toBe(false);
  });

  it('contato sem e-mail valido nao e agendavel', () => {
    expect(isSchedulable(contact({ email: null }))).toBe(false);
    expect(isSchedulable(contact({ email: 'quebrado@' }))).toBe(false);
  });
});

describe('prioridade de contato (SPEC 2.0 §10.3)', () => {
  it('a hierarquia da SPEC e respeitada', () => {
    expect(contactTier(contact({ is_decision_maker: true }))).toBe('DECISION_MAKER_VALIDATED');
    expect(contactTier(contact())).toBe('PROFESSIONAL_NAMED');
    expect(contactTier(contact({ name: null, email: 'comercial@empresa.com.br' }))).toBe(
      'ROLE_BASED_RELEVANT',
    );
    expect(contactTier(contact({ name: null, email: 'xyz123@empresa.com.br' }))).toBe(
      'GENERAL_COMPANY',
    );
  });

  it('endereco arriscado cai para revisao, mesmo sendo de decisor', () => {
    for (const status of ['RISKY', 'ACCEPT_ALL', 'UNKNOWN'] as const) {
      expect(
        contactTier(contact({ is_decision_maker: true, email_verification_status: status })),
        status,
      ).toBe('RISKY_NEEDS_REVIEW');
    }
  });

  it('escolhe o decisor validado entre varios contatos', () => {
    const chosen = selectPrimaryContact([
      contact({ id: 'a', email: 'contato@empresa.com.br', name: null }),
      contact({ id: 'b', email: 'joao@empresa.com.br', name: 'Joao', is_decision_maker: true }),
      contact({ id: 'c', email: 'maria@empresa.com.br', name: 'Maria' }),
    ]);
    expect(chosen?.id).toBe('b');
  });

  it('nunca escolhe um contato nao agendavel, mesmo sendo decisor', () => {
    const chosen = selectPrimaryContact([
      contact({
        id: 'bloqueado',
        is_decision_maker: true,
        email_verification_status: 'BOUNCED',
      }),
      contact({ id: 'ok', email: 'contato@empresa.com.br', name: null }),
    ]);
    expect(chosen?.id).toBe('ok');
  });

  it('sem nenhum contato agendavel devolve null — nunca "envia assim mesmo"', () => {
    expect(selectPrimaryContact([])).toBeNull();
    expect(
      selectPrimaryContact([contact({ email_verification_status: 'INVALID' })]),
    ).toBeNull();
  });

  it('empate resolve pela marcacao manual do usuario, de forma estavel', () => {
    const contacts = [
      contact({ id: 'z', email: 'ana@empresa.com.br', name: 'Ana' }),
      contact({ id: 'a', email: 'bia@empresa.com.br', name: 'Bia', is_primary: true }),
    ];
    expect(selectPrimaryContact(contacts)?.id).toBe('a');
    expect(selectPrimaryContact([...contacts].reverse())?.id).toBe('a');
  });
});

describe('retry e lock de jobs (SPEC 2.0 §24.4)', () => {
  it('o backoff e exponencial e limitado', () => {
    expect(retryDelaySeconds(1)).toBe(30);
    expect(retryDelaySeconds(2)).toBe(60);
    expect(retryDelaySeconds(3)).toBe(120);
    expect(retryDelaySeconds(50)).toBe(RETRY_MAX_SECONDS);
  });

  it('falha transitoria reagenda enquanto houver tentativa', () => {
    const decision = decideRetry(1, 3, 'TRANSIENT');
    expect(decision.status).toBe('PENDING');
    expect(decision.delaySeconds).toBe(30);
  });

  it('tentativas esgotadas vao para a dead-letter', () => {
    const decision = decideRetry(3, 3, 'TRANSIENT');
    expect(decision.status).toBe('DEAD_LETTER');
    expect(decision.delaySeconds).toBeNull();
  });

  it('falha permanente nunca e retentada, mesmo com tentativas sobrando', () => {
    const decision = decideRetry(0, 5, 'PERMANENT');
    expect(decision.status).toBe('DEAD_LETTER');
    expect(decision.reason).toContain('permanente');
  });

  it('o lock expira, entao um worker morto libera o job sozinho', () => {
    const now = new Date('2026-09-15T12:00:00Z');
    const expiry = lockExpiresAt(now);
    expect(Date.parse(expiry) - now.getTime()).toBe(DEFAULT_LOCK_SECONDS * 1000);

    expect(isLockExpired(expiry, now)).toBe(false);
    expect(isLockExpired(expiry, new Date('2026-09-15T12:10:00Z'))).toBe(true);
  });

  it('job sem lock ou com lock ilegivel e considerado livre', () => {
    const now = new Date('2026-09-15T12:00:00Z');
    expect(isLockExpired(null, now)).toBe(true);
    expect(isLockExpired('nao e uma data', now)).toBe(true);
  });

  it('os jobs que gastam dinheiro externo estao marcados (SPEC 2.0 §8.5)', () => {
    expect(bearsCost('START_APIFY_RUN')).toBe(true);
    expect(bearsCost('GENERATE_EMAIL')).toBe(true);
    expect(bearsCost('SEND_EMAIL')).toBe(true);
    expect(bearsCost('NORMALIZE_BUSINESS')).toBe(false);
    expect(bearsCost('CONSOLIDATE_COMPANY')).toBe(false);
  });
});
