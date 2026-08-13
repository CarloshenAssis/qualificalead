import { describe, expect, it } from 'vitest';
import { classifyScore, computeOpportunityScore, type ScoreInput } from '@/lib/scoring/score';
import { MAX_SCORE, SCORE_WEIGHTS } from '@/lib/scoring/config';

/** Empresa minima: nenhum sinal positivo alem do que o teste ligar. */
function baseInput(overrides: Partial<ScoreInput> = {}): ScoreInput {
  return {
    website_status: 'HAS_WEBSITE',
    rating: null,
    review_count: null,
    phone: null,
    instagram_url: null,
    instagram_confidence: null,
    business_status: null,
    address: null,
    category: null,
    opening_hours: null,
    description: null,
    google_maps_url: null,
    ...overrides,
  };
}

describe('computeOpportunityScore', () => {
  it('pontua zero quando nao ha sinal algum', () => {
    const result = computeOpportunityScore(baseInput());
    expect(result.score).toBe(0);
    expect(result.level).toBe('BAIXA');
    expect(result.breakdown).toHaveLength(0);
  });

  it('soma o peso de site nao identificado', () => {
    const result = computeOpportunityScore(baseInput({ website_status: 'NO_WEBSITE_DETECTED' }));
    expect(result.score).toBe(SCORE_WEIGHTS.NO_WEBSITE);
    expect(result.breakdown[0]).toMatchObject({ code: 'NO_WEBSITE', points: 30 });
  });

  it('escalona a pontuacao por quantidade de avaliacoes', () => {
    const points = (reviews: number) =>
      computeOpportunityScore(baseInput({ review_count: reviews })).breakdown.find(
        (item) => item.code === 'REVIEW_COUNT',
      )?.points ?? 0;

    expect(points(4)).toBe(0);
    expect(points(5)).toBe(3);
    expect(points(24)).toBe(3);
    expect(points(25)).toBe(7);
    expect(points(50)).toBe(10);
    expect(points(100)).toBe(12);
    expect(points(1000)).toBe(15);
  });

  it('exige rating 4.5 para o bonus de avaliacao alta', () => {
    expect(
      computeOpportunityScore(baseInput({ rating: 4.4 })).breakdown.some((i) => i.code === 'HIGH_RATING'),
    ).toBe(false);
    expect(
      computeOpportunityScore(baseInput({ rating: 4.5 })).breakdown.some((i) => i.code === 'HIGH_RATING'),
    ).toBe(true);
  });

  it('so da bonus de alta confianca quando o Instagram passa do limite', () => {
    const low = computeOpportunityScore(
      baseInput({ instagram_url: 'https://instagram.com/x', instagram_confidence: 60 }),
    );
    expect(low.breakdown.some((i) => i.code === 'INSTAGRAM_HIGH_CONFIDENCE')).toBe(false);

    const high = computeOpportunityScore(
      baseInput({ instagram_url: 'https://instagram.com/x', instagram_confidence: 85 }),
    );
    expect(high.breakdown.some((i) => i.code === 'INSTAGRAM_HIGH_CONFIDENCE')).toBe(true);
  });

  it('nao considera ativa uma empresa fechada permanentemente', () => {
    const closed = computeOpportunityScore(
      baseInput({ business_status: 'CLOSED_PERMANENTLY', review_count: 100 }),
    );
    expect(closed.breakdown.some((i) => i.code === 'BUSINESS_ACTIVE')).toBe(false);
  });

  it('reproduz a composicao do exemplo da especificacao', () => {
    const result = computeOpportunityScore(
      baseInput({
        website_status: 'NO_WEBSITE_DETECTED',
        rating: 4.8,
        review_count: 183,
        phone: '(12) 99999-0000',
        instagram_url: 'https://instagram.com/empresa',
        instagram_confidence: 95,
        business_status: 'OPERATIONAL',
        address: 'Rua A, 100',
        category: 'Restaurante',
        opening_hours: ['segunda: 09:00-18:00'],
        description: 'Restaurante italiano',
        google_maps_url: 'https://maps.google.com/?cid=1',
      }),
    );

    // 30 + 15 + 15 + 12 + 10 + 5 + 5 + 5
    expect(result.score).toBe(97);
    expect(result.level).toBe('EXCELENTE');
  });

  it('limita o score em 100 e classifica como excelente', () => {
    const result = computeOpportunityScore(
      baseInput({
        website_status: 'NO_WEBSITE_DETECTED',
        rating: 4.8,
        review_count: 250,
        phone: '(12) 99999-0000',
        instagram_url: 'https://instagram.com/empresa',
        instagram_confidence: 95,
        business_status: 'OPERATIONAL',
        address: 'Rua A, 100',
        category: 'Restaurante',
        opening_hours: ['segunda: 09:00-18:00'],
        description: 'Restaurante italiano',
        google_maps_url: 'https://maps.google.com/?cid=1',
      }),
    );

    expect(result.score).toBe(MAX_SCORE);
    expect(result.level).toBe('EXCELENTE');
  });

  it('e deterministico: mesma entrada, mesmo resultado', () => {
    const input = baseInput({ website_status: 'NO_WEBSITE_DETECTED', rating: 4.6, review_count: 60 });
    expect(computeOpportunityScore(input)).toEqual(computeOpportunityScore(input));
  });
});

describe('classifyScore', () => {
  it('respeita as faixas da especificacao', () => {
    expect(classifyScore(0)).toBe('BAIXA');
    expect(classifyScore(39)).toBe('BAIXA');
    expect(classifyScore(40)).toBe('MEDIA');
    expect(classifyScore(69)).toBe('MEDIA');
    expect(classifyScore(70)).toBe('ALTA');
    expect(classifyScore(84)).toBe('ALTA');
    expect(classifyScore(85)).toBe('EXCELENTE');
    expect(classifyScore(100)).toBe('EXCELENTE');
  });
});
