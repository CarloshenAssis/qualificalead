import 'server-only';

import type { InstagramStatus } from '@/types/database';

/**
 * Descoberta de Instagram a partir de fonte confiavel (SPEC 10).
 *
 * Regra do produto: o sistema NUNCA assume que `@nomedaempresa` pertence a empresa.
 * A unica fonte tratada como confiavel aqui e o proprio site oficial informado pelo
 * Google — se o link esta publicado no site da empresa, a associacao e observavel.
 * Quando nao ha site, o resultado e `NOT_FOUND` e o usuario pode preencher a mao.
 */

/** Caminhos do instagram.com que nao sao perfis. */
const RESERVED_PATHS = new Set([
  'p',
  'reel',
  'reels',
  'stories',
  'explore',
  'accounts',
  'about',
  'developer',
  'directory',
  'legal',
  'privacy',
  'terms',
  'tv',
  'sharer',
  'share',
  'web',
  'help',
]);

const FETCH_TIMEOUT_MS = 6_000;
const MAX_HTML_BYTES = 512 * 1024;

export type InstagramDiscovery = {
  instagram_url: string | null;
  instagram_handle: string | null;
  instagram_confidence: number | null;
  instagram_status: InstagramStatus;
  /** Explicacao curta de onde o dado veio — exibida na ficha da empresa. */
  source: string | null;
};

export const NOT_FOUND: InstagramDiscovery = {
  instagram_url: null,
  instagram_handle: null,
  instagram_confidence: null,
  instagram_status: 'NOT_FOUND',
  source: null,
};

function normalizeToken(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

/** Extrai handles de instagram.com de um HTML. */
export function extractInstagramHandles(html: string): string[] {
  const pattern = /https?:\/\/(?:www\.)?instagram\.com\/([A-Za-z0-9_.]+)/g;
  const handles: string[] = [];

  for (const match of html.matchAll(pattern)) {
    const handle = match[1]?.replace(/\.+$/, '');
    if (!handle) continue;
    if (RESERVED_PATHS.has(handle.toLowerCase())) continue;
    if (handle.length < 2) continue;
    if (!handles.includes(handle)) handles.push(handle);
  }

  return handles;
}

/**
 * Grau de semelhanca entre handle e nome da empresa (0 a 1).
 * Usado apenas para calibrar confianca — nunca para inventar um handle.
 */
export function handleNameAffinity(handle: string, businessName: string): number {
  const h = normalizeToken(handle);
  const n = normalizeToken(businessName);
  if (!h || !n) return 0;
  if (h === n) return 1;
  if (n.includes(h) || h.includes(n)) return 0.8;

  const tokens = businessName
    .split(/\s+/)
    .map(normalizeToken)
    .filter((t) => t.length >= 3);

  if (!tokens.length) return 0;

  const matched = tokens.filter((t) => h.includes(t)).length;
  return matched / tokens.length;
}

export const CONFIDENCE = {
  /** Link unico publicado no site oficial. */
  OFFICIAL_SITE_SINGLE: 85,
  /** Link no site oficial e handle parecido com o nome da empresa. */
  OFFICIAL_SITE_NAME_MATCH: 95,
  /** Varios perfis no site e nenhum se parece com o nome — ambiguo. */
  OFFICIAL_SITE_AMBIGUOUS: 60,
} as const;

/** Baixa o HTML do site com timeout e limite de tamanho. Retorna `null` em qualquer falha. */
async function fetchHtml(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'LeadHunter/1.0 (+prospeccao comercial)' },
      cache: 'no-store',
    });

    if (!response.ok) return null;

    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('text/html')) return null;

    const buffer = await response.arrayBuffer();
    const slice = buffer.byteLength > MAX_HTML_BYTES ? buffer.slice(0, MAX_HTML_BYTES) : buffer;
    return new TextDecoder('utf-8', { fatal: false }).decode(slice);
  } catch {
    // Site fora do ar, timeout, TLS invalido: apenas "nao encontrado".
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/** Escolhe o melhor candidato e atribui confianca (SPEC 10). */
export function rankCandidates(handles: string[], businessName: string): InstagramDiscovery {
  if (!handles.length) return NOT_FOUND;

  const ranked = handles
    .map((handle) => ({ handle, affinity: handleNameAffinity(handle, businessName) }))
    .sort((a, b) => b.affinity - a.affinity);

  const best = ranked[0];
  const hasNameMatch = best.affinity >= 0.5;

  let confidence: number;
  if (hasNameMatch) {
    confidence = CONFIDENCE.OFFICIAL_SITE_NAME_MATCH;
  } else if (handles.length === 1) {
    confidence = CONFIDENCE.OFFICIAL_SITE_SINGLE;
  } else {
    confidence = CONFIDENCE.OFFICIAL_SITE_AMBIGUOUS;
  }

  return {
    instagram_url: `https://instagram.com/${best.handle}`,
    instagram_handle: `@${best.handle}`,
    instagram_confidence: confidence,
    // Sempre pendente: quem confirma e o usuario (SPEC 3.3/10).
    instagram_status: 'PENDING',
    source: 'Link encontrado no site oficial da empresa',
  };
}

/**
 * Tenta identificar o Instagram da empresa.
 * Sem site oficial nao ha fonte confiavel: devolve NOT_FOUND em vez de adivinhar.
 */
export async function discoverInstagram(input: {
  name: string;
  website: string | null;
}): Promise<InstagramDiscovery> {
  if (!input.website) return NOT_FOUND;

  let url: URL;
  try {
    url = new URL(input.website);
  } catch {
    return NOT_FOUND;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return NOT_FOUND;

  const html = await fetchHtml(url.toString());
  if (!html) return NOT_FOUND;

  return rankCandidates(extractInstagramHandles(html), input.name);
}
