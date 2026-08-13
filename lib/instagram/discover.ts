import 'server-only';

import { normalizePhone } from '@/lib/whatsapp/phone';
import { instagramSearchConfigured, searchInstagramCandidates } from './search-provider';
import {
  NOT_FOUND,
  SOURCE_OFFICIAL_SITE,
  SOURCE_WEB_SEARCH,
  extractInstagramHandles,
  normalizeToken,
  type CompanySignals,
  type InstagramCandidate,
  type InstagramDiscovery,
} from './shared';
import type { MatchEvidence } from '@/types/database';

/**
 * Descoberta de Instagram (SPEC 1.1 §19-§26).
 *
 * Duas fontes, ambas publicas e sem scraping agressivo:
 *   1. o site oficial informado pelo Google (link publicado pela propria empresa);
 *   2. um mecanismo de busca oficial (Google Programmable Search JSON API), quando configurado —
 *      o que permite encontrar perfil de empresa que nao tem site.
 *
 * Descoberta nunca e confirmacao: o resultado fica `PENDING` ate o usuario decidir.
 * O sistema jamais assume que `@nomedaempresa` pertence a empresa: a confianca vem
 * de varios sinais combinados (nome, cidade, categoria, telefone, dominio).
 */

const FETCH_TIMEOUT_MS = 6_000;
const MAX_HTML_BYTES = 512 * 1024;

/**
 * Grau de semelhanca entre handle e nome da empresa (0 a 1).
 * Calibra a confianca — nunca serve para inventar um handle.
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

  return tokens.filter((t) => h.includes(t)).length / tokens.length;
}

/** Pesos de cada sinal de correspondencia (SPEC 1.1 §23). */
export const SIGNAL_WEIGHTS = {
  /** O link esta publicado no site oficial: evidencia direta e forte. */
  OFFICIAL_SITE: 60,
  NAME: 25,
  CITY: 10,
  CATEGORY: 5,
  PHONE: 15,
  /** Handle contem o dominio do site da empresa. */
  DOMAIN: 10,
} as const;

const MAX_CONFIDENCE = 100;

/**
 * Confianca minima para sequer sugerir um perfil.
 * Um candidato sem nenhum sinal de correspondencia e ruido: nao vai para a tela,
 * porque sugerir ruido convida o usuario a confirmar algo sem base (SPEC 1.1 §22/§26).
 */
export const MIN_CONFIDENCE_TO_SUGGEST = 25;

/**
 * Calcula confianca e evidencias de um candidato.
 * Nome sozinho nunca chega a faixa alta: e preciso mais de um sinal (SPEC 1.1 §23).
 */
export function scoreCandidate(
  candidate: InstagramCandidate,
  company: CompanySignals,
): { confidence: number; evidence: MatchEvidence[] } {
  const evidence: MatchEvidence[] = [];
  let confidence = 0;

  const haystack = normalizeToken(`${candidate.handle} ${candidate.context}`);
  const fromOfficialSite = candidate.source === SOURCE_OFFICIAL_SITE;

  const push = (signal: string, label: string, matched: boolean, points: number) => {
    evidence.push({ signal, label, matched });
    if (matched) confidence += points;
  };

  push(
    'OFFICIAL_SITE',
    'Link publicado no site oficial',
    fromOfficialSite,
    SIGNAL_WEIGHTS.OFFICIAL_SITE,
  );

  const nameMatch = handleNameAffinity(candidate.handle, company.name) >= 0.5;
  push('NAME', 'Nome compativel', nameMatch, SIGNAL_WEIGHTS.NAME);

  const cityToken = company.city ? normalizeToken(company.city) : '';
  const cityMatch = Boolean(cityToken) && haystack.includes(cityToken);
  push('CITY', 'Cidade compativel', cityMatch, SIGNAL_WEIGHTS.CITY);

  const categoryTokens = (company.category ?? '')
    .split(/\s+/)
    .map(normalizeToken)
    .filter((t) => t.length >= 4);
  const categoryMatch = categoryTokens.some((t) => haystack.includes(t));
  push('CATEGORY', 'Categoria compativel', categoryMatch, SIGNAL_WEIGHTS.CATEGORY);

  const normalizedPhone = normalizePhone(company.phone);
  const phoneDigits = normalizedPhone ? normalizedPhone.replace(/^55/, '') : '';
  const phoneMatch =
    phoneDigits.length >= 8 && normalizeToken(candidate.context).includes(phoneDigits);
  push('PHONE', 'Telefone compativel', phoneMatch, SIGNAL_WEIGHTS.PHONE);

  let domainMatch = false;
  if (company.website) {
    try {
      const host = new URL(company.website).hostname.replace(/^www\./, '');
      const domainToken = normalizeToken(host.split('.')[0] ?? '');
      domainMatch = domainToken.length >= 4 && normalizeToken(candidate.handle).includes(domainToken);
    } catch {
      domainMatch = false;
    }
  }
  push('DOMAIN', 'Dominio do site compativel', domainMatch, SIGNAL_WEIGHTS.DOMAIN);

  return { confidence: Math.min(confidence, MAX_CONFIDENCE), evidence };
}

