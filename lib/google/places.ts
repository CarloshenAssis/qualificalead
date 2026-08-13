import 'server-only';

import { googleLanguageCode, googleRegionCode, serverGoogleMapsKey } from '@/lib/env';

/**
 * Cliente da Places API (New) — endpoint oficial `places.googleapis.com/v1`.
 * Sem scraping (SPEC 7.1). A chave nunca sai do servidor (SPEC 33).
 */

const TEXT_SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText';
const GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json';

/** A API devolve no maximo 20 resultados por pagina e 3 paginas por consulta. */
export const PAGE_SIZE = 20;
export const MAX_PAGES = 3;

const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.shortFormattedAddress',
  'places.addressComponents',
  'places.location',
  'places.types',
  'places.primaryType',
  'places.primaryTypeDisplayName',
  'places.nationalPhoneNumber',
  'places.internationalPhoneNumber',
  'places.websiteUri',
  'places.googleMapsUri',
  'places.rating',
  'places.userRatingCount',
  'places.businessStatus',
  'places.regularOpeningHours.weekdayDescriptions',
  'places.editorialSummary',
  'nextPageToken',
].join(',');

export type GoogleAddressComponent = {
  longText?: string;
  shortText?: string;
  types?: string[];
};

export type GooglePlace = {
  id: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  shortFormattedAddress?: string;
  addressComponents?: GoogleAddressComponent[];
  location?: { latitude?: number; longitude?: number };
  types?: string[];
  primaryType?: string;
  primaryTypeDisplayName?: { text?: string };
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  websiteUri?: string;
  googleMapsUri?: string;
  rating?: number;
  userRatingCount?: number;
  businessStatus?: string;
  regularOpeningHours?: { weekdayDescriptions?: string[] };
  editorialSummary?: { text?: string };
};

export type LatLng = { latitude: number; longitude: number };

/** Erro com mensagem pronta para o usuario final (SPEC 38). */
export class GooglePlacesError extends Error {
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'GooglePlacesError';
    this.cause = cause;
  }
}

function requireKey(): string {
  const key = serverGoogleMapsKey();
  if (!key) {
    throw new GooglePlacesError(
      'A chave do Google Maps nao esta configurada. Defina GOOGLE_MAPS_API_KEY no ambiente.',
    );
  }
  return key;
}

function friendlyHttpError(status: number, body: string): GooglePlacesError {
  if (status === 400) {
    return new GooglePlacesError('A busca enviada nao foi aceita pelo Google. Revise os campos.', body);
  }
  if (status === 401 || status === 403) {
    return new GooglePlacesError(
      'O Google recusou a chave de API. Verifique se a Places API (New) esta habilitada e se a chave tem permissao.',
      body,
    );
  }
  if (status === 429) {
    return new GooglePlacesError(
      'Limite de consultas do Google atingido. Aguarde alguns instantes e tente novamente.',
      body,
    );
  }
  return new GooglePlacesError(
    'Nao foi possivel consultar o Google agora. Tente novamente em instantes.',
    body,
  );
}

/** Converte cidade/estado/pais em coordenadas (Geocoding API). */
export async function geocodeLocation(params: {
  city?: string | null;
  state?: string | null;
  country?: string | null;
}): Promise<LatLng | null> {
  const address = [params.city, params.state, params.country].filter(Boolean).join(', ').trim();
  if (!address) return null;

  const url = new URL(GEOCODE_URL);
  url.searchParams.set('address', address);
  url.searchParams.set('key', requireKey());
  url.searchParams.set('language', googleLanguageCode());

  let response: Response;
  try {
    response = await fetch(url, { cache: 'no-store' });
  } catch (error) {
    throw new GooglePlacesError('Falha de rede ao localizar a cidade informada.', error);
  }

  if (!response.ok) {
    throw friendlyHttpError(response.status, await response.text());
  }

  const data = (await response.json()) as {
    status?: string;
    results?: { geometry?: { location?: { lat?: number; lng?: number } } }[];
  };

  if (data.status === 'ZERO_RESULTS' || !data.results?.length) return null;

  if (data.status !== 'OK') {
    throw new GooglePlacesError('Nao foi possivel localizar a cidade informada.', data.status);
  }

  const loc = data.results[0]?.geometry?.location;
  if (typeof loc?.lat !== 'number' || typeof loc?.lng !== 'number') return null;

  return { latitude: loc.lat, longitude: loc.lng };
}

export type TextSearchParams = {
  /** Consulta livre, ex.: "restaurantes em Sao Jose dos Campos". */
  textQuery: string;
  /** Centro opcional para restringir a busca. */
  center?: LatLng | null;
  /** Raio em metros (aplicado apenas quando ha centro). */
  radiusMeters?: number | null;
  /** Limite de resultados desejado; a API entrega no maximo PAGE_SIZE * MAX_PAGES. */
  limit?: number;
  /** Callback de progresso por pagina consultada. */
  onPage?: (info: { page: number; received: number; total: number }) => void;
};

/** Uma pagina de Text Search. */
async function fetchTextSearchPage(
  params: TextSearchParams,
  pageToken: string | null,
): Promise<{ places: GooglePlace[]; nextPageToken: string | null }> {
  const body: Record<string, unknown> = {
    textQuery: params.textQuery,
    pageSize: PAGE_SIZE,
    languageCode: googleLanguageCode(),
    regionCode: googleRegionCode(),
  };

  if (pageToken) body.pageToken = pageToken;

  if (params.center && params.radiusMeters && params.radiusMeters > 0) {
    body.locationBias = {
      circle: {
        center: { latitude: params.center.latitude, longitude: params.center.longitude },
        // A API aceita raio entre 0 e 50.000 metros.
        radius: Math.min(params.radiusMeters, 50_000),
      },
    };
  }

  let response: Response;
  try {
    response = await fetch(TEXT_SEARCH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': requireKey(),
        'X-Goog-FieldMask': FIELD_MASK,
      },
      body: JSON.stringify(body),
      cache: 'no-store',
    });
  } catch (error) {
    throw new GooglePlacesError('Falha de rede ao consultar o Google. Tente novamente.', error);
  }

  if (!response.ok) {
    throw friendlyHttpError(response.status, await response.text());
  }

  const data = (await response.json()) as { places?: GooglePlace[]; nextPageToken?: string };

  return { places: data.places ?? [], nextPageToken: data.nextPageToken ?? null };
}

/**
 * Text Search com paginacao controlada.
 * O numero de paginas e limitado por MAX_PAGES para nunca gerar loop infinito (SPEC 37).
 */
export async function textSearch(params: TextSearchParams): Promise<GooglePlace[]> {
  const limit = params.limit ?? PAGE_SIZE * MAX_PAGES;
  const collected: GooglePlace[] = [];
  const seen = new Set<string>();

  let pageToken: string | null = null;

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const result: { places: GooglePlace[]; nextPageToken: string | null } =
      await fetchTextSearchPage(params, pageToken);

    for (const place of result.places) {
      if (!place.id || seen.has(place.id)) continue;
      seen.add(place.id);
      collected.push(place);
    }

    params.onPage?.({ page, received: result.places.length, total: collected.length });

    pageToken = result.nextPageToken;
    if (!pageToken || collected.length >= limit) break;
  }

  return collected.slice(0, limit);
}
