import { describe, expect, it } from 'vitest';
import { checkSendEligibility, type SendEligibilityInput } from '@/lib/email/eligibility';
import { isEmailStatusSendable } from '@/lib/email/sendability';
import { PIPELINE_STAGES } from '@/types/spec2';
import { qualifyCompany, type QualificationInput } from '@/lib/qualification/score';
import { hydrateQualificationResult, requireV2 } from '@/lib/qualification/repository';
import { processEmailEvent } from '@/lib/email/events';

const gate = (leadStage: string): SendEligibilityInput => ({ campaignStatus: 'ACTIVE', leadStage,
  leadApproved: true, contactEmail: 'a@b.com', emailVerificationStatus: 'VALID', isSuppressed: false,
  hasReplied: false, hasHardBounced: false, hasUnsubscribed: false, alreadySentForStep: false,
  hoursSinceLastSend: null, minIntervalHours: 24, senderIsActive: true, senderSpf: 'PASS',
  senderDkim: 'PASS', senderDmarc: 'PASS', senderSentToday: 0, senderDailyLimit: 10,
  campaignSentToday: 0, campaignDailyLimit: 10, templateStatus: 'APPROVED',
  messageHasIdentityAndOptOut: true, withinSendingWindow: true });

describe('hardening do envio', () => {
  it.each(PIPELINE_STAGES)('allowlist cobre %s', (stage) => {
    expect(checkSendEligibility(gate(stage)).allowed).toBe(['APPROVED_FOR_EMAIL', 'EMAIL_SEQUENCE_ACTIVE'].includes(stage));
  });
  it('estagio futuro falha fechado', () => expect(checkSendEligibility(gate('FUTURE_STAGE')).allowed).toBe(false));
  it('politica de verificacao e unica e fechada', () => {
    for (const status of ['UNKNOWN','RISKY','INVALID','BOUNCED','SUPPRESSED','DISPOSABLE']) expect(isEmailStatusSendable(status)).toBe(false);
    for (const status of ['VALID','ROLE_BASED','ACCEPT_ALL']) expect(isEmailStatusSendable(status)).toBe(true);
  });
});

const strong: QualificationInput = { userId: 'u1', companyId: 'c1', decisionAt: '2026-09-15T12:00:00Z',
  gaps: [{ gap_type: 'NO_LEAD_CAPTURE', severity: 5, confidence: 1, status: 'CONFIRMED' },
    { gap_type: 'NO_CONVERSION_PAGE', severity: 4, confidence: 1, status: 'CONFIRMED' }],
  contacts: [{ email_verification_status: 'VALID', is_decision_maker: true, hasPhone: true }],
  capacity: { reviewCount: 500, rating: 5, hasOpeningHours: true, hasAddress: true, hasPhone: true,
    hasMultipleServices: true, hasMultipleContacts: true, websiteReachable: true },
  timing: ['NEW_UNIT','NEW_SERVICE','ACTIVE_CAMPAIGN'], dataConfidence: { coverage: 1, freshness: 1, consistency: 1, sourceCount: 2 },
  availableObservations: ['WEBSITE_REACHABLE','HAS_FORM'] };
const evidence = { id: 'e1', user_id: 'u1', company_id: 'c1', type: 'HAS_FORM' as const, value: false,
  status: 'CONFIRMED' as const, observed_at: '2026-09-14T12:00:00Z', expires_at: null,
  source_url: 'https://company.example/' };

describe('evidencia para READY_FOR_EMAIL', () => {
  it.each([
    ['ausente', undefined],
    ['expirada', [{ ...evidence, expires_at: '2026-09-15T11:59:59Z' }]],
    ['outra empresa', [{ ...evidence, company_id: 'c2' }]],
    ['outro tenant', [{ ...evidence, user_id: 'u2' }]],
    ['incompativel', [{ ...evidence, type: 'HAS_FAQ' as const }]],
  ])('%s nao fica pronto', (_label, value) => expect(qualifyCompany({ ...strong, evidence: value }).recommended_action).not.toBe('READY_FOR_EMAIL'));
  it('evidencia valida libera', () => expect(qualifyCompany({ ...strong, evidence: [evidence] }).recommended_action).toBe('READY_FOR_EMAIL'));
  it('NO_WEBSITE exige observacao negativa explicita', () => {
    const result = qualifyCompany({ ...strong, gaps: [{ gap_type: 'NO_WEBSITE', severity: 5, confidence: 1, status: 'CONFIRMED' }],
      evidence: [{ ...evidence, type: 'WEBSITE_REACHABLE', value: null }] });
    expect(result.recommended_action).not.toBe('READY_FOR_EMAIL');
  });
});

describe('versoes e eventos', () => {
  const base = { id:'q', user_id:'u', company_id:'c', campaign_id:null, opportunity_score:80,
    need_score:0, commercial_fit_score:0, capacity_score:0, contactability_score:0, timing_score:0,
    data_confidence:0, primary_gap:null, recommended_offer:null, reasons:[], evidence_ids:[], created_at:'2026-01-01Z' };
  it('hidrata v1 real, v2 e rejeita versao desconhecida', () => {
    const v1 = hydrateQualificationResult({ ...base, score_version:1, opportunity_level:'ALTA', recommended_action:'CONTACT_NOW' });
    expect(v1.score_version).toBe(1); expect(() => requireV2(v1)).toThrow();
    expect(requireV2(hydrateQualificationResult({ ...base, score_version:2, opportunity_level:'HIGH', recommended_action:'REVIEW_FOR_EMAIL' })).score_version).toBe(2);
    expect(() => hydrateQualificationResult({ ...base, score_version:3 })).toThrow();
  });
  it('transicoes nao regridem e duplicatas nao repetem efeitos', () => {
    expect(processEmailEvent('DELIVERED','FAILED','e1',new Set()).status).toBe('DELIVERED');
    expect(processEmailEvent('SENT','HARD_BOUNCE','e1',new Set(['e1']))).toMatchObject({ duplicate:true, status:'SENT', effects:{ suppress:null } });
    expect(processEmailEvent('SENT','REPLIED','e2',new Set())).toMatchObject({ status:'REPLIED', effects:{ createTask:true } });
  });
});
