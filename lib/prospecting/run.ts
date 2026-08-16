import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Company, CompanyUpsert, SearchStatus } from '@/types/database';
import type { ProspectingSearchInput } from '@/lib/validation/schemas';
import { GooglePlacesError, geocodeLocation, textSearch } from '@/lib/google/places';
import { buildDedupKey, normalizePlace, type NormalizedPlace } from '@/lib/google/mappers';
import { discoverInstagram, NOT_FOUND as INSTAGRAM_NOT_FOUND } from '@/lib/instagram/discover';
import type { InstagramDiscovery } from '@/lib/instagram/shared';
import {
  computeGoogleBusinessQuality,
  computeNextAction,
  computeOpportunityScore,
} from '@/lib/scoring/score';
import { normalizePhone } from '@/lib/whatsapp/phone';
import { defaultPhoneCountryCode, digitalPresenceTtlDays } from '@/lib/env';

/**
 * Orquestracao da prospeccao (SPEC 43 fases 3-4, SPEC 1.1 §54/§85/§86).
 * busca -> normalizacao -> deduplicacao -> presenca digital -> qualificacao -> persistencia.
 *
 * Emite eventos de progresso para a interface nunca parecer travada e reporta
 * falhas parciais com honestidade.
 */

/** Requisicoes simultaneas ao verificar presenca digital. */
const ENRICHMENT_CONCURRENCY = 5;

export type ProspectingStage =
  | 'locating'
  | 'searching'
  | 'processing'
  | 'digital_presence'
  | 'scoring'
  | 'saving'
  | 'done';

export const STAGE_MESSAGES: Record<ProspectingStage, string> = {
  locating: 'Localizando regiao...',
  searching: 'Consultando Google Places...',
  processing: 'Processando empresas...',
  digital_presence: 'Verificando presenca digital...',
  scoring: 'Calculando oportunidades...',
  saving: 'Salvando resultados...',
  done: 'Finalizando...',
};

export type ProspectingSummary = {
  status: SearchStatus;
  found: number;
  saved: number;
  newCompanies: number;
  alreadyKnown: number;
  withoutWebsite: number;
  qualified: number;
  excellent: number;
  high: number;
  /** Empresas cuja verificacao de presenca digital falhou (SPEC 1.1 §86). */
  enrichmentFailed: number;
  /** Empresas que reaproveitaram dados do cache em vez de nova consulta. */
  fromCache: number;
  /** `true` quando a API devolveu o maximo permitido e pode haver mais empresas. */
  limitReached: boolean;
};

export type ProspectingEvent =
  | { type: 'stage'; stage: ProspectingStage; message: string }
  | { type: 'progress'; processed: number; total: number }
  | { type: 'warning'; message: string }
  /**
   * `detail` e diagnostico tecnico (api/status HTTP/status e mensagem do Google) para
   * ajudar a identificar a causa real de uma falha — nunca contem credenciais (SPEC 1.1 §57).
   */
  | { type: 'error'; message: string; code?: string; detail?: string }
  | { type: 'done'; summary: ProspectingSummary; searchId: string | null };

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
  onProgress?: (done: number) => void,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  let done = 0;

  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
      done += 1;
      onProgress?.(done);
    }
  });

  await Promise.all(runners);
  return results;
}

/** Dados verificados ha menos de N dias sao reaproveitados (SPEC 1.1 §12). */
export function isFresh(lastCheckedAt: string | null, ttlDays = digitalPresenceTtlDays()): boolean {
  if (!lastCheckedAt) return false;
  const checked = new Date(lastCheckedAt).getTime();
  if (Number.isNaN(checked)) return false;
  return Date.now() - checked < ttlDays * 24 * 60 * 60 * 1000;
}

type EnrichmentOutcome = {
  instagram: InstagramDiscovery;
  status: Company['enrichment_status'];
  error: string | null;
  fromCache: boolean;
};

