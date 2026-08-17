import 'server-only';

import { googlePlacesEnabled } from '@/lib/env';
import { GooglePlacesError, geocodeLocation, textSearch } from '@/lib/google/places';
import { normalizePlace, type NormalizedPlace } from '@/lib/google/mappers';
import type {
  ProspectingSearchParams,
  ProspectingSource,
  RawBusiness,
  SourceSearchResult,
} from './types';

/**
 * Fonte Google Places (SPEC 1.2 §5/§22/§74).
 *
 * Paga e desabilitada por padrao: so roda quando `GOOGLE_PLACES_ENABLED=true` (lib/env.ts)
 * *e* o modo de prospeccao a inclui (lib/prospecting/sources/registry.ts). Reaproveita
 * `geocodeLocation`/`textSearch`/`normalizePlace` inteiros — a chamada real ao Google e
 * exatamente a mesma auditada e validada na 1.1, apenas traduzida para `RawBusiness` no fim.
 */

export const GOOGLE_SOURCE_ID = 'GOOGLE_PLACES' as const;

/** Traducao 1:1, sem logica nova — preserva byte a byte o que a 1.1 ja calculava. */
function rawBusinessFromNormalizedPlace(place: NormalizedPlace): RawBusiness {
  return {
    source: GOOGLE_SOURCE_ID,
    sourceId: place.google_place_id,
    name: place.name,
    category: place.category ?? undefined,
    description: place.description ?? undefined,
    address: place.address ?? undefined,
    city: place.city ?? undefined,
    state: place.state ?? undefined,
    country: place.country ?? undefined,
    latitude: place.latitude ?? undefined,
    longitude: place.longitude ?? undefined,
    phone: place.phone ?? undefined,
    phoneInternational: place.phone_international ?? undefined,
    website: place.website ?? undefined,
    categories: place.categories ?? undefined,
    rating: place.rating ?? undefined,
    reviewCount: place.review_count ?? undefined,
    openingHours: place.opening_hours ?? undefined,
    businessStatus: place.business_status ?? undefined,
    sourceUrl: place.google_maps_url ?? undefined,
    metadata: { provider: 'google_places_v1' },
  };
}

async function search(params: ProspectingSearchParams): Promise<SourceSearchResult> {
  const startedAt = Date.now();
  const warnings: string[] = [];
  const limit = params.limit ?? 60;

  const country = params.countryCode?.trim() || 'Brasil';
  const locationLabel = [params.city, params.state, country].filter(Boolean).join(', ');
  const textQuery = `${params.query} em ${locationLabel}`;

  let center: { latitude: number; longitude: number } | null = null;
  if (params.radiusMeters) {
    center = await geocodeLocation({ city: params.city, state: params.state, country });
    if (!center) {
      warnings.push('Nao foi possivel localizar a regiao; a busca seguiu sem o filtro de raio.');
    }
  }

  const places = await textSearch({
    textQuery,
    center,
    radiusMeters: params.radiusMeters ?? null,
    limit,
  });

  const businesses = places
    .map(normalizePlace)
    .filter((place): place is NormalizedPlace => place !== null)
    .map(rawBusinessFromNormalizedPlace);

  return {
    source: GOOGLE_SOURCE_ID,
    businesses,
    totalFound: businesses.length,
    metrics: {
      requested: limit,
      returned: businesses.length,
      durationMs: Date.now() - startedAt,
      cacheHit: false,
    },
    warnings,
  };
}

export const googlePlacesSource: ProspectingSource = {
  id: GOOGLE_SOURCE_ID,
  name: 'Google Places',
  type: 'PAID',
  // Reavaliado a cada leitura: nunca fica ligado so porque um modulo foi importado antes
  // de a flag mudar (SPEC 1.2 §22 — fonte paga exige opt-in explicito e vivo).
  get enabled() {
    return googlePlacesEnabled();
  },
  search,
};

export { GooglePlacesError };
