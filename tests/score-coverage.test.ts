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
        'DIGITAL_PRESENCE_GAP',
        'HIGH_RATING',
        'REVIEW_COUNT',
        'INSTAGRAM_FOUND',
        'INSTAGRAM_HIGH_CONFIDENCE',
        'PHONE_AVAILABLE',
        'BUSINESS_ACTIVE',
      ]),
    );
  });

  it('OSM tem cobertura MEDIUM: sem rating nem reviews (o resto e avaliavel)', () => {
    const coverage = computeSourceCoverage(SOURCE_CAPABILITIES.OPENSTREETMAP);
    expect(coverage.level).toBe('MEDIUM');
    expect(coverage.unavailableSignals.sort()).toEqual(['HIGH_RATING', 'REVIEW_COUNT'].sort());
    expect(coverage.evaluableSignals.sort()).toEqual(
      [
        'NO_WEBSITE',
        'DIGITAL_PRESENCE_GAP',
        'INSTAGRAM_FOUND',
        'INSTAGRAM_HIGH_CONFIDENCE',
        'PHONE_AVAILABLE',
        'BUSINESS_ACTIVE',
      ].sort(),
    );
  });
});

describe('computeOpportunityScore — capacidade plena (SPEC 1.2 §35)', () => {
  it('capacidade explicita do Google reproduz exatamente o resultado sem capacidades informadas', () => {
    const withCapabilities = computeOpportunityScore(fullSignalInput(), SOURCE_CAPABILITIES.GOOGLE_PLACES);
    const withoutCapabilities = computeOpportunityScore(fullSignalInput());

    // 30 (site) + 15 (rating) + 12 (183 avaliacoes) + 10 (insta) + 5 (insta alta confianca)
    // + 5 (telefone) + 5 (ativa). Sem DIGITAL_PRESENCE_GAP: fullSignalInput tem Instagram.
    expect(withCapabilities.score).toBe(82);
    expect(withCapabilities.level).toBe('ALTA');
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
    // Ha Instagram encontrado no fullSignalInput: a lacuna digital nao e ampla o suficiente.
    expect(result.breakdown.some((i) => i.code === 'DIGITAL_PRESENCE_GAP')).toBe(false);
    // OSM consegue informar business_status (convencoes disused:/was: das tags) — o que a
    // fonte de fato consegue observar continua contando normalmente.
    expect(result.breakdown.some((i) => i.code === 'BUSINESS_ACTIVE')).toBe(true);
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
    // NO_WEBSITE + INSTAGRAM x2 + PHONE + BUSINESS_ACTIVE = 55 (MEDIA) — nao ha
    // DIGITAL_PRESENCE_GAP porque ha Instagram encontrado.
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
      fullSignalInput({
        rating: null,
        review_count: null,
        phone: null,
        instagram_url: null,
        address: null,
        business_status: null,
      }),
      SOURCE_CAPABILITIES.OPENSTREETMAP,
    );
    // Sem endereco (DIGITAL_PRESENCE_GAP exige identificabilidade) e sem business_status
    // (BUSINESS_ACTIVE nao inventa "ativa" do silencio): sobra so NO_WEBSITE isolado.
    expect(onlyWebsite.score).toBe(SCORE_WEIGHTS.NO_WEBSITE);
  });

  it('empresa OSM sem site, sem Instagram e com endereco tambem ganha a lacuna digital', () => {
    const result = computeOpportunityScore(
      fullSignalInput({ rating: null, review_count: null, phone: null, instagram_url: null }),
      SOURCE_CAPABILITIES.OPENSTREETMAP,
    );
    // NO_WEBSITE (30) + DIGITAL_PRESENCE_GAP (30) + BUSINESS_ACTIVE (5) = 65.
    expect(result.score).toBe(SCORE_WEIGHTS.NO_WEBSITE + SCORE_WEIGHTS.DIGITAL_PRESENCE_GAP + SCORE_WEIGHTS.BUSINESS_ACTIVE);
    expect(result.breakdown.some((i) => i.code === 'DIGITAL_PRESENCE_GAP')).toBe(true);
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
