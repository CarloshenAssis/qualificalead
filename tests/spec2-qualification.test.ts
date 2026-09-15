import { describe, expect, it } from 'vitest';
import { qualifyCompany, classifyLevel, type QualificationInput } from '@/lib/qualification/score';
import {
  MAX_SINGLE_GAP_SHARE,
  MIN_DATA_CONFIDENCE_FOR_HIGH,
  SCORE_VERSION_V2,
  SUBSCORE_WEIGHTS,
} from '@/lib/qualification/config';
import {
  computeCapacityScore,
  computeContactabilityScore,
  computeDataConfidence,
  computeNeedScore,
  computeTimingScore,
  freshnessFromAgeDays,
} from '@/lib/qualification/subscores';

/** Empresa neutra: nenhum sinal ligado alem do que cada teste pedir. */
function baseInput(overrides: Partial<QualificationInput> = {}): QualificationInput {
  return {
    gaps: [],
    contacts: [],
    capacity: {
      reviewCount: null,
      rating: null,
      hasOpeningHours: null,
      hasAddress: null,
      hasPhone: null,
      hasMultipleServices: null,
      hasMultipleContacts: null,
      websiteReachable: null,
    },
    timing: [],
    dataConfidence: { coverage: 1, freshness: 1, consistency: 1, sourceCount: 2 },
    ...overrides,
  };
}

const validNoWebsiteEvidence = {
  id: 'evidence-1', user_id: 'user-1', company_id: 'company-1',
  type: 'WEBSITE_REACHABLE' as const, value: false, status: 'CONFIRMED' as const,
  observed_at: '2026-09-14T12:00:00Z', expires_at: '2026-10-14T12:00:00Z',
  source_url: 'https://resolver.example/check/1',
};