/** Baixa o HTML do site com timeout e limite de tamanho. `null` em qualquer falha. */
async function fetchHtml(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'LeadHunter/1.1 (+prospeccao comercial)' },
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

/** Candidatos vindos do site oficial da empresa. */
export async function candidatesFromWebsite(
  company: CompanySignals,
): Promise<InstagramCandidate[]> {
  if (!company.website) return [];

  let url: URL;
  try {
    url = new URL(company.website);
  } catch {
    return [];
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return [];

  const html = await fetchHtml(url.toString());
  if (!html) return [];

  return extractInstagramHandles(html).map((handle) => ({
    handle,
    context: `${company.name} ${url.hostname}`,
    source: SOURCE_OFFICIAL_SITE,
  }));
}

/** Escolhe o melhor candidato e monta o resultado (SPEC 1.1 §21/§22). */
export function rankCandidates(
  candidates: InstagramCandidate[],
  company: CompanySignals,
): InstagramDiscovery {
  if (!candidates.length) return { ...NOT_FOUND, instagram_checked_at: new Date().toISOString() };

  const ranked = candidates
    .map((candidate) => ({ candidate, ...scoreCandidate(candidate, company) }))
    .filter((item) => item.confidence >= MIN_CONFIDENCE_TO_SUGGEST)
    .sort((a, b) => b.confidence - a.confidence);

  if (!ranked.length) return { ...NOT_FOUND, instagram_checked_at: new Date().toISOString() };

  const best = ranked[0];

  // Vários candidatos empatados no topo significam ambiguidade real: reduz a confianca.
  const tied = ranked.filter((r) => r.confidence === best.confidence).length;
  const confidence = tied > 1 ? Math.round(best.confidence * 0.7) : best.confidence;

  return {
    instagram_url: `https://instagram.com/${best.candidate.handle}`,
    instagram_handle: `@${best.candidate.handle}`,
    instagram_confidence: confidence,
    // Sempre pendente: quem confirma e o usuario (SPEC 3.3/10, SPEC 1.1 §25).
    instagram_status: 'PENDING',
    instagram_source: best.candidate.source,
    instagram_evidence: best.evidence,
    instagram_checked_at: new Date().toISOString(),
  };
}

/**
 * Tenta identificar o Instagram da empresa a partir das fontes disponiveis.
 * Sem candidato, devolve NOT_FOUND — nunca adivinha um handle.
 */
export async function discoverInstagram(company: CompanySignals): Promise<InstagramDiscovery> {
  const candidates: InstagramCandidate[] = [];

  const fromSite = await candidatesFromWebsite(company);
  candidates.push(...fromSite);

  // Busca na web so quando o site nao resolveu — economiza chamadas pagas (SPEC 1.1 §11).
  if (!fromSite.length && instagramSearchConfigured()) {
    try {
      candidates.push(...(await searchInstagramCandidates(company)));
    } catch (error) {
      console.error('[instagram] falha na busca externa', {
        company: company.name,
        error: error instanceof Error ? error.message : 'desconhecido',
      });
    }
  }

  return rankCandidates(candidates, company);
}

export {
  NOT_FOUND,
  SOURCE_OFFICIAL_SITE,
  SOURCE_WEB_SEARCH,
  extractInstagramHandles,
  normalizeToken,
  instagramSearchConfigured,
};
export type { CompanySignals, InstagramCandidate, InstagramDiscovery };
