import { describe, expect, it } from 'vitest';
import { computeOpportunityScore, computeSourceCoverage, type ScoreInput } from '@/lib/scoring/score';
import { SCORE_WEIGHTS } from '@/lib/scoring/config';
import { SOURCE_CAPABILITIES } from '@/lib/prospecting/sources/types';

/**
 * Score relativo a fonte (SPEC 1.2 §34/§35).
 * Reaproveita a mesma composicao usada em tests/scoring.test.ts para provar que o Google
 * (capacidades plenas) chega ao score identico ao da 1.1 — a unica coisa nova e o campo
 * `coverage`, que nunca entra na conta.
 */
function fullSignalInput(overrides: Partial<ScoreInput> = {}): ScoreInput {
  return {
    website_status: 'NO_WEBSITE_DETECTED',
    rating: 4.8,
    review_count: 183,
    phone: '(12) 99999-0000',
    instagram_url: 'https://instagram.com/empresa',
    instagram_confidence: 95,
    instagram_status: 'PENDING',
    business_status: 'OPERATIONAL',
    address: 'Rua A, 100',
    category: 'Restaurante',
    opening_hours: ['segunda: 09:00-18:00'],
    description: 'Restaurante italiano',
    google_maps_url: 'https://maps.google.com/?cid=1',
    ...overrides,
  };
}

describe('computeSourceCoverage', () => {
  it('cobertura plena (Google/LEGACY) e HIGH e nao esconde nenhum sinal', () => {
    const coverage = computeSourceCoverage(SOURCE_CAPABILITIES.GOOGLE_PLACES);
    expect(coverage.level).toBe('HIGH');
    expect(coverage.unavailableSignals).toEqual([]);
    expect(coverage.evaluableSignals).toEqual(
      expect.arrayContaining([
        'NO_WEBSITE',
        'GOOGLE_PROFILE_COMPLETE',
        'HIGH_RATING',
        'REVIEW_COUNT',
        'INSTAGRAM_FOUND',
        'INSTAGRAM_HIGH_CONFIDENCE',
        'PHONE_AVAILABLE',
        'BUSINESS_ACTIVE',
      ]),
    );
  });

  it('OSM tem cobertura MEDIUM: sem rating, reviews e perfil comercial rico', () => {
    const coverage = computeSourceCoverage(SOURCE_CAPABILITIES.OPENSTREETMAP);
    expect(coverage.level).toBe('MEDIUM');
    expect(coverage.unavailableSignals.sort()).toEqual(
      ['GOOGLE_PROFILE_COMPLETE', 'HIGH_RATING', 'REVIEW_COUNT', 'BUSINESS_ACTIVE'].sort(),
    );
    expect(coverage.evaluableSignals.sort()).toEqual(
      ['NO_WEBSITE', 'INSTAGRAM_FOUND', 'INSTAGRAM_HIGH_CONFIDENCE', 'PHONE_AVAILABLE'].sort(),
    );
  });
});

describe('computeOpportunityScore — regressao do Google (SPEC 1.2 §35)', () => {
  it('reproduz exatamente o score da 1.1 quando a fonte tem capacidade plena', () => {
    const withCapabilities = computeOpportunityScore(fullSignalInput(), SOURCE_CAPABILITIES.GOOGLE_PLACES);
    const withoutCapabilities = computeOpportunityScore(fullSignalInput());

    // 30 + 15 + 15 + 12 + 10 + 5 + 5 + 5 — mesma soma do teste de regressao da 1.1.
    expect(withCapabilities.score).toBe(97);
    expect(withCapabilities.level).toBe('EXCELENTE');
    expect(withCapabilities).toEqual(withoutCapabilities);
    expect(withCapabilities.coverage.level).toBe('HIGH');
  });

  it('cobertura HIGH nunca capa o nivel: Google chega a EXCELENTE normalmente', () => {
    const result = computeOpportunityScore(
      fullSignalInput({ review_count: 250 }),
      SOURCE_CAPABILITIES.GOOGLE_PLACES,
    );
    expect(result.level).toBe('EXCELENTE');
  });
});