describe('subscores', () => {
  it('a formula dos pesos soma exatamente 1 (SPEC 2.0 §14.2)', () => {
    const total = Object.values(SUBSCORE_WEIGHTS).reduce((sum, weight) => sum + weight, 0);
    expect(total).toBeCloseTo(1, 10);
  });

  it('WEBSITE_UNKNOWN vale muito menos que NO_WEBSITE (SPEC 2.0 §14.4)', () => {
    const confirmed = computeNeedScore([
      { gap_type: 'NO_WEBSITE', severity: 5, confidence: 1, status: 'DETECTED' },
    ]);
    const unknown = computeNeedScore([
      { gap_type: 'WEBSITE_UNKNOWN', severity: 5, confidence: 1, status: 'DETECTED' },
    ]);

    expect(unknown.score).toBeLessThan(confirmed.score / 2);
  });

  it('gap nao estabelecido nao pontua', () => {
    for (const status of ['NEEDS_REVIEW', 'REJECTED', 'RESOLVED', 'EXPIRED'] as const) {
      const result = computeNeedScore([
        { gap_type: 'NO_WEBSITE', severity: 5, confidence: 1, status },
      ]);
      expect(result.score, status).toBe(0);
      expect(result.primaryGap, status).toBeNull();
    }
  });

  it('severidade e confianca escalam a contribuicao do gap', () => {
    const full = computeNeedScore([
      { gap_type: 'NO_LEAD_CAPTURE', severity: 5, confidence: 1, status: 'DETECTED' },
    ]);
    const half = computeNeedScore([
      { gap_type: 'NO_LEAD_CAPTURE', severity: 5, confidence: 0.5, status: 'DETECTED' },
    ]);

    expect(half.score).toBeCloseTo(full.score / 2, 0);
  });

  it('o gap primario e o de maior contribuicao, nao o primeiro da lista', () => {
    const result = computeNeedScore([
      { gap_type: 'NO_FAQ', severity: 5, confidence: 1, status: 'DETECTED' },
      { gap_type: 'NO_WEBSITE', severity: 5, confidence: 1, status: 'DETECTED' },
    ]);
    expect(result.primaryGap).toBe('NO_WEBSITE');
  });

  it('sinal que a fonte nao observa nao conta a favor nem contra (capacity)', () => {
    // So o telefone e observavel, e ele existe: nota cheia, sem punir o resto.
    const onlyPhone = computeCapacityScore({
      reviewCount: null,
      rating: null,
      hasOpeningHours: null,
      hasAddress: null,
      hasPhone: true,
      hasMultipleServices: null,
      hasMultipleContacts: null,
      websiteReachable: null,
    });
    expect(onlyPhone).toBe(100);

    // Mesmo conjunto observavel, mas o sinal e negativo: zero.
    const phoneAbsent = computeCapacityScore({
      reviewCount: null,
      rating: null,
      hasOpeningHours: null,
      hasAddress: null,
      hasPhone: false,
      hasMultipleServices: null,
      hasMultipleContacts: null,
      websiteReachable: null,
    });
    expect(phoneAbsent).toBe(0);
  });

  it('capacity sem nenhum sinal observavel e 0, nao uma divisao por zero', () => {
    const score = computeCapacityScore({
      reviewCount: null,
      rating: null,
      hasOpeningHours: null,
      hasAddress: null,
      hasPhone: null,
      hasMultipleServices: null,
      hasMultipleContacts: null,
      websiteReachable: null,
    });
    expect(score).toBe(0);
  });

  it('e-mail nao agendavel nao contribui para contatabilidade', () => {
    for (const status of ['INVALID', 'BOUNCED', 'SUPPRESSED', 'DISPOSABLE'] as const) {
      const score = computeContactabilityScore([
        { email_verification_status: status, is_decision_maker: true, hasPhone: false },
      ]);
      expect(score, status).toBe(0);
    }
  });

  it('decisor com e-mail valido vale mais que um contato qualquer', () => {
    const decisionMaker = computeContactabilityScore([
      { email_verification_status: 'VALID', is_decision_maker: true, hasPhone: false },
    ]);
    const generic = computeContactabilityScore([
      { email_verification_status: 'VALID', is_decision_maker: false, hasPhone: false },
    ]);
    expect(decisionMaker).toBeGreaterThan(generic);
  });

  it('timing sem gatilho e 0 e gatilhos repetidos nao somam duas vezes', () => {
    expect(computeTimingScore([])).toBe(0);
    expect(computeTimingScore(['NEW_UNIT', 'NEW_UNIT'])).toBe(
      computeTimingScore(['NEW_UNIT']),
    );
  });

  it('confianca cresce com cobertura, frescor e numero de fontes', () => {
    const poor = computeDataConfidence({
      coverage: 0.2,
      freshness: 0.2,
      consistency: 0.5,
      sourceCount: 1,
    });
    const rich = computeDataConfidence({
      coverage: 1,
      freshness: 1,
      consistency: 1,
      sourceCount: 2,
    });

    expect(poor).toBeLessThan(rich);
    expect(rich).toBe(100);
  });

  it('sem fonte alguma a confianca nao chega perto do limite de nivel alto', () => {
    const score = computeDataConfidence({
      coverage: 0.5,
      freshness: 0.5,
      consistency: 0.5,
      sourceCount: 0,
    });
    expect(score).toBeLessThan(MIN_DATA_CONFIDENCE_FOR_HIGH);
  });

  it('frescor decai com a idade e zera depois da janela', () => {
    expect(freshnessFromAgeDays(0, 90)).toBe(1);
    expect(freshnessFromAgeDays(45, 90)).toBeCloseTo(0.5, 5);
    expect(freshnessFromAgeDays(200, 90)).toBe(0);
  });
});

