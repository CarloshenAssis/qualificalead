import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Company, CompanyUpsert } from '@/types/database';
import type { ProspectingSearchInput } from '@/lib/validation/schemas';
import { GooglePlacesError, geocodeLocation, textSearch } from '@/lib/google/places';
import { buildDedupKey, normalizePlace, type NormalizedPlace } from '@/lib/google/mappers';
import { discoverInstagram, NOT_FOUND as INSTAGRAM_NOT_FOUND } from '@/lib/instagram/discover';
import { computeOpportunityScore } from '@/lib/scoring/score';
import { normalizePhone } from '@/lib/whatsapp/phone';
import { defaultPhoneCountryCode } from '@/lib/env';

/**
 * Orquestracao da prospeccao (SPEC 43, fases 3 e 4):
 * busca -> normalizacao -> deduplicacao -> presenca digital -> score -> persistencia.
 *
 * Emite eventos de progresso para a interface nunca parecer travada (SPEC 22/39).
 */

/** Dias antes de reconsultar a presenca digital de uma empresa ja conhecida (SPEC 37). */
export const DIGITAL_PRESENCE_TTL_DAYS = 14;

/** Requisicoes simultaneas ao verificar sites — protege a maquina e os sites alvo. */
const ENRICHMENT_CONCURRENCY = 5;

export type ProspectingStage =
  | 'searching'
  | 'processing'
  | 'digital_presence'
  | 'scoring'
  | 'saving'
  | 'done';

export const STAGE_MESSAGES: Record<ProspectingStage, string> = {
  searching: 'Consultando empresas...',
  processing: 'Processando resultados...',
  digital_presence: 'Verificando presenca digital...',
  scoring: 'Calculando oportunidades...',
  saving: 'Finalizando...',
  done: 'Pesquisa concluida.',
};

export type ProspectingSummary = {
  found: number;
  saved: number;
  newCompanies: number;
  alreadyKnown: number;
  withoutWebsite: number;
  excellent: number;
  high: number;
};

export type ProspectingEvent =
  | { type: 'stage'; stage: ProspectingStage; message: string }
  | { type: 'progress'; processed: number; total: number }
  | { type: 'warning'; message: string }
  | { type: 'error'; message: string }
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

function isFresh(lastCheckedAt: string | null): boolean {
  if (!lastCheckedAt) return false;
  const checked = new Date(lastCheckedAt).getTime();
  if (Number.isNaN(checked)) return false;
  return Date.now() - checked < DIGITAL_PRESENCE_TTL_DAYS * 24 * 60 * 60 * 1000;
}

/** Monta a linha final de `companies` a partir dos dados coletados. */
function buildCompanyRow(
  userId: string,
  place: NormalizedPlace,
  instagram: {
    instagram_url: string | null;
    instagram_handle: string | null;
    instagram_confidence: number | null;
    instagram_status: Company['instagram_status'];
  },
): CompanyUpsert {
  const score = computeOpportunityScore({
    website_status: place.website_status,
    rating: place.rating,
    review_count: place.review_count,
    phone: place.phone ?? place.phone_international,
    instagram_url: instagram.instagram_status === 'REJECTED' ? null : instagram.instagram_url,
    instagram_confidence: instagram.instagram_confidence,
    business_status: place.business_status,
    address: place.address,
    category: place.category,
    opening_hours: place.opening_hours,
    description: place.description,
    google_maps_url: place.google_maps_url,
  });

  return {
    user_id: userId,
    google_place_id: place.google_place_id,
    name: place.name,
    category: place.category,
    categories: place.categories,
    description: place.description,
    phone: place.phone,
    phone_international: place.phone_international,
    whatsapp: normalizePhone(place.phone_international ?? place.phone, defaultPhoneCountryCode()),
    website: place.website,
    website_status: place.website_status,
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
    opportunity_score: score.score,
    opportunity_level: score.level,
    score_breakdown: score.breakdown,
    source_data: { provider: 'google_places_v1' },
    dedup_key: buildDedupKey({
      name: place.name,
      phone: place.phone,
      address: place.address,
      latitude: place.latitude,
      longitude: place.longitude,
    }),
    last_checked_at: new Date().toISOString(),
  };
}

