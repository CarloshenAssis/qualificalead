import { describe, expect, it } from 'vitest';
import { classifyScore, computeOpportunityScore, type ScoreInput } from '@/lib/scoring/score';
import { MAX_SCORE, SCORE_WEIGHTS } from '@/lib/scoring/config';
import { SOURCE_CAPABILITIES } from '@/lib/prospecting/sources/types';

/** Empresa minima: nenhum sinal positivo alem do que o teste ligar. */
function baseInput(overrides: Partial<ScoreInput> = {}): ScoreInput {
  return {
    website_status: 'HAS_WEBSITE',
    rating: null,
    review_count: null,
    phone: null,
    instagram_url: null,
    instagram_confidence: null,
    instagram_status: 'NOT_FOUND',
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

  it('nao da bonus extra para Instagram de baixa ou media confianca (SPEC 1.1 §29)', () => {
    for (const confidence of [20, 60, 85]) {
      const result = computeOpportunityScore(
        baseInput({
          instagram_url: 'https://instagram.com/x',
          instagram_confidence: confidence,
          instagram_status: 'PENDING',
        }),
      );
      expect(result.breakdown.some((i) => i.code === 'INSTAGRAM_FOUND')).toBe(true);
      expect(result.breakdown.some((i) => i.code === 'INSTAGRAM_HIGH_CONFIDENCE')).toBe(false);
    }
  });

  it('da bonus extra com confianca muito alta ou confirmacao humana', () => {
    const veryHigh = computeOpportunityScore(
      baseInput({
        instagram_url: 'https://instagram.com/x',
        instagram_confidence: 95,
        instagram_status: 'PENDING',
      }),
    );
    expect(veryHigh.breakdown.some((i) => i.code === 'INSTAGRAM_HIGH_CONFIDENCE')).toBe(true);

    const confirmed = computeOpportunityScore(
      baseInput({
        instagram_url: 'https://instagram.com/x',
        instagram_confidence: 45,
        instagram_status: 'CONFIRMED',
      }),
    );
    expect(confirmed.breakdown.some((i) => i.code === 'INSTAGRAM_HIGH_CONFIDENCE')).toBe(true);
  });

  it('Instagram rejeitado deixa de pontuar', () => {
    const rejected = computeOpportunityScore(
      baseInput({
        instagram_url: 'https://instagram.com/x',
        instagram_confidence: 95,
        instagram_status: 'REJECTED',
      }),
    );
    expect(rejected.breakdown.some((i) => i.code.startsWith('INSTAGRAM'))).toBe(false);
  });

  it('website UNKNOWN nao pontua como ausencia de site (SPEC 1.1 §17)', () => {
    const unknown = computeOpportunityScore(baseInput({ website_status: 'UNKNOWN' }));
    expect(unknown.breakdown.some((i) => i.code === 'NO_WEBSITE')).toBe(false);
  });

  it('nao considera ativa uma empresa fechada permanentemente', () => {
    const closed = computeOpportunityScore(
      baseInput({ business_status: 'CLOSED_PERMANENTLY', review_count: 100 }),
    );
    expect(closed.breakdown.some((i) => i.code === 'BUSINESS_ACTIVE')).toBe(false);
  });

  it('reproduz a composicao do exemplo da especificacao (com Instagram, sem lacuna digital)', () => {
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

    // 30 (site) + 15 (rating) + 12 (183 avaliacoes) + 10 (insta) + 5 (insta alta confianca)
    // + 5 (telefone) + 5 (ativa). DIGITAL_PRESENCE_GAP nao entra: ha Instagram encontrado.
    expect(result.score).toBe(82);
    expect(result.level).toBe('ALTA');
  });

  it('atinge o score maximo quando ha site nao identificado + lacuna digital + demais sinais', () => {
    const result = computeOpportunityScore(
      baseInput({
        website_status: 'NO_WEBSITE_DETECTED',
        rating: 4.8,
        review_count: 250,
        phone: '(12) 99999-0000',
        business_status: 'OPERATIONAL',
        address: 'Rua A, 100',
        category: 'Restaurante',
        opening_hours: ['segunda: 09:00-18:00'],
        description: 'Restaurante italiano',
        google_maps_url: 'https://maps.google.com/?cid=1',
      }),
    );

    // 30 (site) + 30 (lacuna digital: sem site e sem Instagram) + 15 (rating) + 15 (250 avaliacoes)
    // + 5 (telefone) + 5 (ativa) = 100.
    expect(result.score).toBe(MAX_SCORE);
    expect(result.level).toBe('EXCELENTE');
  });

  it('e deterministico: mesma entrada, mesmo resultado', () => {
    const input = baseInput({ website_status: 'NO_WEBSITE_DETECTED', rating: 4.6, review_count: 60 });
    expect(computeOpportunityScore(input)).toEqual(computeOpportunityScore(input));
  });
});