describe('computeOpportunityScore — sinais nao avaliaveis pela fonte (SPEC 1.2 §34)', () => {
  it('OSM nunca ganha nem perde pontos por rating ou reviews ausentes', () => {
    const result = computeOpportunityScore(
      fullSignalInput({ rating: null, review_count: null }),
      SOURCE_CAPABILITIES.OPENSTREETMAP,
    );

    expect(result.breakdown.some((i) => i.code === 'HIGH_RATING')).toBe(false);
    expect(result.breakdown.some((i) => i.code === 'REVIEW_COUNT')).toBe(false);
    expect(result.breakdown.some((i) => i.code === 'GOOGLE_PROFILE_COMPLETE')).toBe(false);
    expect(result.breakdown.some((i) => i.code === 'BUSINESS_ACTIVE')).toBe(false);
    // O que a fonte consegue observar continua contando normalmente.
    expect(result.breakdown.some((i) => i.code === 'NO_WEBSITE')).toBe(true);
    expect(result.breakdown.some((i) => i.code === 'PHONE_AVAILABLE')).toBe(true);
  });

  it('mesmo que um lead do OSM tivesse rating preenchido (dado nao deveria existir), a fonte nao avalia esse sinal', () => {
    const result = computeOpportunityScore(
      fullSignalInput({ rating: 5, review_count: 999 }),
      SOURCE_CAPABILITIES.OPENSTREETMAP,
    );
    expect(result.breakdown.some((i) => i.code === 'HIGH_RATING')).toBe(false);
    expect(result.breakdown.some((i) => i.code === 'REVIEW_COUNT')).toBe(false);
  });

  it('guarda contra inflacao: cobertura LOW nunca chega a ALTA ou EXCELENTE', () => {
    const lowCapabilities = { rating: false, reviewCount: false, businessProfile: false, phone: false, website: false };
    const result = computeOpportunityScore(
      fullSignalInput({ instagram_status: 'CONFIRMED' }),
      lowCapabilities,
    );
    expect(result.coverage.level).toBe('LOW');
    expect(['BAIXA', 'MEDIA']).toContain(result.level);
  });

  it('guarda contra inflacao: cobertura MEDIUM (OSM) nunca chega a EXCELENTE', () => {
    // Poucos sinais aplicaveis, todos positivos: NO_WEBSITE + PHONE + INSTAGRAM x2.
    const result = computeOpportunityScore(
      fullSignalInput({
        rating: null,
        review_count: null,
        instagram_status: 'CONFIRMED',
      }),
      SOURCE_CAPABILITIES.OPENSTREETMAP,
    );
    expect(result.coverage.level).toBe('MEDIUM');
    expect(result.level).not.toBe('EXCELENTE');
  });

  it('nao altera os pesos: cada sinal aplicavel ainda vale exatamente SCORE_WEIGHTS', () => {
    const onlyWebsite = computeOpportunityScore(
      fullSignalInput({ rating: null, review_count: null, phone: null, instagram_url: null }),
      SOURCE_CAPABILITIES.OPENSTREETMAP,
    );
    expect(onlyWebsite.score).toBe(SCORE_WEIGHTS.NO_WEBSITE);
  });
});

describe('UNKNOWN nunca vira FALSE (SPEC 1.1 §17, reforcado pela 1.2 §34)', () => {
  it('website UNKNOWN nao pontua como ausencia de site, mesmo quando a fonte avalia o sinal', () => {
    const result = computeOpportunityScore(
      fullSignalInput({ website_status: 'UNKNOWN' }),
      SOURCE_CAPABILITIES.OPENSTREETMAP,
    );
    expect(result.breakdown.some((i) => i.code === 'NO_WEBSITE')).toBe(false);
  });

  it('o sinal continua evaluable (o problema e o valor, nao a capacidade da fonte)', () => {
    const coverage = computeSourceCoverage(SOURCE_CAPABILITIES.OPENSTREETMAP);
    expect(coverage.evaluableSignals).toContain('NO_WEBSITE');
  });
});
