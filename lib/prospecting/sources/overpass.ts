import 'server-only';

import { overpassTimeoutMs } from '@/lib/env';
import { GeocodeError, geocodeCity, type BoundingBox } from '@/lib/overpass/geocode';
import { buildOverpassQuery } from '@/lib/overpass/queries';
import { OverpassError, runOverpassQuery } from '@/lib/overpass/client';
import { osmElementToRawBusiness } from '@/lib/overpass/mapping';
import type {
  ProspectingSearchParams,
  ProspectingSource,
  RawBusiness,
  SourceSearchResult,
} from './types';

/**
 * Fonte OpenStreetMap (SPEC 1.2 §7).
 * Gratuita e sempre habilitada: e a base do FREE MODE (§74).
 */

/** Converte um raio em metros numa bbox aproximada, para buscas centradas em um ponto. */
export function boundingBoxFromRadius(
  latitude: number,
  longitude: number,
  radiusMeters: number,
): BoundingBox {
  const latDelta = radiusMeters / 111_320;
  // A distancia de um grau de longitude encolhe conforme a latitude se afasta do equador.
  const cos = Math.cos((latitude * Math.PI) / 180);
  const lonDelta = radiusMeters / (111_320 * (Math.abs(cos) < 0.01 ? 0.01 : cos));

  return {
    south: latitude - latDelta,
    north: latitude + latDelta,
    west: longitude - lonDelta,
    east: longitude + lonDelta,
  };
}

export const OVERPASS_SOURCE_ID = 'OPENSTREETMAP' as const;

async function search(params: ProspectingSearchParams): Promise<SourceSearchResult> {
  const startedAt = Date.now();
  const warnings: string[] = [];
  const limit = params.limit ?? 100;

  let boundingBox: BoundingBox;

  // Raio explicito em torno de um ponto dispensa geocodificar a cidade.
  if (
    typeof params.latitude === 'number' &&
    typeof params.longitude === 'number' &&
    params.radiusMeters
  ) {
    boundingBox = boundingBoxFromRadius(params.latitude, params.longitude, params.radiusMeters);
  } else {
    const city = await geocodeCity({
      city: params.city,
      state: params.state,
      country: params.countryCode,
    });
    boundingBox = city.boundingBox;
  }

  const { ql, resolution } = buildOverpassQuery({
    query: params.query,
    boundingBox,
    limit,
    timeoutSeconds: Math.floor(overpassTimeoutMs() / 1000),
  });

  // O usuario precisa saber que a busca caiu no modo por nome (SPEC 1.2 §12).
  if (resolution.kind === 'NAME_SEARCH') {
    warnings.push(
      `O termo "${params.query}" nao tem mapeamento de categoria no OpenStreetMap; a busca foi feita por nome e pode trazer menos resultados.`,
    );
  }

  const elements = await runOverpassQuery(ql);

  const businesses: RawBusiness[] = [];
  const seen = new Set<string>();

  for (const element of elements) {
    const business = osmElementToRawBusiness(element);
    if (!business) continue;
    if (seen.has(business.sourceId)) continue;
    seen.add(business.sourceId);
    businesses.push(business);
  }

  return {
    source: OVERPASS_SOURCE_ID,
    businesses: businesses.slice(0, limit),
    totalFound: businesses.length,
    metrics: {
      requested: limit,
      returned: Math.min(businesses.length, limit),
      durationMs: Date.now() - startedAt,
      cacheHit: false,
    },
    warnings,
  };
}

export const openStreetMapSource: ProspectingSource = {
  id: OVERPASS_SOURCE_ID,
  name: 'OpenStreetMap',
  type: 'FREE',
  // Gratuita e sem credencial: nao ha motivo para desligar por padrao.
  enabled: true,
  search,
};

export { GeocodeError, OverpassError };
