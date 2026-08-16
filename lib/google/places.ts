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

/** Codigos de erro da API (SPEC 1.1 §55). */
export type GoogleErrorCode =
  | 'INVALID_ARGUMENT'
  | 'UNAUTHENTICATED'
  | 'PERMISSION_DENIED'
  | 'RESOURCE_EXHAUSTED'
  | 'NOT_FOUND'
  | 'INTERNAL'
  | 'NETWORK'
  | 'NOT_CONFIGURED';

/** Qual chamada gerou o erro — essencial para diagnosticar (SPEC 1.1 §57). */
export type GoogleApiName = 'places.searchText' | 'geocode';

/**
 * Diagnostico tecnico do erro: exatamente o que o Google respondeu.
 * Nunca contem a API key nem qualquer outro segredo.
 */
export type GoogleErrorDetail = {
  api: GoogleApiName;
  httpStatus: number;
  /** Campo `error.status` (Places) ou `status` (Geocoding) devolvido pelo Google. */
  googleStatus: string | null;
  /** Campo `error.message` (Places) ou `error_message` (Geocoding) devolvido pelo Google. */
  googleMessage: string | null;
};

/** Erro com mensagem pronta para o usuario final (SPEC 38 / SPEC 1.1 §55). */
export class GooglePlacesError extends Error {
  readonly code: GoogleErrorCode;
  readonly retryable: boolean;
  /** Diagnostico tecnico bruto do Google — ausente para NOT_CONFIGURED. */
  readonly detail: GoogleErrorDetail | null;

  constructor(code: GoogleErrorCode, message: string, detail: GoogleErrorDetail | null = null) {
    super(message);
    this.name = 'GooglePlacesError';
    this.code = code;
    // Apenas erros transitorios podem ser repetidos (SPEC 1.1 §56).
    this.retryable = code === 'INTERNAL' || code === 'NETWORK' || code === 'RESOURCE_EXHAUSTED';
    this.detail = detail;
  }
}

const ERROR_MESSAGES: Record<GoogleErrorCode, string> = {
  INVALID_ARGUMENT: 'A busca enviada nao foi aceita pelo Google. Revise cidade e segmento.',
  UNAUTHENTICATED: 'O Google recusou a chave de API. Verifique GOOGLE_MAPS_API_KEY.',
  PERMISSION_DENIED:
    'A chave nao tem permissao para esta API. Habilite a Places API (New) e a Geocoding API no Google Cloud.',
  RESOURCE_EXHAUSTED: 'Limite da API do Google atingido. Tente novamente mais tarde.',
  NOT_FOUND: 'O Google nao encontrou o recurso consultado.',
  INTERNAL: 'O Google respondeu com um erro temporario. Tente novamente em instantes.',
  NETWORK: 'Falha de rede ao consultar o Google. Verifique a conexao e tente novamente.',
  NOT_CONFIGURED:
    'A chave do Google Maps nao esta configurada. Defina GOOGLE_MAPS_API_KEY no ambiente.',
};

/** Remove a API key de qualquer texto antes de logar (SPEC 1.1 §57: nunca registrar segredos). */
function redactSecrets(text: string): string {
  const key = serverGoogleMapsKey();
  return key && text.includes(key) ? text.split(key).join('[REDACTED]') : text;
}

/** Extrai `error.status`/`error.message` do corpo JSON de erro da Places API (New). */
function parsePlacesErrorBody(body: string): { status: string | null; message: string | null } {
  try {
    const parsed = JSON.parse(body) as { error?: { status?: string; message?: string } };
    return {
      status: parsed.error?.status ?? null,
      message: parsed.error?.message ? redactSecrets(parsed.error.message) : null,
    };
  } catch {
    return { status: null, message: null };
  }
}

/**
 * Log tecnico estruturado (SPEC 1.1 §57): qual API, status HTTP, status/mensagem do Google.
 * Nunca inclui GOOGLE_MAPS_API_KEY nem qualquer outro segredo.
 */
function logGoogleApiError(detail: GoogleErrorDetail): void {
  console.error('[google-api] erro', {
    api: detail.api,
    httpStatus: detail.httpStatus,
    googleStatus: detail.googleStatus,
    googleMessage: detail.googleMessage,
  });
}

