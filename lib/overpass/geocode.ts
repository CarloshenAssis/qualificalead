import 'server-only';

import { nominatimApiUrl, osmUserAgent } from '@/lib/env';

/**
 * Geocodificacao de cidade via Nominatim (SPEC 1.2 §9/§10).
 *
 * Por que nao reaproveitar `geocodeLocation` de `lib/google/places.ts`:
 * aquela funcao usa a Geocoding API do Google, que exige exatamente a API key + billing
 * que a 1.2 quer eliminar (§18/§83). Alem disso ela devolve apenas um ponto, e o Overpass
 * precisa de uma **bounding box** da cidade (§9). Sao requisitos incompativeis, entao isto
 * e codigo novo por necessidade, nao duplicacao.
 *
 * O Nominatim exige User-Agent identificavel e pede uso comedido — dai o cache (§25).
 */

export type BoundingBox = {
  south: number;
  west: number;
  north: number;
  east: number;
};

export type GeocodedCity = {
  displayName: string;
  latitude: number;
  longitude: number;
  boundingBox: BoundingBox;
};

export type GeocodeErrorCode = 'NOT_FOUND' | 'RATE_LIMITED' | 'NETWORK' | 'INVALID_RESPONSE';

export class GeocodeError extends Error {
  readonly code: GeocodeErrorCode;

  constructor(code: GeocodeErrorCode, message: string) {
    super(message);
    this.name = 'GeocodeError';
    this.code = code;
  }
}

const TIMEOUT_MS = 10_000;

/** Nominatim devolve a bbox como `[south, north, west, east]`, em strings. */
export function parseBoundingBox(raw: unknown): BoundingBox | null {
  if (!Array.isArray(raw) || raw.length < 4) return null;

  const [south, north, west, east] = raw.map((value) => Number(value));
  if (![south, north, west, east].every((n) => Number.isFinite(n))) return null;

  // Uma bbox degenerada (ponto unico) nao serve para consultar uma area.
  if (south === north && west === east) return null;

  return { south, west, north, east };
}

type NominatimResult = {
  display_name?: string;
  lat?: string;
  lon?: string;
  boundingbox?: string[];
};

export async function geocodeCity(params: {
  city: string;
  state?: string | null;
  country?: string | null;
}): Promise<GeocodedCity> {
  const query = [params.city, params.state, params.country || 'Brasil']
    .filter(Boolean)
    .join(', ')
    .trim();

  const url = new URL(nominatimApiUrl());
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', '1');
  // Sem isso o Nominatim pode devolver ruas ou pontos de interesse no lugar da cidade.
  url.searchParams.set('featuretype', 'settlement');
  url.searchParams.set('addressdetails', '0');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': osmUserAgent(), Accept: 'application/json' },
      cache: 'no-store',
    });
  } catch (error) {
    const aborted = (error as Error).name === 'AbortError';
    throw new GeocodeError(
      'NETWORK',
      aborted
        ? 'A busca da cidade demorou demais. Tente novamente.'
        : 'Nao foi possivel localizar a cidade agora. Tente novamente.',
    );
  } finally {
    clearTimeout(timeout);
  }

  if (response.status === 429) {
    throw new GeocodeError(
      'RATE_LIMITED',
      'Limite de consultas de localizacao atingido. Aguarde alguns instantes.',
    );
  }

  if (!response.ok) {
    throw new GeocodeError('NETWORK', 'O servico de localizacao respondeu com erro.');
  }

  let data: NominatimResult[];
  try {
    data = (await response.json()) as NominatimResult[];
  } catch {
    throw new GeocodeError('INVALID_RESPONSE', 'Resposta invalida do servico de localizacao.');
  }

  const first = Array.isArray(data) ? data[0] : undefined;
  const boundingBox = parseBoundingBox(first?.boundingbox);
  const latitude = Number(first?.lat);
  const longitude = Number(first?.lon);

  if (!first || !boundingBox || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new GeocodeError(
      'NOT_FOUND',
      `Nao foi possivel localizar "${query}". Revise a cidade e o estado.`,
    );
  }

  return {
    displayName: first.display_name ?? query,
    latitude,
    longitude,
    boundingBox,
  };
}
