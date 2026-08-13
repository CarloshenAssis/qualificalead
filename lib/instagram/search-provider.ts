import 'server-only';

import type { CompanySignals, InstagramCandidate } from './shared';
import { SOURCE_WEB_SEARCH, extractInstagramHandles } from './shared';

/**
 * Busca de perfis via **Google Programmable Search JSON API** (SPEC 1.1 §20).
 *
 * E uma API oficial e paga por consulta, entao:
 *   - so e usada quando explicitamente configurada;
 *   - so e chamada quando o site oficial nao resolveu;
 *   - devolve candidatos, nunca uma associacao pronta.
 *
 * Nao ha scraping do Instagram, login automatizado nem tentativa de burlar anti-bot.
 */

const ENDPOINT = 'https://www.googleapis.com/customsearch/v1';
const TIMEOUT_MS = 6_000;
const MAX_RESULTS = 5;

export function instagramSearchConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CSE_ID?.trim() && process.env.GOOGLE_CSE_API_KEY?.trim());
}

type CseResponse = {
  items?: { title?: string; link?: string; snippet?: string }[];
  error?: { code?: number; message?: string };
};

export async function searchInstagramCandidates(
  company: CompanySignals,
): Promise<InstagramCandidate[]> {
  const cx = process.env.GOOGLE_CSE_ID?.trim();
  const key = process.env.GOOGLE_CSE_API_KEY?.trim();
  if (!cx || !key) return [];

  const location = [company.city, company.state].filter(Boolean).join(' ');
  const query = `site:instagram.com "${company.name}" ${location}`.trim();

  const url = new URL(ENDPOINT);
  url.searchParams.set('key', key);
  url.searchParams.set('cx', cx);
  url.searchParams.set('q', query);
  url.searchParams.set('num', String(MAX_RESULTS));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(url, { signal: controller.signal, cache: 'no-store' });
    if (!response.ok) {
      console.error('[instagram-search] resposta nao ok', { status: response.status });
      return [];
    }

    const data = (await response.json()) as CseResponse;
    if (data.error) {
      console.error('[instagram-search] erro da API', { code: data.error.code });
      return [];
    }

    const candidates: InstagramCandidate[] = [];

    for (const item of data.items ?? []) {
      const [handle] = extractInstagramHandles(item.link ?? '');
      if (!handle) continue;
      if (candidates.some((c) => c.handle === handle)) continue;

      candidates.push({
        handle,
        // O contexto publico alimenta os sinais de cidade/telefone/categoria.
        context: [item.title, item.snippet].filter(Boolean).join(' '),
        source: SOURCE_WEB_SEARCH,
      });
    }

    return candidates;
  } catch (error) {
    if ((error as Error).name !== 'AbortError') {
      console.error('[instagram-search] falha de rede', {
        error: error instanceof Error ? error.message : 'desconhecido',
      });
    }
    return [];
  } finally {
    clearTimeout(timeout);
  }
}