/** Traduz status HTTP + corpo da resposta da Places API (New) em um codigo conhecido. */
export function mapGoogleError(
  status: number,
  body: string,
  api: GoogleApiName = 'places.searchText',
): GooglePlacesError {
  const { status: googleStatus, message: googleMessage } = parsePlacesErrorBody(body);
  const upper = (googleStatus ?? body).toUpperCase();

  const detected: GoogleErrorCode | null =
    upper.includes('RESOURCE_EXHAUSTED') || status === 429
      ? 'RESOURCE_EXHAUSTED'
      : upper.includes('PERMISSION_DENIED') || status === 403
        ? 'PERMISSION_DENIED'
        : upper.includes('UNAUTHENTICATED') || status === 401
          ? 'UNAUTHENTICATED'
          : upper.includes('INVALID_ARGUMENT') || status === 400
            ? 'INVALID_ARGUMENT'
            : status === 404
              ? 'NOT_FOUND'
              : status >= 500
                ? 'INTERNAL'
                : null;

  const code = detected ?? 'INTERNAL';
  const detail: GoogleErrorDetail = { api, httpStatus: status, googleStatus, googleMessage };
  logGoogleApiError(detail);

  return new GooglePlacesError(code, ERROR_MESSAGES[code], detail);
}

/** Mapa dos status da Geocoding API (`data.status`) para os codigos internos (SPEC 1.1 §55). */
const GEOCODE_STATUS_TO_CODE: Partial<Record<string, GoogleErrorCode>> = {
  REQUEST_DENIED: 'PERMISSION_DENIED',
  OVER_QUERY_LIMIT: 'RESOURCE_EXHAUSTED',
  OVER_DAILY_LIMIT: 'RESOURCE_EXHAUSTED',
  INVALID_REQUEST: 'INVALID_ARGUMENT',
  UNKNOWN_ERROR: 'INTERNAL',
};

/**
 * Traduz o `status` (200 OK com corpo de erro — formato proprio da Geocoding API,
 * diferente do formato HTTP-error da Places API New) em um codigo conhecido.
 */
function mapGeocodeStatus(status: string, errorMessage: string | undefined): GooglePlacesError {
  const code = GEOCODE_STATUS_TO_CODE[status] ?? 'INTERNAL';
  const detail: GoogleErrorDetail = {
    api: 'geocode',
    httpStatus: 200,
    googleStatus: status,
    googleMessage: errorMessage ? redactSecrets(errorMessage) : null,
  };
  logGoogleApiError(detail);

  return new GooglePlacesError(code, ERROR_MESSAGES[code], detail);
}

/** Numero maximo de tentativas por chamada — nunca retry infinito (SPEC 1.1 §56). */
export const MAX_ATTEMPTS = 2;
const BACKOFF_BASE_MS = 500;

async function withRetry<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      const retryable = error instanceof GooglePlacesError && error.retryable;
      if (!retryable || attempt === MAX_ATTEMPTS) break;

      await new Promise((resolve) => setTimeout(resolve, BACKOFF_BASE_MS * 2 ** (attempt - 1)));
    }
  }

  throw lastError;
}

function requireKey(): string {
  const key = serverGoogleMapsKey();
  if (!key) {
    throw new GooglePlacesError(
      'NOT_CONFIGURED',
      'A chave do Google Maps nao esta configurada. Defina GOOGLE_MAPS_API_KEY no ambiente.',
    );
  }
  return key;
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

  const response = await withRetry(async () => {
    let res: Response;
    try {
      res = await fetch(url, { cache: 'no-store' });
    } catch (error) {
      const detail: GoogleErrorDetail = {
        api: 'geocode',
        httpStatus: 0,
        googleStatus: null,
        googleMessage: error instanceof Error ? redactSecrets(error.message) : 'falha de rede',
      };
      logGoogleApiError(detail);
      throw new GooglePlacesError('NETWORK', ERROR_MESSAGES.NETWORK, detail);
    }
    // A Geocoding API quase sempre responde 200; erros de permissao/quota vem no corpo (abaixo).
    if (!res.ok) throw mapGoogleError(res.status, await res.text(), 'geocode');
    return res;
  });

  const data = (await response.json()) as {
    status?: string;
    error_message?: string;
    results?: { geometry?: { location?: { lat?: number; lng?: number } } }[];
  };

  if (data.status === 'ZERO_RESULTS' || !data.results?.length) return null;

  if (data.status && data.status !== 'OK') {
    throw mapGeocodeStatus(data.status, data.error_message);
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

  const response = await withRetry(async () => {
    let res: Response;
    try {
      res = await fetch(TEXT_SEARCH_URL, {
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
      const detail: GoogleErrorDetail = {
        api: 'places.searchText',
        httpStatus: 0,
        googleStatus: null,
        googleMessage: error instanceof Error ? redactSecrets(error.message) : 'falha de rede',
      };
      logGoogleApiError(detail);
      throw new GooglePlacesError('NETWORK', ERROR_MESSAGES.NETWORK, detail);
    }
    if (!res.ok) throw mapGoogleError(res.status, await res.text(), 'places.searchText');
    return res;
  });

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
