import type { InstagramStatus, MatchEvidence } from '@/types/database';

/** Tipos e utilitarios compartilhados pelos provedores de descoberta de Instagram. */

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

export const SOURCE_OFFICIAL_SITE = 'Link publicado no site oficial';
export const SOURCE_WEB_SEARCH = 'Mecanismo de busca';

export type InstagramCandidate = {
  handle: string;
  /** Texto publico associado ao candidato (titulo/descricao do resultado de busca). */
  context: string;
  source: string;
};

export type CompanySignals = {
  name: string;
  category?: string | null;
  city?: string | null;
  state?: string | null;
  phone?: string | null;
  website?: string | null;
  address?: string | null;
};

export type InstagramDiscovery = {
  instagram_url: string | null;
  instagram_handle: string | null;
  instagram_confidence: number | null;
  instagram_status: InstagramStatus;
  instagram_source: string | null;
  instagram_evidence: MatchEvidence[];
  instagram_checked_at: string | null;
};

export const NOT_FOUND: InstagramDiscovery = {
  instagram_url: null,
  instagram_handle: null,
  instagram_confidence: null,
  instagram_status: 'NOT_FOUND',
  instagram_source: null,
  instagram_evidence: [],
  instagram_checked_at: null,
};

export function normalizeToken(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

/** Extrai handles de instagram.com de um texto/HTML. */
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