export async function* runProspecting(
  supabase: SupabaseClient,
  userId: string,
  input: ProspectingSearchInput,
): AsyncGenerator<ProspectingEvent> {
  const country = input.country?.trim() || 'Brasil';
  const locationLabel = [input.city, input.state, country].filter(Boolean).join(', ');
  const textQuery = `${input.segment} em ${locationLabel}`;

  yield { type: 'stage', stage: 'searching', message: STAGE_MESSAGES.searching };

  let places: Awaited<ReturnType<typeof textSearch>>;
  try {
    const center = input.radiusKm
      ? await geocodeLocation({ city: input.city, state: input.state, country })
      : null;

    places = await textSearch({
      textQuery,
      center,
      radiusMeters: input.radiusKm ? input.radiusKm * 1000 : null,
      limit: input.limit,
    });
  } catch (error) {
    const message =
      error instanceof GooglePlacesError
        ? error.message
        : 'Nao foi possivel consultar as empresas agora. Tente novamente.';
    console.error('[prospecting] falha na busca', error);
    yield { type: 'error', message };
    return;
  }

  yield { type: 'stage', stage: 'processing', message: STAGE_MESSAGES.processing };

  const normalized = places
    .map(normalizePlace)
    .filter((place): place is NormalizedPlace => place !== null);

  if (!normalized.length) {
    yield {
      type: 'done',
      searchId: null,
      summary: {
        found: 0,
        saved: 0,
        newCompanies: 0,
        alreadyKnown: 0,
        withoutWebsite: 0,
        excellent: 0,
        high: 0,
      },
    };
    return;
  }

  yield { type: 'progress', processed: 0, total: normalized.length };

  // Empresas que este usuario ja conhece — evita reconsultar site e preserva
  // decisoes manuais sobre o Instagram (SPEC 3.3/18/37).
  const placeIds = normalized.map((p) => p.google_place_id);
  const { data: existingRows, error: existingError } = await supabase
    .from('companies')
    .select(
      'id, google_place_id, instagram_url, instagram_handle, instagram_confidence, instagram_status, last_checked_at',
    )
    .eq('user_id', userId)
    .in('google_place_id', placeIds);

  if (existingError) {
    console.error('[prospecting] falha ao carregar empresas existentes', existingError);
    yield { type: 'error', message: 'Nao foi possivel acessar os dados salvos. Tente novamente.' };
    return;
  }

  const existingByPlaceId = new Map(
    (existingRows ?? [])
      .filter((row) => row.google_place_id)
      .map((row) => [row.google_place_id as string, row]),
  );

  yield { type: 'stage', stage: 'digital_presence', message: STAGE_MESSAGES.digital_presence };

  let lastReported = 0;
  const instagramResults = await mapWithConcurrency(
    normalized,
    ENRICHMENT_CONCURRENCY,
    async (place) => {
      const existing = existingByPlaceId.get(place.google_place_id);

      // Decisao humana sempre vence a deteccao automatica.
      if (existing && (existing.instagram_status === 'CONFIRMED' || existing.instagram_status === 'REJECTED')) {
        return {
          instagram_url: existing.instagram_url,
          instagram_handle: existing.instagram_handle,
          instagram_confidence: existing.instagram_confidence,
          instagram_status: existing.instagram_status as Company['instagram_status'],
        };
      }

      // Cache: nao reconsulta o site de quem foi verificado recentemente.
      if (existing && isFresh(existing.last_checked_at)) {
        return {
          instagram_url: existing.instagram_url,
          instagram_handle: existing.instagram_handle,
          instagram_confidence: existing.instagram_confidence,
          instagram_status: existing.instagram_status as Company['instagram_status'],
        };
      }

      try {
        const found = await discoverInstagram({ name: place.name, website: place.website });
        return {
          instagram_url: found.instagram_url,
          instagram_handle: found.instagram_handle,
          instagram_confidence: found.instagram_confidence,
          instagram_status: found.instagram_status,
        };
      } catch (error) {
        console.error('[prospecting] falha ao verificar presenca digital', error);
        return INSTAGRAM_NOT_FOUND;
      }
    },
    (done) => {
      lastReported = done;
    },
  );

  yield { type: 'progress', processed: lastReported, total: normalized.length };
  yield { type: 'stage', stage: 'scoring', message: STAGE_MESSAGES.scoring };

  const rows = normalized.map((place, index) => buildCompanyRow(userId, place, instagramResults[index]));

  yield { type: 'stage', stage: 'saving', message: STAGE_MESSAGES.saving };

  // Deduplicacao pelo par (user_id, google_place_id) (SPEC 18).
  const { data: savedRows, error: upsertError } = await supabase
    .from('companies')
    .upsert(rows, { onConflict: 'user_id,google_place_id' })
    .select('id, opportunity_level, website_status');

  if (upsertError) {
    console.error('[prospecting] falha ao salvar empresas', upsertError);
    yield { type: 'error', message: 'Nao foi possivel salvar os resultados. Tente novamente.' };
    return;
  }

  const saved = savedRows ?? [];
  const summary: ProspectingSummary = {
    found: normalized.length,
    saved: saved.length,
    newCompanies: normalized.length - existingByPlaceId.size,
    alreadyKnown: existingByPlaceId.size,
    withoutWebsite: saved.filter((r) => r.website_status === 'NO_WEBSITE_DETECTED').length,
    excellent: saved.filter((r) => r.opportunity_level === 'EXCELENTE').length,
    high: saved.filter((r) => r.opportunity_level === 'ALTA').length,
  };

  // Registro da pesquisa + historico de onde cada empresa apareceu (SPEC 19).
  let searchId: string | null = null;
  const { data: searchRow, error: searchError } = await supabase
    .from('prospecting_searches')
    .insert({
      user_id: userId,
      query: textQuery,
      city: input.city,
      state: input.state || null,
      country,
      radius: input.radiusKm ?? null,
      filters: { segment: input.segment, limit: input.limit },
      results_count: summary.found,
      qualified_count: summary.excellent + summary.high,
    })
    .select('id')
    .single();

  if (searchError) {
    console.error('[prospecting] falha ao registrar a pesquisa', searchError);
    yield { type: 'warning', message: 'Os leads foram salvos, mas o historico da pesquisa nao pode ser gravado.' };
  } else {
    searchId = searchRow.id;
    const hits = saved.map((row) => ({ user_id: userId, company_id: row.id, search_id: searchRow.id }));
    if (hits.length) {
      const { error: hitsError } = await supabase
        .from('company_search_hits')
        .upsert(hits, { onConflict: 'company_id,search_id' });
      if (hitsError) console.error('[prospecting] falha ao gravar historico', hitsError);
    }
  }

  yield { type: 'done', summary, searchId };
}