/** Monta a linha final de `companies` a partir dos dados coletados e derivados. */
export function buildCompanyRow(
  userId: string,
  place: NormalizedPlace,
  outcome: EnrichmentOutcome,
): CompanyUpsert {
  const { instagram } = outcome;
  const phone = place.phone ?? place.phone_international;

  const scoreInput = {
    website_status: place.website_status,
    rating: place.rating,
    review_count: place.review_count,
    phone,
    instagram_url: instagram.instagram_url,
    instagram_confidence: instagram.instagram_confidence,
    instagram_status: instagram.instagram_status,
    business_status: place.business_status,
    address: place.address,
    category: place.category,
    opening_hours: place.opening_hours,
    description: place.description,
    google_maps_url: place.google_maps_url,
  };

  const score = computeOpportunityScore(scoreInput);
  const quality = computeGoogleBusinessQuality(scoreInput);
  const nextAction = computeNextAction({
    score: score.score,
    quality,
    hasPhone: Boolean(normalizePhone(phone, defaultPhoneCountryCode())),
    websiteStatus: place.website_status,
    businessStatus: place.business_status,
  });

  const now = new Date().toISOString();

  return {
    user_id: userId,
    google_place_id: place.google_place_id,
    name: place.name,
    category: place.category,
    categories: place.categories,
    description: place.description,
    phone: place.phone,
    phone_international: place.phone_international,
    whatsapp: normalizePhone(phone, defaultPhoneCountryCode()),
    website: place.website,
    website_status: place.website_status,
    website_checked_at: now,
    google_maps_url: place.google_maps_url,
    address: place.address,
    city: place.city,
    state: place.state,
    country: place.country,
    latitude: place.latitude,
    longitude: place.longitude,
    rating: place.rating,
    review_count: place.review_count,
    opening_hours: place.opening_hours,
    business_status: place.business_status,
    instagram_url: instagram.instagram_url,
    instagram_handle: instagram.instagram_handle,
    instagram_confidence: instagram.instagram_confidence,
    instagram_status: instagram.instagram_status,
    instagram_source: instagram.instagram_source,
    instagram_evidence: instagram.instagram_evidence,
    instagram_checked_at: instagram.instagram_checked_at,
    opportunity_score: score.score,
    opportunity_level: score.level,
    score_breakdown: score.breakdown,
    google_business_quality: quality,
    next_action: nextAction.action,
    next_action_reason: nextAction.reason,
    enrichment_status: outcome.status,
    enrichment_error: outcome.error,
    source_data: { provider: 'google_places_v1', fetched_at: now },
    dedup_key: buildDedupKey({
      name: place.name,
      phone: place.phone,
      address: place.address,
      latitude: place.latitude,
      longitude: place.longitude,
    }),
    last_checked_at: now,
  };
}

