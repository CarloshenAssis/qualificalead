import { describe, expect, it } from 'vitest';
import {
  computeGoogleBusinessQuality,
  computeNextAction,
  type ScoreInput,
} from '@/lib/scoring/score';
import { SOURCE_CAPABILITIES } from '@/lib/prospecting/sources/types';

function base(overrides: Partial<ScoreInput> = {}): ScoreInput {
  return {
    website_status: 'NO_WEBSITE_DETECTED',
    rating: 4.8,
    review_count: 183,
    phone: '(12) 99999-0000',
    instagram_url: null,
    instagram_confidence: null,
    instagram_status: 'NOT_FOUND',
    business_status: 'OPERATIONAL',
    address: 'Rua A, 100',
    category: 'Restaurante',
    opening_hours: ['segunda: 09:00-18:00'],
    description: 'Restaurante italiano',
    google_maps_url: 'https://maps.google.com/?cid=1',
    ...overrides,
  };
}

describe('computeGoogleBusinessQuality', () => {
  it('nao confunde nota alta com qualidade (SPEC 1.1 §31)', () => {
    const poucasAvaliacoes = computeGoogleBusinessQuality(base({ rating: 5, review_count: 1 }));
    const muitasAvaliacoes = computeGoogleBusinessQuality(base({ rating: 4.8, review_count: 183 }));

    expect(poucasAvaliacoes).toBe('LOW');
    expect(muitasAvaliacoes).toBe('HIGH');
  });

  it('perfil incompleto nao chega a HIGH', () => {
    const incompleto = computeGoogleBusinessQuality(
      base({ address: null, opening_hours: null, description: null, google_maps_url: null }),
    );
    expect(incompleto).not.toBe('HIGH');
  });

  it('empresa fechada permanentemente e sempre LOW', () => {
    expect(computeGoogleBusinessQuality(base({ business_status: 'CLOSED_PERMANENTLY' }))).toBe('LOW');
  });
});

describe('computeGoogleBusinessQuality — fonte sem perfil comercial do Google (SPEC 1.2 §34, ajuste da FASE 4)', () => {
  it('OSM nunca vira LOW por falta de dado de GBP: e NOT_APPLICABLE', () => {
    // Mesmo com dados objetivamente ruins (fechado, sem avaliacoes), a fonte nao tem
    // como avaliar perfil comercial do Google — o resultado nao pode ser "LOW".
    const semDados = computeGoogleBusinessQuality(
      base({ rating: null, review_count: null, business_status: 'CLOSED_PERMANENTLY' }),
      SOURCE_CAPABILITIES.OPENSTREETMAP,
    );
    expect(semDados).toBe('NOT_APPLICABLE');
    expect(semDados).not.toBe('LOW');
  });

  it('Google mantem o comportamento exato da 1.1 quando a capacidade e explicitada', () => {
    const semCapacidade = computeGoogleBusinessQuality(base(), undefined);
    const comCapacidadeGoogle = computeGoogleBusinessQuality(base(), SOURCE_CAPABILITIES.GOOGLE_PLACES);
    expect(comCapacidadeGoogle).toBe(semCapacidade);
    expect(comCapacidadeGoogle).toBe('HIGH');
  });

  it('nao inventa uma heuristica nova para OSM: o resultado e sempre a mesma constante', () => {
    const casos = [
      base({ rating: 5, review_count: 1000 }),
      base({ address: null, description: null }),
      base({ business_status: 'OPERATIONAL' }),
    ];
    for (const input of casos) {
      expect(computeGoogleBusinessQuality(input, SOURCE_CAPABILITIES.OPENSTREETMAP)).toBe('NOT_APPLICABLE');
    }
  });

  it('NOT_APPLICABLE nunca e convertido em FALSE/LOW em nenhum caminho', () => {
    const quality = computeGoogleBusinessQuality(base(), SOURCE_CAPABILITIES.OPENSTREETMAP);
    expect(quality).not.toBe('LOW');
    expect(Boolean(quality)).toBe(true);
    expect(quality === 'LOW').toBe(false);
  });
});

describe('computeNextAction', () => {
  const solid = { score: 90, quality: 'HIGH' as const, hasPhone: true, websiteStatus: 'NO_WEBSITE_DETECTED' as const, businessStatus: 'OPERATIONAL' };

  it('recomenda contato imediato com sinais fortes', () => {
    expect(computeNextAction(solid).action).toBe('CONTACT_NOW');
  });

  it('sem telefone, manda pesquisar mais', () => {
    expect(computeNextAction({ ...solid, hasPhone: false }).action).toBe('RESEARCH_MORE');
  });

  it('site nao verificado impede contato imediato', () => {
    expect(computeNextAction({ ...solid, websiteStatus: 'UNKNOWN' }).action).toBe('RESEARCH_MORE');
  });

  it('empresa fechada nunca deve ser contatada', () => {
    expect(computeNextAction({ ...solid, businessStatus: 'CLOSED_PERMANENTLY' }).action).toBe(
      'DO_NOT_CONTACT',
    );
  });

  it('score baixo vira baixa prioridade', () => {
    expect(computeNextAction({ ...solid, score: 20, quality: 'LOW' }).action).toBe('LOW_PRIORITY');
  });

  it('respeita o estado do lead no CRM', () => {
    expect(computeNextAction({ ...solid, leadStatus: 'CONTATADO' }).action).toBe('ALREADY_CONTACTED');
    expect(computeNextAction({ ...solid, leadStatus: 'PROPOSTA' }).action).toBe('ALREADY_CONTACTED');
    expect(computeNextAction({ ...solid, leadStatus: 'SEM_INTERESSE' }).action).toBe('DO_NOT_CONTACT');
    expect(computeNextAction({ ...solid, leadStatus: 'DESCARTADO' }).action).toBe('DO_NOT_CONTACT');
    // Lead novo nao impede a recomendacao de contato.
    expect(computeNextAction({ ...solid, leadStatus: 'NOVO' }).action).toBe('CONTACT_NOW');
  });

  it('sempre explica o motivo', () => {
    expect(computeNextAction(solid).reason.length).toBeGreaterThan(10);
  });
});

describe('computeNextAction — NOT_APPLICABLE nao reduz a recomendacao (SPEC 1.2 §34, ajuste da FASE 4)', () => {
  const solid = {
    score: 90,
    hasPhone: true,
    websiteStatus: 'NO_WEBSITE_DETECTED' as const,
    businessStatus: 'OPERATIONAL',
  };

  it('lead do OSM com bons sinais ainda recomenda contato imediato, mesmo sem dado de GBP', () => {
    expect(computeNextAction({ ...solid, quality: 'NOT_APPLICABLE' }).action).toBe('CONTACT_NOW');
  });

  it('NOT_APPLICABLE nao empurra sozinho para RESEARCH_MORE ou LOW_PRIORITY', () => {
    // Mesmos sinais que levariam "HIGH" a CONTACT_NOW: a ausencia de dado de GBP
    // nao pode, por si so, rebaixar a recomendacao.
    const comHigh = computeNextAction({ ...solid, quality: 'HIGH' });
    const semDadoGbp = computeNextAction({ ...solid, quality: 'NOT_APPLICABLE' });
    expect(semDadoGbp.action).toBe(comHigh.action);
  });

  it('score baixo ainda vira LOW_PRIORITY mesmo com quality NOT_APPLICABLE — a causa e o score, nao a fonte', () => {
    expect(computeNextAction({ ...solid, score: 20, quality: 'NOT_APPLICABLE' }).action).toBe('LOW_PRIORITY');
  });
});
