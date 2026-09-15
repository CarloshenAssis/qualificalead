import { describe, expect, it } from 'vitest';
import {
  CampaignTransitionError,
  assertTransition,
  canSendEmails,
  canTransition,
  checkActivation,
  checkBudget,
  isTerminal,
  type ActivationChecklist,
  type CampaignLimits,
  type CampaignUsage,
} from '@/lib/campaigns/state';
import { CAMPAIGN_STATUSES } from '@/types/spec2';

describe('maquina de estados da campanha (SPEC 2.0 §7.3/§7.4)', () => {
  it('a campanha nasce em DRAFT e so avanca para READY ou CANCELLED', () => {
    expect(canTransition('DRAFT', 'READY')).toBe(true);
    expect(canTransition('DRAFT', 'CANCELLED')).toBe(true);
    expect(canTransition('DRAFT', 'ACTIVE')).toBe(false);
    expect(canTransition('DRAFT', 'DISCOVERING')).toBe(false);
  });

  it('nenhum estado transiciona para si mesmo', () => {
    for (const status of CAMPAIGN_STATUSES) {
      expect(canTransition(status, status), status).toBe(false);
    }
  });

  it('COMPLETED e CANCELLED sao terminais', () => {
    for (const status of CAMPAIGN_STATUSES) {
      if (status === 'COMPLETED' || status === 'CANCELLED') {
        expect(isTerminal(status), status).toBe(true);
        for (const target of CAMPAIGN_STATUSES) {
          expect(canTransition(status, target), `${status} -> ${target}`).toBe(false);
        }
      } else {
        expect(isTerminal(status), status).toBe(false);
      }
    }
  });

  it('uma campanha que falhou pode ser reprocessada pela porta da frente', () => {
    expect(canTransition('FAILED', 'READY')).toBe(true);
    expect(canTransition('FAILED', 'ACTIVE')).toBe(false);
  });

  it('pausar e retomar nao passa por revisao de novo', () => {
    expect(canTransition('ACTIVE', 'PAUSED')).toBe(true);
    expect(canTransition('PAUSED', 'ACTIVE')).toBe(true);
  });

  it('assertTransition lanca com os dois estados na mensagem', () => {
    expect(() => assertTransition('DRAFT', 'ACTIVE')).toThrow(CampaignTransitionError);
    expect(() => assertTransition('DRAFT', 'ACTIVE')).toThrow(/DRAFT -> ACTIVE/);
    expect(() => assertTransition('DRAFT', 'READY')).not.toThrow();
  });
});

describe('autorizacao de envio (SPEC 2.0 §7.4)', () => {
  it('somente ACTIVE envia e-mail', () => {
    for (const status of CAMPAIGN_STATUSES) {
      expect(canSendEmails(status), status).toBe(status === 'ACTIVE');
    }
  });

  it('DRAFT e REVIEW_REQUIRED nunca enviam, mesmo com tudo pronto', () => {
    expect(canSendEmails('DRAFT')).toBe(false);
    expect(canSendEmails('REVIEW_REQUIRED')).toBe(false);
  });
});

describe('ativacao (SPEC 2.0 §7.4)', () => {
  function checklist(overrides: Partial<ActivationChecklist> = {}): ActivationChecklist {
    return {
      hasVerifiedSender: true,
      hasSequence: true,
      hasLimits: true,
      hasUnsubscribePolicy: true,
      hasApprovedLeads: true,
      ...overrides,
    };
  }

  it('ativa quando tudo esta no lugar', () => {
    expect(checkActivation('REVIEW_REQUIRED', checklist())).toEqual({ ok: true });
  });

  it('cada pre-condicao ausente vira um bloqueio nomeado', () => {
    const cases: Array<[keyof ActivationChecklist, string]> = [
      ['hasVerifiedSender', 'NO_VERIFIED_SENDER'],
      ['hasSequence', 'NO_SEQUENCE'],
      ['hasLimits', 'NO_LIMITS'],
      ['hasUnsubscribePolicy', 'NO_UNSUBSCRIBE_POLICY'],
      ['hasApprovedLeads', 'NO_APPROVED_LEADS'],
    ];

    for (const [field, code] of cases) {
      const result = checkActivation('REVIEW_REQUIRED', checklist({ [field]: false }));
      expect(result.ok, code).toBe(false);
      if (!result.ok) expect(result.blockers.map((b) => b.code)).toContain(code);
    }
  });

  it('reporta todos os bloqueios de uma vez, nao um por vez', () => {
    const result = checkActivation(
      'DRAFT',
      checklist({ hasVerifiedSender: false, hasSequence: false }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.blockers.length).toBeGreaterThanOrEqual(3);
  });

  it('um estado que nao permite ACTIVE ja e bloqueio por si so', () => {
    const result = checkActivation('DRAFT', checklist());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.blockers.map((b) => b.code)).toContain('INVALID_STATUS');
  });
});

describe('orcamento e limites (SPEC 2.0 §8.5)', () => {
  const limits: CampaignLimits = {
    max_companies: 100,
    max_website_audits: 50,
    max_ai_analyses: 10,
    max_email_contacts: 30,
    budget_limit_cents: 5000,
  };

  function usage(overrides: Partial<CampaignUsage> = {}): CampaignUsage {
    return {
      companiesDiscovered: 0,
      websiteAudits: 0,
      aiAnalyses: 0,
      emailContacts: 0,
      spentCents: 0,
      ...overrides,
    };
  }

  it('permite enquanto cabe no limite', () => {
    expect(checkBudget(limits, usage(), 'companiesDiscovered', 10).allowed).toBe(true);
  });

  it('barra a operacao que ULTRAPASSARIA o limite, nao a que ja o ultrapassou', () => {
    const atEdge = checkBudget(limits, usage({ companiesDiscovered: 99 }), 'companiesDiscovered', 1);
    expect(atEdge.allowed).toBe(true);

    const over = checkBudget(limits, usage({ companiesDiscovered: 100 }), 'companiesDiscovered', 1);
    expect(over.allowed).toBe(false);
    expect(over.blockedBy).toBe('LIMIT_REACHED');
  });

  it('barra pelo orcamento antes de gastar', () => {
    const result = checkBudget(limits, usage({ spentCents: 4900 }), 'aiAnalyses', 1, 200);
    expect(result.allowed).toBe(false);
    expect(result.blockedBy).toBe('BUDGET_REACHED');
  });

  it('sem teto de orcamento, so os limites de quantidade valem', () => {
    const noBudget = { ...limits, budget_limit_cents: null };
    expect(checkBudget(noBudget, usage({ spentCents: 999_999 }), 'aiAnalyses', 1, 500).allowed).toBe(
      true,
    );
  });

  it('cada tipo de limite e verificado separadamente', () => {
    const result = checkBudget(limits, usage({ aiAnalyses: 10 }), 'aiAnalyses', 1);
    expect(result.allowed).toBe(false);
    expect(result.label).toContain('analises de IA');

    expect(checkBudget(limits, usage({ aiAnalyses: 10 }), 'websiteAudits', 1).allowed).toBe(true);
  });
});