export async function* runProspecting(
  supabase: SupabaseClient,
  userId: string,
  input: ProspectingSearchInput,
): AsyncGenerator<ProspectingEvent> {
  const startedAt = Date.now();
  const country = input.country?.trim() || 'Brasil';
  const locationLabel = [input.city, input.state, country].filter(Boolean).join(', ');
  const textQuery = `${input.segment} em ${locationLabel}`;

  console.info('[prospecting] inicio', { userId, segment: input.segment, city: input.city });

  let places: Awaited<ReturnType<typeof textSearch>>;
  try {
    let center = null;
    if (input.radiusKm) {
      yield { type: 'stage', stage: 'locating', message: STAGE_MESSAGES.locating };
      center = await geocodeLocation({ city: input.city, state: input.state, country });

      if (!center) {
        yield {
          type: 'warning',
          message: 'Nao foi possivel localizar a regiao; a busca seguiu sem o filtro de raio.',
        };
      }
    }

    yield { type: 'stage', stage: 'searching', message: STAGE_MESSAGES.searching };

    places = await textSearch({
      textQuery,
      center,
      radiusMeters: input.radiusKm ? input.radiusKm * 1000 : null,
      limit: input.limit,
    });
  } catch (error) {
    const isKnown = error instanceof GooglePlacesError;
    // Diagnostico completo no log tecnico — o erro real nao pode ficar escondido atras
    // do codigo generico (SPEC 1.1 §57). O detail ja vem sem segredos (lib/google/places.ts).
    console.error('[prospecting] falha na busca', {
      userId,
      code: isKnown ? error.code : 'UNKNOWN',
      detail: isKnown ? error.detail : error instanceof Error ? error.message : String(error),
    });
    yield {
      type: 'error',
      code: isKnown ? error.code : undefined,
      message: isKnown
        ? error.message
        : 'Nao foi possivel consultar as empresas agora. Tente novamente.',
      // Mesmo diagnostico tambem chega ao resultado da prospeccao, para o usuario
      // conseguir ver a causa real sem precisar abrir os logs do servidor.
      detail:
        isKnown && error.detail
          ? `${error.detail.api} · HTTP ${error.detail.httpStatus} · ${error.detail.googleStatus ?? 'sem status'} · ${error.detail.googleMessage ?? 'sem mensagem'}`
          : undefined,
    };
    return;
  }

  yield { type: 'stage', stage: 'processing', message: STAGE_MESSAGES.processing };

  const normalized = places
    .map(normalizePlace)
    .filter((place): place is NormalizedPlace => place !== null);

  const emptySummary: ProspectingSummary = {
    status: 'COMPLETED',
    found: 0,
    saved: 0,
    newCompanies: 0,
    alreadyKnown: 0,
    withoutWebsite: 0,
    qualified: 0,
    excellent: 0,
    high: 0,
    enrichmentFailed: 0,
    fromCache: 0,
    limitReached: false,
  };

  if (!normalized.length) {
    console.info('[prospecting] fim sem resultados', { userId, ms: Date.now() - startedAt });
    yield { type: 'done', summary: emptySummary, searchId: null };
    return;
  }

  yield { type: 'progress', processed: 0, total: normalized.length };

  // Empresas ja conhecidas: evita reconsultar site e preserva decisoes manuais
  // sobre o Instagram (SPEC 3.3/18/37, SPEC 1.1 §11/§12).
  const placeIds = normalized.map((p) => p.google_place_id);
  const { data: existingRows, error: existingError } = await supabase
    .from('companies')
    .select(
      'id, google_place_id, instagram_url, instagram_handle, instagram_confidence, instagram_status, instagram_source, instagram_evidence, instagram_checked_at, last_checked_at',
    )
    .eq('user_id', userId)
    .in('google_place_id', placeIds);

  if (existingError) {
    console.error('[prospecting] falha ao carregar empresas existentes', { userId });
    yield { type: 'error', message: 'Nao foi possivel acessar os dados salvos. Tente novamente.' };
    return;
  }

  const existingByPlaceId = new Map(
    (existingRows ?? [])
      .filter((row) => row.google_place_id)
      .map((row) => [row.google_place_id as string, row]),
  );

  yield { type: 'stage', stage: 'digital_presence', message: STAGE_MESSAGES.digital_presence };

  let processed = 0;
  const outcomes = await mapWithConcurrency(
    normalized,
    ENRICHMENT_CONCURRENCY,
    async (place): Promise<EnrichmentOutcome> => {
      const existing = existingByPlaceId.get(place.google_place_id);

      const reuse = (): EnrichmentOutcome => ({
        instagram: {
          instagram_url: existing?.instagram_url ?? null,
          instagram_handle: existing?.instagram_handle ?? null,
          instagram_confidence: existing?.instagram_confidence ?? null,
          instagram_status: existing?.instagram_status ?? 'NOT_FOUND',
          instagram_source: existing?.instagram_source ?? null,
          instagram_evidence: existing?.instagram_evidence ?? [],
          instagram_checked_at: existing?.instagram_checked_at ?? null,
        },
        status: 'SKIPPED',
        error: null,
        fromCache: true,
      });

      // Decisao humana sempre vence a deteccao automatica.
      if (
        existing &&
        (existing.instagram_status === 'CONFIRMED' || existing.instagram_status === 'REJECTED')
      ) {
        return reuse();
      }

      // Cache: nao reconsulta quem foi verificado recentemente.
      if (existing && isFresh(existing.last_checked_at)) return reuse();

      try {
        const found = await discoverInstagram({
          name: place.name,
          category: place.category,
          city: place.city,
          state: place.state,
          phone: place.phone ?? place.phone_international,
          website: place.website,
          address: place.address,
        });
        return { instagram: found, status: 'OK', error: null, fromCache: false };
      } catch (error) {
        console.error('[prospecting] falha ao verificar presenca digital', {
          place: place.google_place_id,
          error: error instanceof Error ? error.message : 'desconhecido',
        });
        return {
          instagram: INSTAGRAM_NOT_FOUND,
          status: 'FAILED',
          error: 'Nao foi possivel verificar a presenca digital.',
          fromCache: false,
        };
      }
    },
    (done) => {
      processed = done;
    },
  );

  yield { type: 'progress', processed, total: normalized.length };
  yield { type: 'stage', stage: 'scoring', message: STAGE_MESSAGES.scoring };

  const rows = normalized.map((place, index) => buildCompanyRow(userId, place, outcomes[index]));

  yield { type: 'stage', stage: 'saving', message: STAGE_MESSAGES.saving };

  // Deduplicacao pelo par (user_id, google_place_id) (SPEC 18).
  const { data: savedRows, error: upsertError } = await supabase
    .from('companies')
    .upsert(rows, { onConflict: 'user_id,google_place_id' })
    .select('id, opportunity_level, website_status');

  if (upsertError) {
    console.error('[prospecting] falha ao salvar empresas', { userId, code: upsertError.code });
    yield { type: 'error', message: 'Nao foi possivel salvar os resultados. Tente novamente.' };
    return;
  }

  const saved = savedRows ?? [];
  const enrichmentFailed = outcomes.filter((o) => o.status === 'FAILED').length;
  const enriched = outcomes.filter((o) => o.status === 'OK').length;
  const fromCache = outcomes.filter((o) => o.fromCache).length;

  const excellent = saved.filter((r) => r.opportunity_level === 'EXCELENTE').length;
  const high = saved.filter((r) => r.opportunity_level === 'ALTA').length;

  const summary: ProspectingSummary = {
    // Falha parcial nunca e apresentada como sucesso (SPEC 1.1 §86).
    status: enrichmentFailed > 0 ? 'PARTIAL' : 'COMPLETED',
    found: normalized.length,
    saved: saved.length,
    newCompanies: normalized.length - existingByPlaceId.size,
    alreadyKnown: existingByPlaceId.size,
    withoutWebsite: saved.filter((r) => r.website_status === 'NO_WEBSITE_DETECTED').length,
    qualified: excellent + high,
    excellent,
    high,
    enrichmentFailed,
    fromCache,
    limitReached: places.length >= input.limit,
  };

  yield { type: 'stage', stage: 'done', message: STAGE_MESSAGES.done };

  // Registro da pesquisa + historico de onde cada empresa apareceu (SPEC 19/46/84).
  let searchId: string | null = null;
  const { data: searchRow, error: searchError } = await supabase
    .from('prospecting_searches')
    .insert({
      user_id: userId,
      query: textQuery,
      segment: input.segment,
      city: input.city,
      state: input.state || null,
      country,
      radius: input.radiusKm ?? null,
      filters: { segment: input.segment, limit: input.limit, radiusKm: input.radiusKm ?? null },
      status: summary.status,
      results_count: summary.found,
      qualified_count: summary.qualified,
      new_companies_count: summary.newCompanies,
      existing_companies_count: summary.alreadyKnown,
      high_opportunity_count: summary.high,
      excellent_opportunity_count: summary.excellent,
      without_website_count: summary.withoutWebsite,
      places_requested: input.limit,
      places_processed: summary.found,
      enrichment_count: enriched,
      enrichment_failed_count: enrichmentFailed,
    })
    .select('id')
    .single();

  if (searchError) {
    console.error('[prospecting] falha ao registrar a pesquisa', { userId });
    yield {
      type: 'warning',
      message: 'Os leads foram salvos, mas o historico da pesquisa nao pode ser gravado.',
    };
  } else {
    searchId = searchRow.id;
    const hits = saved.map((row) => ({
      user_id: userId,
      company_id: row.id,
      search_id: searchRow.id,
    }));
    if (hits.length) {
      const { error: hitsError } = await supabase
        .from('company_search_hits')
        .upsert(hits, { onConflict: 'company_id,search_id' });
      if (hitsError) console.error('[prospecting] falha ao gravar historico', { userId });
    }
  }

  console.info('[prospecting] fim', {
    userId,
    ms: Date.now() - startedAt,
    found: summary.found,
    saved: summary.saved,
    novas: summary.newCompanies,
    existentes: summary.alreadyKnown,
    enriquecidas: enriched,
    falhas: enrichmentFailed,
    status: summary.status,
  });

  yield { type: 'done', summary, searchId };
}

