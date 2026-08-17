import { afterEach, describe, expect, it, vi } from 'vitest';
import { computeCacheKey, readDiscoveryCache, writeDiscoveryCache } from '@/lib/prospecting/cache';
import { createSupabaseMock } from './helpers/supabase-mock';

/**
 * Cache persistente de descoberta (SPEC 1.2 §25/§43, FASE 6).
 * Precisa ser persistente (nao em memoria) porque a Vercel nao mantem estado entre
 * invocacoes — cada teste aqui usa o mock de Supabase, nunca um Map em processo.
 */

const BASE_PARAMS = {
  source: 'OPENSTREETMAP' as const,
  query: 'padaria',
  city: 'Sao Jose dos Campos',
  state: 'SP',
  countryCode: 'Brasil',
  limit: 20,
};

const FAKE_RESULT = {
  source: 'OPENSTREETMAP' as const,
  businesses: [{ source: 'OPENSTREETMAP' as const, sourceId: 'node/1', name: 'Padaria Central' }],
  metrics: { requested: 20, returned: 1, durationMs: 100, cacheHit: false },
  warnings: [],
};

describe('computeCacheKey', () => {
  it('e deterministico: mesmos parametros produzem o mesmo hash', () => {
    expect(computeCacheKey(BASE_PARAMS)).toBe(computeCacheKey({ ...BASE_PARAMS }));
  });

  it('nao depende da ordem das propriedades do objeto de entrada', () => {
    const a = computeCacheKey(BASE_PARAMS);
    const reordered = {
      limit: BASE_PARAMS.limit,
      countryCode: BASE_PARAMS.countryCode,
      state: BASE_PARAMS.state,
      city: BASE_PARAMS.city,
      query: BASE_PARAMS.query,
      source: BASE_PARAMS.source,
    };
    expect(computeCacheKey(reordered)).toBe(a);
  });

  it('e insensivel a caixa e espacos nos campos de texto', () => {
    const a = computeCacheKey(BASE_PARAMS);
    const b = computeCacheKey({ ...BASE_PARAMS, query: '  PADARIA  ', city: 'SAO JOSE DOS CAMPOS' });
    expect(a).toBe(b);
  });

  it('muda quando a fonte muda — cache e por fonte (SPEC 1.2 §25)', () => {
    expect(computeCacheKey(BASE_PARAMS)).not.toBe(computeCacheKey({ ...BASE_PARAMS, source: 'GOOGLE_PLACES' }));
  });

  it('muda quando qualquer parametro relevante muda (cidade, raio, limite, coordenadas)', () => {
    const a = computeCacheKey(BASE_PARAMS);
    expect(computeCacheKey({ ...BASE_PARAMS, city: 'Campinas' })).not.toBe(a);
    expect(computeCacheKey({ ...BASE_PARAMS, limit: 50 })).not.toBe(a);
    expect(computeCacheKey({ ...BASE_PARAMS, radiusMeters: 5000 })).not.toBe(a);
    expect(computeCacheKey({ ...BASE_PARAMS, latitude: -23.2, longitude: -45.9 })).not.toBe(a);
  });
});

describe('readDiscoveryCache / writeDiscoveryCache', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('cache miss: nada gravado ainda devolve null', async () => {
    const { client } = createSupabaseMock();
    const result = await readDiscoveryCache(client, 'user-1', BASE_PARAMS);
    expect(result).toBeNull();
  });

  it('cache hit: mesma pesquisa dentro do TTL devolve o resultado gravado com cacheHit=true', async () => {
    const { client } = createSupabaseMock();
    await writeDiscoveryCache(client, 'user-1', BASE_PARAMS, FAKE_RESULT);

    const result = await readDiscoveryCache(client, 'user-1', BASE_PARAMS);
    expect(result).not.toBeNull();
    expect(result?.result.businesses).toHaveLength(1);
    expect(result?.result.businesses[0].name).toBe('Padaria Central');
    expect(result?.result.metrics.cacheHit).toBe(true);
  });

  it('TTL expirado: entrada antiga nao e reaproveitada (vira miss)', async () => {
    const expired = new Date(Date.now() - 60_000).toISOString(); // ja expirou
    const { client } = createSupabaseMock({
      discovery_cache: [
        {
          id: 'c-1',
          user_id: 'user-1',
          source: 'OPENSTREETMAP',
          cache_key: computeCacheKey(BASE_PARAMS),
          params: {},
          result: FAKE_RESULT,
          expires_at: expired,
        },
      ],
    });

    const result = await readDiscoveryCache(client, 'user-1', BASE_PARAMS);
    expect(result).toBeNull();
  });

  it('isolamento por usuario: cache gravado por um usuario nao aparece para outro', async () => {
    const { client } = createSupabaseMock();
    await writeDiscoveryCache(client, 'user-a', BASE_PARAMS, FAKE_RESULT);

    const forOwner = await readDiscoveryCache(client, 'user-a', BASE_PARAMS);
    const forOther = await readDiscoveryCache(client, 'user-b', BASE_PARAMS);

    expect(forOwner).not.toBeNull();
    expect(forOther).toBeNull();
  });

  it('escrever de novo com os mesmos parametros atualiza a entrada em vez de duplicar', async () => {
    const { client, tables } = createSupabaseMock();
    await writeDiscoveryCache(client, 'user-1', BASE_PARAMS, FAKE_RESULT);
    await writeDiscoveryCache(client, 'user-1', BASE_PARAMS, {
      ...FAKE_RESULT,
      businesses: [...FAKE_RESULT.businesses, { source: 'OPENSTREETMAP', sourceId: 'node/2', name: 'Padaria Nova' }],
    });

    const entries = tables.discovery_cache.filter((r) => r.user_id === 'user-1');
    expect(entries).toHaveLength(1);
    expect((entries[0].result as typeof FAKE_RESULT).businesses).toHaveLength(2);
  });

  it('falha ao ler o cache vira miss, nunca derruba a chamada', async () => {
    const { client } = createSupabaseMock();
    vi.spyOn(client, 'from').mockImplementationOnce(() => {
      throw new Error('falha de rede simulada');
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await readDiscoveryCache(client, 'user-1', BASE_PARAMS);
    expect(result).toBeNull();
  });
});
