import 'server-only';

import { osmUserAgent, overpassApiUrl, overpassTimeoutMs } from '@/lib/env';
import type { OverpassElement } from './mapping';

/**
 * Cliente HTTP do Overpass (SPEC 1.2 §26/§78/§79).
 *
 * O Overpass e um servico publico e gratuito, mantido por doacao: por isso timeout curto,
 * no maximo duas tentativas e backoff. Erro de configuracao nunca e repetido.
 */

export type OverpassErrorCode =
  | 'RATE_LIMITED'
  | 'TIMEOUT'
  | 'SERVER_ERROR'
  | 'BAD_REQUEST'
  | 'NETWORK'
  | 'INVALID_RESPONSE';

export class OverpassError extends Error {
  readonly code: OverpassErrorCode;
  readonly retryable: boolean;
  readonly httpStatus: number | null;

  constructor(code: OverpassErrorCode, message: string, httpStatus: number | null = null) {
    super(message);
    this.name = 'OverpassError';
    this.code = code;
    // 429 e 5xx sao transitorios; requisicao malformada nunca melhora repetindo.
    this.retryable = code === 'RATE_LIMITED' || code === 'SERVER_ERROR' || code === 'TIMEOUT';
    this.httpStatus = httpStatus;
  }
}

export const OVERPASS_MESSAGES: Record<OverpassErrorCode, string> = {
  RATE_LIMITED:
    'O servidor gratuito do OpenStreetMap esta ocupado no momento. Aguarde alguns instantes e tente novamente.',
  TIMEOUT: 'A consulta ao OpenStreetMap demorou demais. Tente uma area menor ou um limite menor.',
  SERVER_ERROR: 'O servidor do OpenStreetMap respondeu com erro temporario. Tente novamente.',
  BAD_REQUEST: 'A consulta enviada ao OpenStreetMap nao foi aceita.',
  NETWORK: 'Falha de rede ao consultar o OpenStreetMap.',
  INVALID_RESPONSE: 'O OpenStreetMap devolveu uma resposta inesperada.',
};

/** Nunca mais que isto — retry infinito e proibido (SPEC 1.2 §26). */
export const MAX_ATTEMPTS = 2;
const BACKOFF_BASE_MS = 1_000;

function logOverpassError(error: OverpassError, durationMs: number): void {
  console.error('[overpass] erro', {
    code: error.code,
    httpStatus: error.httpStatus,
    durationMs,
  });
}

async function requestOnce(ql: string): Promise<OverpassElement[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), overpassTimeoutMs());
  const startedAt = Date.now();

  try {
    let response: Response;
    try {
      response = await fetch(overpassApiUrl(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': osmUserAgent(),
          Accept: 'application/json',
        },
        body: new URLSearchParams({ data: ql }).toString(),
        signal: controller.signal,
        cache: 'no-store',
      });
    } catch (error) {
      const aborted = (error as Error).name === 'AbortError';
      const code: OverpassErrorCode = aborted ? 'TIMEOUT' : 'NETWORK';
      const overpassError = new OverpassError(code, OVERPASS_MESSAGES[code]);
      logOverpassError(overpassError, Date.now() - startedAt);
      throw overpassError;
    }

    if (!response.ok) {
      const code: OverpassErrorCode =
        response.status === 429
          ? 'RATE_LIMITED'
          : response.status === 400
            ? 'BAD_REQUEST'
            : response.status >= 500
              ? 'SERVER_ERROR'
              : 'SERVER_ERROR';

      const error = new OverpassError(code, OVERPASS_MESSAGES[code], response.status);
      logOverpassError(error, Date.now() - startedAt);
      throw error;
    }

    let data: { elements?: OverpassElement[] };
    try {
      data = (await response.json()) as { elements?: OverpassElement[] };
    } catch {
      const error = new OverpassError('INVALID_RESPONSE', OVERPASS_MESSAGES.INVALID_RESPONSE);
      logOverpassError(error, Date.now() - startedAt);
      throw error;
    }

    return Array.isArray(data.elements) ? data.elements : [];
  } finally {
    clearTimeout(timeout);
  }
}

/** Executa a query com retry limitado apenas para erros transitorios. */
export async function runOverpassQuery(ql: string): Promise<OverpassElement[]> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await requestOnce(ql);
    } catch (error) {
      lastError = error;

      const retryable = error instanceof OverpassError && error.retryable;
      if (!retryable || attempt === MAX_ATTEMPTS) break;

      await new Promise((resolve) => setTimeout(resolve, BACKOFF_BASE_MS * 2 ** (attempt - 1)));
    }
  }

  throw lastError;
}
