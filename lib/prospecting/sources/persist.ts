import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Company, CompanyUpsert, DuplicateConfidenceLevel, OpportunityLevel, WebsiteStatus } from '@/types/database';
import { normalizePhone } from '@/lib/whatsapp/phone';
import type { NormalizedBusiness } from './normalize';
import type { SourceId, SourceQuality } from './types';
import {
  scoreConsolidation,
  type ConsolidationCandidate,
  type ConsolidationSignal,
} from './consolidate';

/**
 * Resolucao de identidade cross-source (SPEC 1.2 FASE 6).
 *
 * `lead_sources` e a fonte de verdade: uma empresa ja conhecida e reconhecida por
 * (source, source_id) exato, ou — quando a mesma empresa aparece pela primeira vez
 * numa fonte diferente — por sinais que sobrevivem entre fontes (telefone, site,
 * nome+endereco, geo+nome). So telefone/site (quase inequivocos) fundem automaticamente;
 * o resto vira evidencia de possivel duplicidade, nunca fusao silenciosa.
 */

export type ExistingCompanySnapshot = Pick<
  Company,
  | 'id'
  | 'instagram_url'
  | 'instagram_handle'
  | 'instagram_confidence'
  | 'instagram_status'
  | 'instagram_source'
  | 'instagram_evidence'
  | 'instagram_checked_at'
  | 'last_checked_at'
>;

export type IdentityResolution =
  | { kind: 'EXACT'; company: ExistingCompanySnapshot }
  | { kind: 'CONSOLIDATED'; company: ExistingCompanySnapshot; signals: ConsolidationSignal[] }
  | {
      kind: 'POSSIBLE_DUPLICATE';
      candidateCompanyId: string;
      confidence: DuplicateConfidenceLevel;
      signals: ConsolidationSignal[];
    }
  | { kind: 'NEW' };

const CANDIDATE_COLUMNS =
  'id, name, phone, whatsapp, website, address, latitude, longitude, instagram_url, instagram_handle, instagram_confidence, instagram_status, instagram_source, instagram_evidence, instagram_checked_at, last_checked_at';

type CandidateRow = ExistingCompanySnapshot &
  Pick<Company, 'name' | 'phone' | 'whatsapp' | 'website' | 'address' | 'latitude' | 'longitude'>;

function toSnapshot(row: CandidateRow): ExistingCompanySnapshot {
  return {
    id: row.id,
    instagram_url: row.instagram_url,
    instagram_handle: row.instagram_handle,
    instagram_confidence: row.instagram_confidence,
    instagram_status: row.instagram_status,
    instagram_source: row.instagram_source,
    instagram_evidence: row.instagram_evidence,
    instagram_checked_at: row.instagram_checked_at,
    last_checked_at: row.last_checked_at,
  };
}

function toConsolidationCandidate(row: CandidateRow): ConsolidationCandidate {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    whatsapp: row.whatsapp,
    website: row.website,
    address: row.address,
    latitude: row.latitude,
    longitude: row.longitude,
  };
}

/**
 * Resolve, para um lote inteiro de empresas normalizadas, se cada uma ja e conhecida
 * (por qual caminho) ou e genuinamente nova. Bulk por natureza — evita N+1 consultando
 * o lote inteiro de uma vez, tanto para o match exato quanto para os candidatos de
 * consolidacao.
 */
export async function resolveIdentities(
  supabase: SupabaseClient,
  userId: string,
  city: string | null,
  businesses: NormalizedBusiness[],
): Promise<IdentityResolution[]> {
  const results: IdentityResolution[] = businesses.map(() => ({ kind: 'NEW' as const }));
  if (!businesses.length) return results;

  // 1. Match exato por (source, source_id) — o mesmo objeto ja visto antes.
  const sourceIds = [...new Set(businesses.map((b) => b.sourceId))];
  const { data: exactRows } = await supabase
    .from('lead_sources')
    .select('company_id, source, source_id')
    .eq('user_id', userId)
    .in('source_id', sourceIds);

  const exactCompanyIdByKey = new Map<string, string>();
  for (const row of (exactRows ?? []) as { company_id: string; source: string; source_id: string }[]) {
    exactCompanyIdByKey.set(`${row.source}:${row.source_id}`, row.company_id);
  }

  const exactCompanyIds = new Set<string>();
  const exactByIndex = new Map<number, string>();
  businesses.forEach((business, index) => {
    const companyId = exactCompanyIdByKey.get(`${business.source}:${business.sourceId}`);
    if (companyId) {
      exactCompanyIds.add(companyId);
      exactByIndex.set(index, companyId);
    }
  });

  const needsConsolidation = businesses
    .map((_, index) => index)
    .filter((index) => !exactByIndex.has(index));

  // 2. Carrega, de uma vez, os dados necessarios para preencher os matches exatos e
  // para servir de candidatos de consolidacao (mesma cidade + telefone batendo).
  const phones = needsConsolidation
    .map((index) => normalizePhone(businesses[index].phone ?? businesses[index].phoneInternational))
    .filter((phone): phone is string => Boolean(phone));

  const [exactSnapshots, cityCandidates, phoneCandidates] = await Promise.all([
    exactCompanyIds.size
      ? supabase.from('companies').select(CANDIDATE_COLUMNS).eq('user_id', userId).in('id', [...exactCompanyIds])
      : Promise.resolve({ data: [] as CandidateRow[] }),
    city && needsConsolidation.length
      ? supabase.from('companies').select(CANDIDATE_COLUMNS).eq('user_id', userId).eq('city', city)
      : Promise.resolve({ data: [] as CandidateRow[] }),
    phones.length
      ? supabase.from('companies').select(CANDIDATE_COLUMNS).eq('user_id', userId).in('whatsapp', phones)
      : Promise.resolve({ data: [] as CandidateRow[] }),
  ]);

  const snapshotById = new Map<string, ExistingCompanySnapshot>();
  for (const row of (exactSnapshots.data ?? []) as CandidateRow[]) snapshotById.set(row.id, toSnapshot(row));

  for (const [index, companyId] of exactByIndex) {
    const company = snapshotById.get(companyId);
    if (company) results[index] = { kind: 'EXACT', company };
  }

  if (!needsConsolidation.length) return results;

  const candidateById = new Map<string, CandidateRow>();
  for (const row of [...(cityCandidates.data ?? []), ...(phoneCandidates.data ?? [])] as CandidateRow[]) {
    candidateById.set(row.id, row);
  }
  const candidates = [...candidateById.values()].map(toConsolidationCandidate);

  for (const index of needsConsolidation) {
    const match = scoreConsolidation(businesses[index], candidates);
    if (!match) continue;

    if (match.confidence === 'HIGH') {
      const row = candidateById.get(match.companyId);
      if (row) results[index] = { kind: 'CONSOLIDATED', company: toSnapshot(row), signals: match.signals };
    } else {
      results[index] = {
        kind: 'POSSIBLE_DUPLICATE',
        candidateCompanyId: match.companyId,
        confidence: match.confidence,
        signals: match.signals,
      };
    }
  }

  return results;
}

