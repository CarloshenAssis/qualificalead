import { afterEach, describe, expect, it, vi } from 'vitest';
import { foursquareEnabled, googlePlacesEnabled } from '@/lib/env';
import { checkFoursquare, checkGoogle } from '@/lib/health/check';
import { selectSources } from '@/lib/prospecting/sources/registry';
import type { ProspectingSource } from '@/lib/prospecting/sources/types';

/**
 * Protecao contra chamadas pagas (SPEC 1.2 §17/§19/§22/§23/§57, FASE 5).
 *
 * Regra central: a presenca de uma credencial nunca autoriza uma chamada por si so.
 * So o opt-in explicito (`*_ENABLED=true`) libera rede — e mesmo assim, o modo FREE
 * (padrao do produto) continua barrando qualquer fonte paga independente da flag.
 */

function withEnv(vars: Record<string, string | undefined>, run: () => void | Promise<void>) {
  const original: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) original[key] = process.env[key];

  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  return Promise.resolve(run()).finally(() => {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

describe('googlePlacesEnabled / foursquareEnabled — opt-in explicito (regras 1-2)', () => {
  it('variavel ausente => desabilitado (regra 2)', () =>
    withEnv({ GOOGLE_PLACES_ENABLED: undefined, FOURSQUARE_ENABLED: undefined }, () => {
      expect(googlePlacesEnabled()).toBe(false);
      expect(foursquareEnabled()).toBe(false);
    }));

  it('qualquer valor que nao signifique "true" mantem desabilitado', () =>
    withEnv({}, () => {
      for (const value of ['false', '0', '1', 'yes', 'on', '', '  ']) {
        process.env.GOOGLE_PLACES_ENABLED = value;
        process.env.FOURSQUARE_ENABLED = value;
        expect(googlePlacesEnabled()).toBe(false);
        expect(foursquareEnabled()).toBe(false);
      }
    }));

  it('"true" (em qualquer caixa, com espacos) habilita', () =>
    withEnv({}, () => {
      for (const value of ['true', 'True', ' TRUE ']) {
        process.env.GOOGLE_PLACES_ENABLED = value;
        process.env.FOURSQUARE_ENABLED = value;
        expect(googlePlacesEnabled()).toBe(true);
        expect(foursquareEnabled()).toBe(true);
      }
    }));
});

describe('checkGoogle — chave presente nao autoriza chamada (regra 3)', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('chave configurada + flag ausente => zero chamadas HTTP', () =>
    withEnv({ GOOGLE_PLACES_ENABLED: undefined, GOOGLE_MAPS_API_KEY: 'a-real-looking-key' }, async () => {
      const fetchMock = vi.fn();
      global.fetch = fetchMock as unknown as typeof fetch;

      const checks = await checkGoogle();

      expect(fetchMock).not.toHaveBeenCalled();
      expect(checks.every((c) => c.level !== 'fail')).toBe(true);
      expect(checks[0]).toMatchObject({ name: 'Google Places', level: 'ok' });
    }));

  it('chave configurada + flag=false => zero chamadas HTTP (regra 1)', () =>
    withEnv({ GOOGLE_PLACES_ENABLED: 'false', GOOGLE_MAPS_API_KEY: 'a-real-looking-key' }, async () => {
      const fetchMock = vi.fn();
      global.fetch = fetchMock as unknown as typeof fetch;

      await checkGoogle();
      expect(fetchMock).not.toHaveBeenCalled();
    }));

  it('flag=true sem chave: ainda nao chama nada e reporta falha honesta', () =>
    withEnv({ GOOGLE_PLACES_ENABLED: 'true', GOOGLE_MAPS_API_KEY: undefined }, async () => {
      const fetchMock = vi.fn();
      global.fetch = fetchMock as unknown as typeof fetch;

      const checks = await checkGoogle();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(checks[0].level).toBe('fail');
    }));

  it('flag=true + chave presente: so ai a chamada real acontece (comportamento intencional)', () =>
    withEnv({ GOOGLE_PLACES_ENABLED: 'true', GOOGLE_MAPS_API_KEY: 'a-real-looking-key' }, async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({ places: [] }), { status: 200 }));
      global.fetch = fetchMock as unknown as typeof fetch;

      await checkGoogle();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(String(fetchMock.mock.calls[0][0])).toContain('googleapis.com');
    }));
});

describe('checkFoursquare — sem adaptador, nunca chama rede (regra 4)', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('desabilitado por padrao: ok, sem tocar fetch', () =>
    withEnv({ FOURSQUARE_ENABLED: undefined }, () => {
      const fetchMock = vi.fn();
      global.fetch = fetchMock as unknown as typeof fetch;

      const check = checkFoursquare();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(check.level).toBe('ok');
    }));

  it('mesmo com FOURSQUARE_ENABLED=true, nao ha integracao: aviso, nunca chamada (regra 5)', () =>
    withEnv({ FOURSQUARE_ENABLED: 'true' }, () => {
      const fetchMock = vi.fn();
      global.fetch = fetchMock as unknown as typeof fetch;

      const check = checkFoursquare();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(check.level).toBe('warn');
    }));
});

describe('selectSources — barreira de custo generica, nao hardcoded para uma fonte (regra 5)', () => {
  it('uma fonte paga qualquer (nao so o Google) e barrada quando desligada, mesmo escolhida explicitamente', () => {
    const searchSpy = vi.fn();
    const fakePaidSource: ProspectingSource = {
      id: 'FOURSQUARE',
      name: 'Foursquare',
      type: 'PAID',
      enabled: false,
      search: searchSpy,
    };

    const { selected, skipped } = selectSources([fakePaidSource], 'CUSTOM', ['FOURSQUARE']);

    expect(selected).toHaveLength(0);
    expect(skipped[0]).toMatchObject({ id: 'FOURSQUARE', reason: 'PAID_NOT_ENABLED' });
    expect(searchSpy).not.toHaveBeenCalled();
  });

  it('FREE MODE continua exclusivamente OpenStreetMap, mesmo com todas as outras fontes habilitadas (regra 7)', () => {
    const osm: ProspectingSource = { id: 'OPENSTREETMAP', name: 'OSM', type: 'FREE', enabled: true, search: vi.fn() };
    const google: ProspectingSource = { id: 'GOOGLE_PLACES', name: 'Google', type: 'PAID', enabled: true, search: vi.fn() };
    const foursquare: ProspectingSource = { id: 'FOURSQUARE', name: 'Foursquare', type: 'OPTIONAL', enabled: true, search: vi.fn() };

    const { selected } = selectSources([osm, google, foursquare], 'FREE');
    expect(selected.map((s) => s.id)).toEqual(['OPENSTREETMAP']);
  });
});
