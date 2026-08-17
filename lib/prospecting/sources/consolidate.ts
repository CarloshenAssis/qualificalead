import { normalizePhone } from '@/lib/whatsapp/phone';
import type { NormalizedBusiness } from './normalize';

/**
 * Consolidacao cross-source (SPEC 1.2 FASE 6).
 *
 * Um mesmo estabelecimento pode aparecer em mais de uma fonte com identificadores
 * totalmente diferentes (`OPENSTREETMAP:node/123` e `GOOGLE_PLACES:ChIJ...` nao tem
 * nada em comum textualmente). Resolver isso exige comparar sinais que sobrevivem
 * entre fontes: telefone, dominio do site, nome+endereco, proximidade geografica.
 *
 * Regra do produto, nao negociavel: nome parecido sozinho NUNCA funde dois registros.
 * So telefone ou site normalizados — sinais quase inequivocos na pratica — autorizam
 * fusao automatica (`HIGH`). Nome+endereco e geo+nome ficam em `MEDIUM`/`LOW`: o
 * pipeline cria um novo lead e guarda a suspeita em `lead_duplicate_candidates`, sem
 * apagar nem fundir nada — a decisao fica para revisao humana.
 *
 * O sinal "identificador externo" (SPEC 1.2, sinal 2) nao esta implementado: nenhuma
 * fonte hoje (OSM/Google) devolve um identificador de registro publico (ex.: CNPJ).
 */

export type ConsolidationSignal =
  | 'PHONE_MATCH'
  | 'WEBSITE_MATCH'
  | 'NAME_ADDRESS_MATCH'
  | 'GEO_NAME_PROXIMITY';

export type ConsolidationConfidence = 'HIGH' | 'MEDIUM' | 'LOW';

export type ConsolidationCandidate = {
  id: string;
  name: string;
  phone: string | null;
  whatsapp: string | null;
  website: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
};

export type ConsolidationMatch = {
  companyId: string;
  confidence: ConsolidationConfidence;
  signals: ConsolidationSignal[];
};

/** Raio dentro do qual duas fichas com nome parecido podem ser o mesmo predio/quarteirao. */
const GEO_PROXIMITY_METERS = 150;
const NAME_SIMILARITY_HIGH = 0.8;
const NAME_SIMILARITY_MEDIUM = 0.5;

function normalizeName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Similaridade por sobreposicao de tokens (Jaccard) — 0 a 1, nunca inventa uma correspondencia exata. */
export function businessNameSimilarity(a: string, b: string): number {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;

  const tokensA = new Set(na.split(' ').filter((t) => t.length >= 3));
  const tokensB = new Set(nb.split(' ').filter((t) => t.length >= 3));
  if (!tokensA.size || !tokensB.size) return na.includes(nb) || nb.includes(na) ? 0.8 : 0;

  const intersection = [...tokensA].filter((t) => tokensB.has(t)).length;
  const union = new Set([...tokensA, ...tokensB]).size;
  return union ? intersection / union : 0;
}

function normalizeAddress(value: string): string {
  return normalizeName(value).replace(/\s+/g, '');
}

/** Dominio do site sem protocolo, `www.` ou barra final — para comparar a mesma URL escrita de formas diferentes. */
export function normalizedWebsiteDomain(url: string | null | undefined): string | null {
  if (!url?.trim()) return null;
  try {
    const withProtocol = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    const host = new URL(withProtocol).hostname.toLowerCase();
    return host.replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}

/** Distancia em metros entre duas coordenadas (formula de Haversine). */
function haversineMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

function confidenceRank(confidence: ConsolidationConfidence): number {
  return confidence === 'HIGH' ? 2 : confidence === 'MEDIUM' ? 1 : 0;
}

/**
 * Compara uma empresa recem-normalizada contra candidatos ja salvos e devolve a melhor
 * correspondencia encontrada, ou `null` se nao houver nenhum sinal em comum.
 *
 * Nunca decide sozinha o que fazer com o resultado — quem chama decide se `HIGH` funde
 * automaticamente e se `MEDIUM`/`LOW` viram evidencia de possivel duplicidade.
 */
export function scoreConsolidation(
  business: NormalizedBusiness,
  candidates: ConsolidationCandidate[],
): ConsolidationMatch | null {
  let best: ConsolidationMatch | null = null;

  const businessPhone = normalizePhone(business.phone ?? business.phoneInternational);
  const businessDomain = normalizedWebsiteDomain(business.website);

  for (const candidate of candidates) {
    const signals: ConsolidationSignal[] = [];

    const candidatePhone = normalizePhone(candidate.phone ?? candidate.whatsapp);
    if (businessPhone && candidatePhone && businessPhone === candidatePhone) {
      signals.push('PHONE_MATCH');
    }

    const candidateDomain = normalizedWebsiteDomain(candidate.website);
    if (businessDomain && candidateDomain && businessDomain === candidateDomain) {
      signals.push('WEBSITE_MATCH');
    }

    const nameSimilarity = businessNameSimilarity(business.name, candidate.name);
    const sameAddress =
      Boolean(business.address) &&
      Boolean(candidate.address) &&
      normalizeAddress(business.address as string) === normalizeAddress(candidate.address as string);

    if (nameSimilarity >= NAME_SIMILARITY_HIGH && sameAddress) {
      signals.push('NAME_ADDRESS_MATCH');
    }

    if (
      typeof business.latitude === 'number' &&
      typeof business.longitude === 'number' &&
      typeof candidate.latitude === 'number' &&
      typeof candidate.longitude === 'number' &&
      nameSimilarity >= NAME_SIMILARITY_MEDIUM
    ) {
      const distance = haversineMeters(
        business.latitude,
        business.longitude,
        candidate.latitude,
        candidate.longitude,
      );
      if (distance <= GEO_PROXIMITY_METERS) signals.push('GEO_NAME_PROXIMITY');
    }

    if (!signals.length) continue;

    // Telefone ou site batendo e quase inequivoco; nome+endereco ou geo+nome sozinhos
    // nunca chegam a HIGH — fundir so por nome parecido e proibido (regra do produto).
    const confidence: ConsolidationConfidence =
      signals.includes('PHONE_MATCH') || signals.includes('WEBSITE_MATCH')
        ? 'HIGH'
        : signals.includes('NAME_ADDRESS_MATCH')
          ? 'MEDIUM'
          : 'LOW';

    const match: ConsolidationMatch = { companyId: candidate.id, confidence, signals };
    if (!best || confidenceRank(confidence) > confidenceRank(best.confidence)) {
      best = match;
    }
  }

  return best;
}
