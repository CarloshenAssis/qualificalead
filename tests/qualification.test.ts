import { describe, expect, it } from 'vitest';
import {
  computeGoogleBusinessQuality,
  computeNextAction,
  type ScoreInput,
} from '@/lib/scoring/score';

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
