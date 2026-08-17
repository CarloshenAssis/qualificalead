import 'server-only';

import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { overpassCacheTtlHours } from '@/lib/env';
import type { ProspectingSearchParams, SourceId, SourceSearchResult } from './sources/types';

/**
 * Cache persistente de descoberta (SPEC 1.2 §25/§43, FASE 6).
 *
 * Precisa ser persistente porque a Vercel nao mantem estado em memoria entre invocacoes
 * (cada requisicao pode cair numa instancia diferente) — um cache em memoria seria, na
 * pratica, sempre vazio. `discovery_cache` (migration 0004) guarda o resultado por
 * usuario: chave logica = fonte + todos os parametros que mudam o resultado da busca,
 * materializada como hash SHA-256. TTL configuravel via OVERPASS_CACHE_TTL_HOURS.
 *
 * Falha ao ler ou escrever o cache nunca derruba a pesquisa — e so uma otimizacao.
 */

export type CacheKeyParams = ProspectingSearchParams & { source: SourceId };

/** Representacao canonica e estavel dos parametros — mesma busca sempre gera o mesmo hash. */
function canonicalParams(params: CacheKeyParams): Record<string, unknown> {
  return {
    source: params.source,
    query: params.query.trim().toLowerCase(),
    city: params.city.trim().toLowerCase(),
    state: params.state?.trim().toLowerCase() || null,
    country: params.countryCode?.trim().toLowerCase() || null,
    latitude: typeof params.latitude === 'number' ? Number(params.latitude.toFixed(4)) : null,
    longitude: typeof params.longitude === 'number' ? Number(params.longitude.toFixed(4)) : null,
    radiusMeters: params.radiusMeters ?? null,
    limit: params.limit ?? null,
  };
}

export function computeCacheKey(params: CacheKeyParams): string {
  const canonical = canonicalParams(params);
  // Ordem de chaves fixa (definida acima e nao pela ordem de insercao do objeto de entrada)
  // garante que o mesmo conjunto de parametros sempre produza o mesmo hash.
  const serialized = JSON.stringify(canonical, [
    'source',
    'query',
    'city',
    'state',
    'country',
    'latitude',
    'longitude',
    'radiusMeters',
    'limit',
  ]);
  return createHash('sha256').update(serialized).digest('hex');
}

export type CacheReadResult = { result: SourceSearchResult; cacheKey: string };

/** `null` tanto para cache ausente quanto expirado — quem chama nao precisa distinguir. */
export async function readDiscoveryCache(
  supabase: SupabaseClient,
  userId: string,
  params: CacheKeyParams,
): Promise<CacheReadResult | null> {
  const cacheKey = computeCacheKey(params);

  try {
    const { data, error } = await supabase
      .from('discovery_cache')
      .select('result, expires_at')
      .eq('user_id', userId)
      .eq('cache_key', cacheKey)
      .maybeSingle();

    if (error || !data) return null;
    if (new Date(data.expires_at).getTime() <= Date.now()) return null;

    const cached = data.result as SourceSearchResult;
    return { cacheKey, result: { ...cached, metrics: { ...cached.metrics, cacheHit: true } } };
  } catch (error) {
    console.error('[discovery-cache] falha ao ler', {
      userId,
      source: params.source,
      error: error instanceof Error ? error.message : 'desconhecido',
    });
    return null;
  }
}

export async function writeDiscoveryCache(
  supabase: SupabaseClient,
  userId: string,
  params: CacheKeyParams,
  result: SourceSearchResult,
): Promise<void> {
  const cacheKey = computeCacheKey(params);
  const expiresAt = new Date(Date.now() + overpassCacheTtlHours() * 60 * 60 * 1000).toISOString();

  try {
    const { error } = await supabase.from('discovery_cache').upsert(
      {
        user_id: userId,
        source: params.source,
        cache_key: cacheKey,
        params: canonicalParams(params),
        // Grava o resultado com cacheHit=false: e assim que foi obtido de verdade;
        // quem le do cache marca cacheHit=true no momento da leitura.
        result: { ...result, metrics: { ...result.metrics, cacheHit: false } },
        expires_at: expiresAt,
      },
      { onConflict: 'user_id,cache_key' },
    );

    if (error) {
      console.error('[discovery-cache] falha ao escrever', { userId, source: params.source, code: error.code });
    }
  } catch (error) {
    console.error('[discovery-cache] falha ao escrever', {
      userId,
      source: params.source,
      error: error instanceof Error ? error.message : 'desconhecido',
    });
  }
}