describe('qualifyCompany — guardrails (SPEC 2.0 §14.4)', () => {
  it('nenhum gap isolado passa de 40% do score final', () => {
    // Um unico gap maximo e quase nada alem dele: o cenario que o teto existe para conter.
    const result = qualifyCompany(
      baseInput({
        gaps: [{ gap_type: 'NO_WEBSITE', severity: 5, confidence: 1, status: 'DETECTED' }],
        contacts: [
          { email_verification_status: 'VALID', is_decision_maker: false, hasPhone: false },
        ],
      }),
    );

    const gapContribution = result.need_score * SUBSCORE_WEIGHTS.need;
    expect(gapContribution).toBeLessThanOrEqual(
      MAX_SINGLE_GAP_SHARE * result.opportunity_score + 0.5,
    );
    expect(result.reasons.map((reason) => reason.code)).toContain('SINGLE_GAP_SHARE_CAPPED');
  });

  it('o teto nao dispara quando o score vem de varias dimensoes', () => {
    const result = qualifyCompany(
      baseInput({
        gaps: [
          { gap_type: 'NO_LEAD_CAPTURE', severity: 3, confidence: 0.8, status: 'DETECTED' },
        ],
        contacts: [
          { email_verification_status: 'VALID', is_decision_maker: true, hasPhone: true },
          { email_verification_status: 'VALID', is_decision_maker: false, hasPhone: true },
        ],
        capacity: {
          reviewCount: 250,
          rating: 4.8,
          hasOpeningHours: true,
          hasAddress: true,
          hasPhone: true,
          hasMultipleServices: true,
          hasMultipleContacts: true,
          websiteReachable: true,
        },
        timing: ['NEW_UNIT'],
        availableObservations: ['WEBSITE_REACHABLE', 'HAS_FORM'],
      }),
    );

    expect(result.reasons.map((reason) => reason.code)).not.toContain('SINGLE_GAP_SHARE_CAPPED');
  });

  it('confianca de dados baixa limita o nivel a MEDIUM', () => {
    const strongSignals: Partial<QualificationInput> = {
      gaps: [
        { gap_type: 'NO_WEBSITE', severity: 5, confidence: 1, status: 'CONFIRMED' },
        { gap_type: 'NO_LEAD_CAPTURE', severity: 5, confidence: 1, status: 'CONFIRMED' },
      ],
      contacts: [
        { email_verification_status: 'VALID', is_decision_maker: true, hasPhone: true },
        { email_verification_status: 'VALID', is_decision_maker: false, hasPhone: true },
      ],
      capacity: {
        reviewCount: 500,
        rating: 4.9,
        hasOpeningHours: true,
        hasAddress: true,
        hasPhone: true,
        hasMultipleServices: true,
        hasMultipleContacts: true,
        websiteReachable: true,
      },
      timing: ['NEW_UNIT', 'NEW_SERVICE'],
    };

    const confident = qualifyCompany(baseInput(strongSignals));
    const unconfident = qualifyCompany(
      baseInput({
        ...strongSignals,
        dataConfidence: { coverage: 0.1, freshness: 0.1, consistency: 0.2, sourceCount: 0 },
      }),
    );

    // O score bruto nao muda: confianca limita o nivel, nao a nota (SPEC 2.0 §14.1).
    expect(unconfident.data_confidence).toBeLessThan(MIN_DATA_CONFIDENCE_FOR_HIGH);
    expect(unconfident.opportunity_level).toBe('MEDIUM');
    expect(['HIGH', 'EXCELLENT']).toContain(confident.opportunity_level);
  });

  it('sem e-mail agendavel a acao nunca e READY_FOR_EMAIL', () => {
    for (const status of ['INVALID', 'BOUNCED', 'SUPPRESSED', 'DISPOSABLE', 'UNKNOWN'] as const) {
      const result = qualifyCompany(
        baseInput({
          gaps: [{ gap_type: 'NO_WEBSITE', severity: 5, confidence: 1, status: 'CONFIRMED' }],
          contacts: [
            { email_verification_status: status, is_decision_maker: true, hasPhone: true },
          ],
          capacity: {
            reviewCount: 300,
            rating: 5,
            hasOpeningHours: true,
            hasAddress: true,
            hasPhone: true,
            hasMultipleServices: true,
            hasMultipleContacts: true,
            websiteReachable: true,
          },
        }),
      );
      expect(result.recommended_action, status).not.toBe('READY_FOR_EMAIL');
    }
  });

  it('empresa fechada recebe DO_NOT_CONTACT, por melhor que seja o score', () => {
    const result = qualifyCompany(
      baseInput({
        businessClosed: true,
        gaps: [{ gap_type: 'NO_WEBSITE', severity: 5, confidence: 1, status: 'CONFIRMED' }],
        contacts: [
          { email_verification_status: 'VALID', is_decision_maker: true, hasPhone: true },
        ],
      }),
    );

    expect(result.recommended_action).toBe('DO_NOT_CONTACT');
    expect(result.reasons.map((reason) => reason.code)).toContain('BUSINESS_CLOSED');
  });

  it('lead suprimido recebe DO_NOT_CONTACT', () => {
    const result = qualifyCompany(
      baseInput({
        isSuppressed: true,
        gaps: [{ gap_type: 'NO_WEBSITE', severity: 5, confidence: 1, status: 'CONFIRMED' }],
        contacts: [
          { email_verification_status: 'VALID', is_decision_maker: true, hasPhone: true },
        ],
      }),
    );

    expect(result.recommended_action).toBe('DO_NOT_CONTACT');
  });

  it('a supressao vence ate a marcacao manual na ordem de motivos', () => {
    const result = qualifyCompany(baseInput({ doNotContact: true, isSuppressed: true }));
    expect(result.recommended_action).toBe('DO_NOT_CONTACT');
  });

  it('READY_FOR_EMAIL exige gap confirmado por humano (SPEC 2.0 §3.5)', () => {
    const signals: Partial<QualificationInput> = {
      contacts: [{ email_verification_status: 'VALID', is_decision_maker: true, hasPhone: true }],
      capacity: {
        reviewCount: 400,
        rating: 4.9,
        hasOpeningHours: true,
        hasAddress: true,
        hasPhone: true,
        hasMultipleServices: true,
        hasMultipleContacts: true,
        websiteReachable: true,
      },
      timing: ['NEW_UNIT', 'NEW_SERVICE', 'ACTIVE_CAMPAIGN'],
    };

    const detected = qualifyCompany(
      baseInput({
        ...signals,
        gaps: [
          { gap_type: 'NO_WEBSITE', severity: 5, confidence: 1, status: 'DETECTED' },
          { gap_type: 'NO_LEAD_CAPTURE', severity: 4, confidence: 0.9, status: 'DETECTED' },
        ],
      }),
    );
    const confirmed = qualifyCompany(
      baseInput({
        ...signals,
        userId: 'user-1', companyId: 'company-1', decisionAt: '2026-09-15T12:00:00Z',
        evidence: [validNoWebsiteEvidence],
        availableObservations: ['WEBSITE_REACHABLE'],
        gaps: [
          { gap_type: 'NO_WEBSITE', severity: 5, confidence: 1, status: 'CONFIRMED' },
          { gap_type: 'NO_LEAD_CAPTURE', severity: 4, confidence: 0.9, status: 'CONFIRMED' },
        ],
      }),
    );

    expect(detected.recommended_action).toBe('REVIEW_FOR_EMAIL');
    expect(confirmed.recommended_action).toBe('READY_FOR_EMAIL');
  });

  it('score baixo com pouca confianca pede pesquisa, nao descarte', () => {
    const result = qualifyCompany(
      baseInput({
        gaps: [{ gap_type: 'WEBSITE_UNKNOWN', severity: 1, confidence: 0.4, status: 'DETECTED' }],
        contacts: [
          { email_verification_status: 'VALID', is_decision_maker: false, hasPhone: false },
        ],
        dataConfidence: { coverage: 0.1, freshness: 0.1, consistency: 0.1, sourceCount: 0 },
      }),
    );

    expect(result.recommended_action).toBe('RESEARCH_MORE');
  });

  it('toda saida carrega a versao do score (SPEC 2.0 §14.6)', () => {
    expect(qualifyCompany(baseInput()).score_version).toBe(SCORE_VERSION_V2);
    expect(SCORE_VERSION_V2).toBe(2);
  });

  it('a oferta recomendada deriva do gap primario', () => {
    const result = qualifyCompany(
      baseInput({
        gaps: [
          { gap_type: 'WEAK_SOCIAL_DESTINATION', severity: 4, confidence: 1, status: 'DETECTED' },
        ],
      }),
    );
    expect(result.primary_gap).toBe('WEAK_SOCIAL_DESTINATION');
    expect(result.recommended_offer).toBe('BIO_PAGE');
  });

  it('sem evidencia minima nao ha oferta recomendada, e o motivo e dito', () => {
    // NO_LEAD_CAPTURE resolve-se com QUALIFICATION_FORM, que exige site alcancavel.
    const result = qualifyCompany(
      baseInput({
        gaps: [{ gap_type: 'NO_LEAD_CAPTURE', severity: 4, confidence: 1, status: 'DETECTED' }],
        availableObservations: [],
      }),
    );

    expect(result.recommended_offer).toBeNull();
    expect(result.commercial_fit_score).toBe(0);
    expect(result.reasons.map((reason) => reason.code)).toContain('NO_OFFER');
  });

  it('empresa sem sinal algum pontua 0 e nao inventa gap', () => {
    const result = qualifyCompany(baseInput());
    expect(result.opportunity_score).toBe(0);
    expect(result.opportunity_level).toBe('LOW');
    expect(result.primary_gap).toBeNull();
    expect(result.reasons.map((reason) => reason.code)).toContain('NO_GAP');
  });

  it('as faixas de nivel seguem a SPEC 2.0 §14.3', () => {
    expect(classifyLevel(85)).toBe('EXCELLENT');
    expect(classifyLevel(84)).toBe('HIGH');
    expect(classifyLevel(70)).toBe('HIGH');
    expect(classifyLevel(69)).toBe('MEDIUM');
    expect(classifyLevel(50)).toBe('MEDIUM');
    expect(classifyLevel(49)).toBe('LOW');
    expect(classifyLevel(0)).toBe('LOW');
  });

  it('o score nunca escapa de 0..100', () => {
    const result = qualifyCompany(
      baseInput({
        gaps: [
          { gap_type: 'NO_WEBSITE', severity: 5, confidence: 1, status: 'CONFIRMED' },
          { gap_type: 'WEAK_WEBSITE', severity: 5, confidence: 1, status: 'CONFIRMED' },
          { gap_type: 'NO_CONVERSION_PAGE', severity: 5, confidence: 1, status: 'CONFIRMED' },
          { gap_type: 'NO_LEAD_CAPTURE', severity: 5, confidence: 1, status: 'CONFIRMED' },
        ],
        contacts: [
          { email_verification_status: 'VALID', is_decision_maker: true, hasPhone: true },
          { email_verification_status: 'VALID', is_decision_maker: true, hasPhone: true },
        ],
        capacity: {
          reviewCount: 9999,
          rating: 5,
          hasOpeningHours: true,
          hasAddress: true,
          hasPhone: true,
          hasMultipleServices: true,
          hasMultipleContacts: true,
          websiteReachable: true,
        },
        timing: ['NEW_UNIT', 'NEW_SERVICE', 'ACTIVE_CAMPAIGN', 'HIRING', 'RECENT_PUBLIC_CHANGE'],
      }),
    );

    expect(result.opportunity_score).toBeGreaterThanOrEqual(0);
    expect(result.opportunity_score).toBeLessThanOrEqual(100);
    for (const value of [
      result.need_score,
      result.commercial_fit_score,
      result.capacity_score,
      result.contactability_score,
      result.timing_score,
      result.data_confidence,
    ]) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
    }
  });

  it('e deterministica: a mesma entrada produz exatamente a mesma saida', () => {
    const input = baseInput({
      gaps: [{ gap_type: 'NO_CONVERSION_PAGE', severity: 4, confidence: 0.9, status: 'DETECTED' }],
      contacts: [{ email_verification_status: 'VALID', is_decision_maker: true, hasPhone: true }],
      availableObservations: ['WEBSITE_REACHABLE', 'HAS_CTA'],
    });

    expect(qualifyCompany(input)).toEqual(qualifyCompany(input));
  });
});