/**
 * Reprocessa apenas as empresas cujo enriquecimento falhou (SPEC 1.1 §87).
 * Nao repete a pesquisa no Google: usa os dados ja salvos.
 */
export async function reprocessFailedEnrichment(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ processed: number; recovered: number; stillFailing: number }> {
  const { data, error } = await supabase
    .from('companies')
    .select('*')
    .eq('user_id', userId)
    .eq('enrichment_status', 'FAILED')
    .limit(100);

  if (error || !data?.length) return { processed: 0, recovered: 0, stillFailing: 0 };

  const companies = data as Company[];
  let recovered = 0;
  let stillFailing = 0;

  await mapWithConcurrency(companies, ENRICHMENT_CONCURRENCY, async (company) => {
    let outcome: EnrichmentOutcome;
    try {
      const found = await discoverInstagram({
        name: company.name,
        category: company.category,
        city: company.city,
        state: company.state,
        phone: company.phone ?? company.phone_international,
        website: company.website,
        address: company.address,
      });
      outcome = { instagram: found, status: 'OK', error: null, fromCache: false };
      recovered += 1;
    } catch {
      outcome = {
        instagram: INSTAGRAM_NOT_FOUND,
        status: 'FAILED',
        error: 'Nao foi possivel verificar a presenca digital.',
        fromCache: false,
      };
      stillFailing += 1;
    }

    const row = buildCompanyRow(userId, companyToPlace(company), outcome);
    await supabase
      .from('companies')
      .update({
        instagram_url: row.instagram_url,
        instagram_handle: row.instagram_handle,
        instagram_confidence: row.instagram_confidence,
        instagram_status: row.instagram_status,
        instagram_source: row.instagram_source,
        instagram_evidence: row.instagram_evidence,
        instagram_checked_at: row.instagram_checked_at,
        opportunity_score: row.opportunity_score,
        opportunity_level: row.opportunity_level,
        score_breakdown: row.score_breakdown,
        google_business_quality: row.google_business_quality,
        next_action: row.next_action,
        next_action_reason: row.next_action_reason,
        enrichment_status: row.enrichment_status,
        enrichment_error: row.enrichment_error,
        last_checked_at: row.last_checked_at,
      })
      .eq('id', company.id)
      .eq('user_id', userId);
  });

  console.info('[prospecting] reprocessamento', {
    userId,
    processed: companies.length,
    recovered,
    stillFailing,
  });

  return { processed: companies.length, recovered, stillFailing };
}

/** Converte uma empresa salva de volta ao formato normalizado do Google. */
function companyToPlace(company: Company): NormalizedPlace {
  return {
    google_place_id: company.google_place_id ?? '',
    name: company.name,
    category: company.category,
    categories: company.categories,
    description: company.description,
    phone: company.phone,
    phone_international: company.phone_international,
    website: company.website,
    website_status: company.website_status,
    google_maps_url: company.google_maps_url,
    address: company.address,
    city: company.city,
    state: company.state,
    country: company.country,
    latitude: company.latitude,
    longitude: company.longitude,
    rating: company.rating,
    review_count: company.review_count,
    opening_hours: company.opening_hours,
    business_status: company.business_status,
  };
}