export type SourceMeta = {
  sourceUrl: string | null;
  sourceQuality: SourceQuality | null;
  rawData: Record<string, unknown>;
};

export type PersistOutcome = {
  companyId: string;
  opportunityLevel: OpportunityLevel;
  websiteStatus: WebsiteStatus;
  isNew: boolean;
};

/**
 * Escreve uma empresa e sua atribuicao de fonte, decidindo entre inserir, atualizar
 * um lead ja conhecido (`EXACT`), ou fundir com um lead de outra fonte (`CONSOLIDATED`).
 * `POSSIBLE_DUPLICATE` cria uma empresa nova e preserva a suspeita em
 * `lead_duplicate_candidates` — nunca funde nem apaga por incerteza (SPEC 1.2 FASE 6).
 *
 * `buildRow` e uma funcao, nao um valor ja pronto: para `EXACT`/`CONSOLIDATED` o score
 * precisa ser recalculado com as capacidades de TODAS as fontes que esse lead ja tem
 * (nao so a que respondeu agora), o que so se sabe depois de consultar `lead_sources`.
 */
export async function persistBusiness(
  supabase: SupabaseClient,
  userId: string,
  business: NormalizedBusiness,
  identity: IdentityResolution,
  buildRow: (sourcesOverride?: SourceId[]) => CompanyUpsert,
  sourceMeta: SourceMeta,
): Promise<PersistOutcome> {
  let companyId: string;
  let row: CompanyUpsert;
  let isNew: boolean;

  if (identity.kind === 'EXACT' || identity.kind === 'CONSOLIDATED') {
    companyId = identity.company.id;
    isNew = false;

    // Capacidade combinada: soma o que esta fonte ve com o que as outras fontes desse
    // lead ja tinham — nunca reduz o que ja era conhecido (SPEC 1.2 FASE 6).
    const { data: existingSources } = await supabase
      .from('lead_sources')
      .select('source')
      .eq('company_id', companyId);
    const sources = [
      ...new Set([...(existingSources ?? []).map((r) => r.source as SourceId), business.source]),
    ];

    row = buildRow(sources);
    const { error } = await supabase.from('companies').update(row).eq('id', companyId).eq('user_id', userId);
    if (error) throw error;
  } else {
    isNew = true;
    row = buildRow();

    const { data, error } = await supabase.from('companies').insert(row).select('id').single();
    if (error) throw error;
    companyId = data.id;

    if (identity.kind === 'POSSIBLE_DUPLICATE') {
      const { error: evidenceError } = await supabase.from('lead_duplicate_candidates').insert({
        user_id: userId,
        company_id: companyId,
        candidate_company_id: identity.candidateCompanyId,
        confidence: identity.confidence,
        signals: identity.signals,
      });
      if (evidenceError) {
        console.error('[prospecting] falha ao registrar possivel duplicidade', {
          userId,
          companyId,
          code: evidenceError.code,
        });
      }
    }
  }

  const { error: leadSourceError } = await supabase.from('lead_sources').upsert(
    {
      user_id: userId,
      company_id: companyId,
      source: business.source,
      source_id: business.sourceId,
      source_url: sourceMeta.sourceUrl,
      source_quality: sourceMeta.sourceQuality,
      raw_data: sourceMeta.rawData,
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,source,source_id' },
  );

  if (leadSourceError) {
    // Nao aborta a empresa por isso: o registro em `companies` ja foi salvo. Mas e um
    // problema real (proxima execucao nao vai reconhecer esta fonte via match exato).
    console.error('[prospecting] falha ao registrar a fonte do lead', {
      userId,
      companyId,
      source: business.source,
      code: leadSourceError.code,
    });
  }

  return {
    companyId,
    opportunityLevel: row.opportunity_level,
    websiteStatus: row.website_status,
    isNew,
  };
}
