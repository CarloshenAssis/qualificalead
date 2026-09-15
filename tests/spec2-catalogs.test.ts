import { describe, expect, it } from 'vitest';
import {
  GAP_CATALOG,
  initialGapStatus,
  isGapEvaluable,
  isInternalGap,
} from '@/lib/gaps/catalog';
import { OFFER_CATALOG, offersForGap, recommendOffer } from '@/lib/offers/catalog';
import { EXTERNAL_GAP_TYPES, GAP_TYPES, INTERNAL_GAP_TYPES, OFFER_TYPES } from '@/types/spec2';

describe('catalogo de gaps (SPEC 2.0 §12)', () => {
  it('todo gap da SPEC tem definicao, e nenhuma definicao sobra', () => {
    expect(Object.keys(GAP_CATALOG).sort()).toEqual([...GAP_TYPES].sort());
  });

  it('cada definicao aponta para si mesma e para uma oferta existente', () => {
    for (const [type, definition] of Object.entries(GAP_CATALOG)) {
      expect(definition.type, type).toBe(type);
      expect(OFFER_TYPES, type).toContain(definition.recommendedOffer);
      expect(definition.defaultSeverity, type).toBeGreaterThanOrEqual(1);
      expect(definition.defaultSeverity, type).toBeLessThanOrEqual(5);
      expect(definition.needPoints, type).toBeGreaterThan(0);
    }
  });

  it('gaps internos sao exatamente os da §12.2 e nunca dependem de auditoria externa', () => {
    const internal = GAP_TYPES.filter(isInternalGap);
    expect(internal.sort()).toEqual([...INTERNAL_GAP_TYPES].sort());

    for (const type of INTERNAL_GAP_TYPES) {
      expect(GAP_CATALOG[type].requiredObservations, type).toEqual([]);
    }
  });

  it('gap interno nasce em NEEDS_REVIEW; gap externo, em DETECTED', () => {
    for (const type of INTERNAL_GAP_TYPES) {
      expect(initialGapStatus(type), type).toBe('NEEDS_REVIEW');
    }
    for (const type of EXTERNAL_GAP_TYPES) {
      expect(initialGapStatus(type), type).toBe('DETECTED');
    }
  });

  it('observacao inconclusiva (null) impede a avaliacao do gap — nao vira false', () => {
    expect(isGapEvaluable('NO_LEAD_CAPTURE', { WEBSITE_REACHABLE: true, HAS_FORM: false })).toBe(
      true,
    );
    expect(isGapEvaluable('NO_LEAD_CAPTURE', { WEBSITE_REACHABLE: true, HAS_FORM: null })).toBe(
      false,
    );
    expect(isGapEvaluable('NO_LEAD_CAPTURE', { WEBSITE_REACHABLE: true })).toBe(false);
  });

  it('gap sem exigencia de observacao e sempre avaliavel', () => {
    expect(isGapEvaluable('NO_WEBSITE', {})).toBe(true);
    expect(isGapEvaluable('MANUAL_FOLLOW_UP', {})).toBe(true);
  });
});

describe('catalogo de ofertas (SPEC 2.0 §13)', () => {
  it('toda oferta da SPEC tem definicao, e nenhuma definicao sobra', () => {
    expect(Object.keys(OFFER_CATALOG).sort()).toEqual([...OFFER_TYPES].sort());
  });

  it('o catalogo nunca inventa preco — isso e decisao do usuario (SPEC 2.0 §3.3)', () => {
    for (const offer of Object.values(OFFER_CATALOG)) {
      expect(offer.priceRangeCents, offer.type).toBeNull();
    }
  });

  it('cada oferta cobre gaps que existem no catalogo de gaps', () => {
    for (const offer of Object.values(OFFER_CATALOG)) {
      expect(offer.compatibleGaps.length, offer.type).toBeGreaterThan(0);
      for (const gap of offer.compatibleGaps) {
        expect(GAP_TYPES, `${offer.type} -> ${gap}`).toContain(gap);
      }
    }
  });

  it('todo gap tem ao menos uma oferta que o resolve', () => {
    for (const gap of GAP_TYPES) {
      expect(offersForGap(gap).length, gap).toBeGreaterThan(0);
    }
  });

  it('a recomendacao segue a oferta preferida do gap', () => {
    expect(recommendOffer('NO_WEBSITE').offer).toBe('INSTITUTIONAL_WEBSITE');
    expect(recommendOffer('NO_SCHEDULING', ['WEBSITE_REACHABLE']).offer).toBe('SCHEDULING_PAGE');
    expect(recommendOffer('DISCONNECTED_WORKFLOW').offer).toBe('CUSTOM_AUTOMATION');
  });

  it('sem evidencia minima nao ha recomendacao, e o motivo e explicito', () => {
    const result = recommendOffer('NO_SCHEDULING', []);
    expect(result.offer).toBeNull();
    expect(result.reason).toContain('Evidencia minima');
  });

  it('sem gap nao ha oferta', () => {
    const result = recommendOffer(null);
    expect(result.offer).toBeNull();
    expect(result.reason).toContain('Nenhum gap');
  });
});