/**
 * Correcao pontual do score (potencial comercial, nao "Google Business bem
 * configurado") — cenarios exigidos na revisao. `baseInput` continua com
 * website_status: 'HAS_WEBSITE' e o resto nulo por padrao; cada caso liga so o
 * que descreve.
 */
describe('computeOpportunityScore — potencial comercial (correcao pontual)', () => {
  it('Caso 1: empresa OSM identificavel, sem site, sem Instagram, ativa — boa oportunidade', () => {
    const result = computeOpportunityScore(
      baseInput({
        address: 'Rua das Palmeiras, 45',
        phone: '(12) 3921-4400',
        website_status: 'NO_WEBSITE_DETECTED',
        business_status: 'OPERATIONAL',
      }),
      SOURCE_CAPABILITIES.OPENSTREETMAP,
    );

    // 30 (site) + 30 (lacuna digital) + 5 (telefone) + 5 (ativa) = 70.
    expect(result.score).toBe(70);
    expect(result.level).toBe('ALTA');
    expect(result.breakdown.map((b) => b.code).sort()).toEqual(
      ['BUSINESS_ACTIVE', 'DIGITAL_PRESENCE_GAP', 'NO_WEBSITE', 'PHONE_AVAILABLE'].sort(),
    );
  });

  it('Caso 2: Google Business excelente (site + Instagram + rating + avaliacoes) nao vira score alto so por isso', () => {
    const result = computeOpportunityScore(
      baseInput({
        website_status: 'HAS_WEBSITE',
        rating: 4.9,
        review_count: 340,
        phone: '(12) 3921-5500',
        instagram_url: 'https://instagram.com/empresa',
        instagram_status: 'CONFIRMED',
        business_status: 'OPERATIONAL',
        address: 'Av. Central, 900',
      }),
      SOURCE_CAPABILITIES.GOOGLE_PLACES,
    );

    // 15 (rating) + 15 (avaliacoes) + 10 (insta) + 5 (insta confirmado) + 5 (telefone) + 5 (ativa) = 55.
    // Sem NO_WEBSITE e sem DIGITAL_PRESENCE_GAP: a empresa tem site e Instagram.
    expect(result.score).toBe(55);
    expect(result.level).toBe('MEDIA');
    expect(result.breakdown.some((b) => b.code === 'DIGITAL_PRESENCE_GAP')).toBe(false);
  });

  it('Caso 3: empresa OSM sem rating/reviews nao perde pontos por isso', () => {
    const comRating = computeOpportunityScore(
      baseInput({ website_status: 'NO_WEBSITE_DETECTED', address: 'Rua X, 1', rating: 4.9, review_count: 500 }),
      SOURCE_CAPABILITIES.OPENSTREETMAP,
    );
    const semRating = computeOpportunityScore(
      baseInput({ website_status: 'NO_WEBSITE_DETECTED', address: 'Rua X, 1', rating: null, review_count: null }),
      SOURCE_CAPABILITIES.OPENSTREETMAP,
    );

    // OSM nao avalia rating/reviews: presentes ou ausentes, o resultado e o mesmo.
    expect(comRating.score).toBe(semRating.score);
    expect(semRating.breakdown.some((b) => b.code === 'HIGH_RATING')).toBe(false);
    expect(semRating.breakdown.some((b) => b.code === 'REVIEW_COUNT')).toBe(false);
  });

  it('Caso 4: sem telefone continua sendo lead, mas o score reflete abordagem mais dificil', () => {
    const comTelefone = computeOpportunityScore(
      baseInput({
        website_status: 'NO_WEBSITE_DETECTED',
        address: 'Rua das Palmeiras, 45',
        phone: '(12) 3921-4400',
        business_status: 'OPERATIONAL',
      }),
      SOURCE_CAPABILITIES.OPENSTREETMAP,
    );
    const semTelefone = computeOpportunityScore(
      baseInput({
        website_status: 'NO_WEBSITE_DETECTED',
        address: 'Rua das Palmeiras, 45',
        phone: null,
        business_status: 'OPERATIONAL',
      }),
      SOURCE_CAPABILITIES.OPENSTREETMAP,
    );

    expect(semTelefone.score).toBeLessThan(comTelefone.score);
    expect(comTelefone.score - semTelefone.score).toBe(SCORE_WEIGHTS.PHONE_AVAILABLE);
    // O lead continua existindo e pontuando — telefone ausente nao invalida o lead.
    expect(semTelefone.score).toBeGreaterThan(0);
  });

  it('Caso 5: pouca presenca digital + telefone + endereco + nome + ativa — perfil-alvo principal', () => {
    const result = computeOpportunityScore(
      baseInput({
        address: 'Rua Sete de Setembro, 210',
        phone: '(12) 3922-1010',
        website_status: 'NO_WEBSITE_DETECTED',
        business_status: 'OPERATIONAL',
      }),
      SOURCE_CAPABILITIES.OPENSTREETMAP,
    );

    expect(result.level).not.toBe('BAIXA');
    expect(result.score).toBeGreaterThanOrEqual(70);
  });

  it('Caso 6: UNKNOWN nunca vira FALSE — nem em NO_WEBSITE nem em DIGITAL_PRESENCE_GAP', () => {
    const result = computeOpportunityScore(
      baseInput({ website_status: 'UNKNOWN', address: 'Rua Y, 2' }),
      SOURCE_CAPABILITIES.OPENSTREETMAP,
    );

    expect(result.breakdown.some((b) => b.code === 'NO_WEBSITE')).toBe(false);
    expect(result.breakdown.some((b) => b.code === 'DIGITAL_PRESENCE_GAP')).toBe(false);
  });

  it('DIGITAL_PRESENCE_GAP exige endereco: nome sozinho nao basta para "identificavel"', () => {
    const result = computeOpportunityScore(
      baseInput({ website_status: 'NO_WEBSITE_DETECTED', address: null }),
      SOURCE_CAPABILITIES.OPENSTREETMAP,
    );
    expect(result.breakdown.some((b) => b.code === 'DIGITAL_PRESENCE_GAP')).toBe(false);
  });

  it('DIGITAL_PRESENCE_GAP nao dispara quando ha Instagram encontrado (a lacuna precisa ser ampla)', () => {
    const result = computeOpportunityScore(
      baseInput({
        website_status: 'NO_WEBSITE_DETECTED',
        address: 'Rua Z, 3',
        instagram_url: 'https://instagram.com/x',
        instagram_status: 'PENDING',
      }),
      SOURCE_CAPABILITIES.OPENSTREETMAP,
    );
    expect(result.breakdown.some((b) => b.code === 'DIGITAL_PRESENCE_GAP')).toBe(false);
  });

  it('empresa ativa pontua para OSM quando a fonte informa business_status (nao depende mais de reviews)', () => {
    const result = computeOpportunityScore(
      baseInput({ business_status: 'OPERATIONAL' }),
      SOURCE_CAPABILITIES.OPENSTREETMAP,
    );
    expect(result.breakdown.some((b) => b.code === 'BUSINESS_ACTIVE')).toBe(true);
  });

  it('empresa ativa nao pontua quando a fonte nunca informou business_status (nao inventa "ativa" do silencio)', () => {
    const result = computeOpportunityScore(baseInput({ business_status: null }), SOURCE_CAPABILITIES.OPENSTREETMAP);
    expect(result.breakdown.some((b) => b.code === 'BUSINESS_ACTIVE')).toBe(false);
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
