import { describe, expect, it } from 'vitest';
import { selectSources } from '@/lib/prospecting/sources/registry';
import type { ProspectingSource, SourceId, SourceType } from '@/lib/prospecting/sources/types';

/** Fonte falsa: o registry nao deve precisar de rede para ser testado. */
function fakeSource(
  id: SourceId,
  type: SourceType,
  enabled: boolean,
): ProspectingSource {
  return {
    id,
    name: id,
    type,
    enabled,
    search: async () => {
      throw new Error(`${id} nao deveria ter sido chamada`);
    },
  };
}

const osm = () => fakeSource('OPENSTREETMAP', 'FREE', true);
const googleOff = () => fakeSource('GOOGLE_PLACES', 'PAID', false);
const googleOn = () => fakeSource('GOOGLE_PLACES', 'PAID', true);
const foursquareOff = () => fakeSource('FOURSQUARE', 'OPTIONAL', false);

describe('selectSources', () => {
  it('modo FREE executa apenas fontes gratuitas', () => {
    const { selected, skipped } = selectSources([osm(), googleOff(), foursquareOff()], 'FREE');

    expect(selected.map((s) => s.id)).toEqual(['OPENSTREETMAP']);
    expect(skipped.map((s) => s.id)).toEqual(['GOOGLE_PLACES', 'FOURSQUARE']);
  });

  it('fonte paga desativada nunca e selecionada (SPEC 1.2 §23)', () => {
    for (const mode of ['FREE', 'BALANCED', 'CUSTOM'] as const) {
      const { selected, skipped } = selectSources([googleOff()], mode, ['GOOGLE_PLACES']);

      expect(selected).toHaveLength(0);
      expect(skipped[0]?.reason).toBe('PAID_NOT_ENABLED');
    }
  });

  it('nem mesmo a escolha explicita do usuario habilita fonte paga desativada', () => {
    const { selected } = selectSources([osm(), googleOff()], 'CUSTOM', [
      'OPENSTREETMAP',
      'GOOGLE_PLACES',
    ]);

    expect(selected.map((s) => s.id)).toEqual(['OPENSTREETMAP']);
  });

  it('modo BALANCED aceita fonte paga somente apos habilitacao explicita', () => {
    const desativada = selectSources([osm(), googleOff()], 'BALANCED');
    expect(desativada.selected.map((s) => s.id)).toEqual(['OPENSTREETMAP']);

    const habilitada = selectSources([osm(), googleOn()], 'BALANCED');
    expect(habilitada.selected.map((s) => s.id)).toEqual(['OPENSTREETMAP', 'GOOGLE_PLACES']);
  });

  it('modo CUSTOM respeita a selecao entre fontes habilitadas', () => {
    const { selected, skipped } = selectSources([osm(), googleOn()], 'CUSTOM', ['OPENSTREETMAP']);

    expect(selected.map((s) => s.id)).toEqual(['OPENSTREETMAP']);
    expect(skipped[0]?.reason).toBe('NOT_SELECTED');
  });

  it('fonte opcional sem credencial e ignorada sem erro (SPEC 1.2 §19)', () => {
    const { selected, skipped } = selectSources([osm(), foursquareOff()], 'BALANCED');

    expect(selected.map((s) => s.id)).toEqual(['OPENSTREETMAP']);
    expect(skipped[0]).toMatchObject({ id: 'FOURSQUARE', reason: 'DISABLED' });
  });

  it('explica por que cada fonte foi ignorada', () => {
    const { skipped } = selectSources([googleOff(), foursquareOff()], 'FREE');
    for (const item of skipped) {
      expect(item.message.length).toBeGreaterThan(3);
    }
  });

  it('sem fonte alguma disponivel devolve selecao vazia, sem lancar', () => {
    const { selected, skipped } = selectSources([googleOff(), foursquareOff()], 'FREE');
    expect(selected).toHaveLength(0);
    expect(skipped).toHaveLength(2);
  });
});
