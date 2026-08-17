import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Company, CompanyUpsert, SearchStatus } from '@/types/database';
import type { ProspectingSearchInput } from '@/lib/validation/schemas';
import { discoverInstagram, NOT_FOUND as INSTAGRAM_NOT_FOUND } from '@/lib/instagram/discover';
import type { InstagramDiscovery } from '@/lib/instagram/shared';
import {
  computeGoogleBusinessQuality,
  computeNextAction,
  computeOpportunityScore,
} from '@/lib/scoring/score';
import { normalizePhone } from '@/lib/whatsapp/phone';
import { defaultPhoneCountryCode, digitalPresenceTtlDays } from '@/lib/env';

import { openStreetMapSource } from './sources/overpass';
import { GeocodeError } from '@/lib/overpass/geocode';
import { OverpassError } from '@/lib/overpass/client';
import { googlePlacesSource } from './sources/google';
import { GooglePlacesError } from '@/lib/google/places';
import { DEFAULT_PROSPECTING_MODE, selectSources } from './sources/registry';
import {
  SOURCE_LABELS,
  assessSourceQuality,
  capabilitiesForSources,
  type ProspectingSearchParams,
  type ProspectingSource,
  type RawBusiness,
  type SourceId,
} from './sources/types';
import { normalizeRawBusiness, type NormalizedBusiness } from './sources/normalize';
import { buildDedupKey, dedupeNormalizedBusinesses } from './sources/dedupe';
import { inferCompanySource, loadCompanySources } from './sources/identity';
import { readDiscoveryCache, writeDiscoveryCache } from './cache';
import { resolveIdentities, persistBusiness, type IdentityResolution } from './sources/persist';

/**
 * Orquestracao da prospeccao (SPEC 43 fases 3-4, SPEC 1.1 §54/§85/§86, SPEC 1.2 §5-§35,
 * FASE 6 identidade multi-source).
 *
 * Pipeline: Registry -> Selected Sources -> Search (com cache) -> RawBusiness -> Normalize
 * -> Deduplicate -> Resolve Identity -> Digital Presence -> Qualification -> Score -> Persist.
 *
 * "Resolve Identity" e o que a FASE 6 muda de verdade: em vez de decidir "essa empresa ja
 * existe?" pelo par (google_place_id/dedup_key) como na FASE 4, a resposta agora vem de
 * `lead_sources` — inclusive quando a mesma empresa aparece pela primeira vez numa fonte
 * diferente da que a descobriu antes (consolidacao cross-source, lib/prospecting/sources/
 * persist.ts). O resultado dessa etapa e reaproveitado tanto para decidir se o Instagram
 * precisa ser reconsultado quanto para decidir como persistir no final.
 */

/** Requisicoes simultaneas ao verificar presenca digital e ao persistir. */
const ENRICHMENT_CONCURRENCY = 5;
const PERSIST_CONCURRENCY = 5;

export type ProspectingStage =
  | 'locating'
  | 'searching'
  | 'processing'
  | 'digital_presence'
  | 'scoring'
  | 'saving'
  | 'done';

export const STAGE_MESSAGES: Record<ProspectingStage, string> = {
  locating: 'Localizando regiao...',
  searching: 'Consultando fontes de dados...',
  processing: 'Processando empresas...',
  digital_presence: 'Verificando presenca digital...',
  scoring: 'Calculando oportunidades...',
  saving: 'Salvando resultados...',
  done: 'Finalizando...',
};

export type ProspectingSummary = {
  status: SearchStatus;
  found: number;
  saved: number;
  newCompanies: number;
  alreadyKnown: number;
  withoutWebsite: number;
  qualified: number;
  excellent: number;
  high: number;
  /** Empresas cuja verificacao de presenca digital falhou (SPEC 1.1 §86). */
  enrichmentFailed: number;
  /** Empresas que reaproveitaram dados do cache em vez de nova consulta. */
  fromCache: number;
  /** `true` quando alguma fonte devolveu o maximo permitido e pode haver mais empresas. */
  limitReached: boolean;
};

export type ProspectingEvent =
  | { type: 'stage'; stage: ProspectingStage; message: string }
  | { type: 'progress'; processed: number; total: number }
  | { type: 'warning'; message: string }
  /**
   * `detail` e diagnostico tecnico (api/status HTTP/status e mensagem do Google, ou
   * codigo do Overpass/Nominatim) para ajudar a identificar a causa real de uma falha —
   * nunca contem credenciais (SPEC 1.1 §57).
   */
  | { type: 'error'; message: string; code?: string; detail?: string }
  | { type: 'done'; summary: ProspectingSummary; searchId: string | null };

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
  onProgress?: (done: number) => void,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  let done = 0;

  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
      done += 1;
      onProgress?.(done);
    }
  });

  await Promise.all(runners);
  return results;
}

/** Dados verificados ha menos de N dias sao reaproveitados (SPEC 1.1 §12). */
export function isFresh(lastCheckedAt: string | null, ttlDays = digitalPresenceTtlDays()): boolean {
  if (!lastCheckedAt) return false;
  const checked = new Date(lastCheckedAt).getTime();
  if (Number.isNaN(checked)) return false;
  return Date.now() - checked < ttlDays * 24 * 60 * 60 * 1000;
}

type EnrichmentOutcome = {
  instagram: InstagramDiscovery;
  status: Company['enrichment_status'];
  error: string | null;
  fromCache: boolean;
};

/** Monta a linha final de `companies` a partir dos dados coletados e derivados. */
export function buildCompanyRow(
  userId: string,
  business: NormalizedBusiness,
  outcome: EnrichmentOutcome,
  sourcesOverride?: SourceId[],
): CompanyUpsert {
  const { instagram } = outcome;
  const phone = business.phone ?? business.phoneInternational;
  // Sem override, a capacidade e so da fonte deste registro; com override (lead ja
  // conhecido por outras fontes tambem), soma o que todas elas ja sabiam (SPEC 1.2 FASE 6).
  const capabilities = capabilitiesForSources(sourcesOverride ?? [business.source]);

  const scoreInput = {
    website_status: business.websiteStatus,
    rating: business.rating,
    review_count: business.reviewCount,
    phone,
    instagram_url: instagram.instagram_url,
    instagram_confidence: instagram.instagram_confidence,
    instagram_status: instagram.instagram_status,
    business_status: business.businessStatus,
    address: business.address,
    category: business.category,
    opening_hours: business.openingHours,
    description: business.description,
    google_maps_url: business.sourceUrl,
  };

  const score = computeOpportunityScore(scoreInput, capabilities);
  const quality = computeGoogleBusinessQuality(scoreInput, capabilities);
  const nextAction = computeNextAction({
    score: score.score,
    quality,
    hasPhone: Boolean(normalizePhone(phone, defaultPhoneCountryCode())),
    websiteStatus: business.websiteStatus,
    businessStatus: business.businessStatus,
  });

  const now = new Date().toISOString();

  return {
    user_id: userId,
    // Compatibilidade com a 1.1 apenas: leads do Google continuam preenchendo esta
    // coluna, mas quem decide identidade agora e `lead_sources` (SPEC 1.2 FASE 6).
    google_place_id: business.source === 'GOOGLE_PLACES' ? business.sourceId : null,
    name: business.name,
    category: business.category,
    categories: business.categories,
    description: business.description,
    phone: business.phone,
    phone_international: business.phoneInternational,
    whatsapp: normalizePhone(phone, defaultPhoneCountryCode()),
    website: business.website,
    website_status: business.websiteStatus,
    website_checked_at: now,
    google_maps_url: business.sourceUrl,
    address: business.address,
    city: business.city,
    state: business.state,
    country: business.country,
    latitude: business.latitude,
    longitude: business.longitude,
    rating: business.rating,
    review_count: business.reviewCount,
    opening_hours: business.openingHours,
    business_status: business.businessStatus,
    instagram_url: instagram.instagram_url,
    instagram_handle: instagram.instagram_handle,
    instagram_confidence: instagram.instagram_confidence,
    instagram_status: instagram.instagram_status,
    instagram_source: instagram.instagram_source,
    instagram_evidence: instagram.instagram_evidence,
    instagram_checked_at: instagram.instagram_checked_at,
    opportunity_score: score.score,
    opportunity_level: score.level,
    score_breakdown: score.breakdown,
    google_business_quality: quality,
    next_action: nextAction.action,
    next_action_reason: nextAction.reason,
    enrichment_status: outcome.status,
    enrichment_error: outcome.error,
    // Historico leve mantido por compatibilidade; a proveniencia de verdade mora em
    // `lead_sources` a partir da FASE 6. `source_coverage` fica fora do score comercial
    // (SPEC 1.2 §35) — nunca soma nem subtrai pontos.
    source_data: {
      source: business.source,
      source_id: business.sourceId,
      fetched_at: now,
      source_coverage: score.coverage,
    },
    dedup_key: buildDedupKey(business),
    last_checked_at: now,
  };
}

/** Fontes com adaptador pronto. Foursquare tem tipo/capacidades definidas mas nenhum adaptador ainda. */
function getRegisteredSources(): ProspectingSource[] {
  return [openStreetMapSource, googlePlacesSource];
}

type SourceErrorInfo = { code?: string; message: string; detail?: string };

/** Traduz o erro de uma fonte para o mesmo formato de diagnostico tecnico da 1.1 (SPEC 1.1 §57). */
function describeSourceError(sourceId: SourceId, error: unknown): SourceErrorInfo {
  if (error instanceof GooglePlacesError) {
    return {
      code: error.code,
      message: error.message,
      detail: error.detail
        ? `${error.detail.api} · HTTP ${error.detail.httpStatus} · ${error.detail.googleStatus ?? 'sem status'} · ${error.detail.googleMessage ?? 'sem mensagem'}`
        : undefined,
    };
  }
  if (error instanceof GeocodeError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof OverpassError) {
    return {
      code: error.code,
      message: error.message,
      detail: error.httpStatus !== null ? `overpass · HTTP ${error.httpStatus}` : undefined,
    };
  }
  return { message: `Nao foi possivel consultar ${SOURCE_LABELS[sourceId]} agora. Tente novamente.` };
}

type SourceOutcome = {
  source: ProspectingSource;
  businesses: RawBusiness[];
  warnings: string[];
  limitReached: boolean;
  cacheHit: boolean;
  error: SourceErrorInfo | null;
};

/**
 * Roda uma fonte com cache persistente na frente (SPEC 1.2 §25/§43, FASE 6): mesma
 * pesquisa dentro do TTL nunca gera uma nova chamada de rede. Falha ao ler/escrever o
 * cache nunca derruba a pesquisa (lib/prospecting/cache.ts ja trata isso).
 */
async function runSource(
  source: ProspectingSource,
  params: ProspectingSearchParams,
  userId: string,
  supabase: SupabaseClient,
): Promise<SourceOutcome> {
  const cacheParams = { ...params, source: source.id };

  const cached = await readDiscoveryCache(supabase, userId, cacheParams);
  if (cached) {
    return {
      source,
      businesses: cached.result.businesses,
      warnings: cached.result.warnings,
      limitReached: cached.result.metrics.returned >= cached.result.metrics.requested,
      cacheHit: true,
      error: null,
    };
  }

  try {
    const result = await source.search(params);
    void writeDiscoveryCache(supabase, userId, cacheParams, result);
    return {
      source,
      businesses: result.businesses,
      warnings: result.warnings,
      limitReached: result.metrics.returned >= result.metrics.requested,
      cacheHit: false,
      error: null,
    };
  } catch (error) {
    const info = describeSourceError(source.id, error);
    console.error('[prospecting] falha na busca', {
      userId,
      source: source.id,
      code: info.code,
      detail: info.detail,
    });
    return { source, businesses: [], warnings: [], limitReached: false, cacheHit: false, error: info };
  }
}

export async function* runProspecting(
  supabase: SupabaseClient,
  userId: string,
  input: ProspectingSearchInput,
): AsyncGenerator<ProspectingEvent> {
  const startedAt = Date.now();
  const country = input.country?.trim() || 'Brasil';
  const locationLabel = [input.city, input.state, country].filter(Boolean).join(', ');
  // Texto de registro historico (prospecting_searches.query) — independente do que cada
  // fonte monta internamente para sua propria API.
  const textQuery = `${input.segment} em ${locationLabel}`;

  console.info('[prospecting] inicio', { userId, segment: input.segment, city: input.city });

  const emptySummary: ProspectingSummary = {
    status: 'COMPLETED',
    found: 0,
    saved: 0,
    newCompanies: 0,
    alreadyKnown: 0,
    withoutWebsite: 0,
    qualified: 0,
    excellent: 0,
    high: 0,
    enrichmentFailed: 0,
    fromCache: 0,
    limitReached: false,
  };

  // Registry -> Selected Sources (SPEC 1.2 §20/§21/§23).
  // Modo fixo em FREE por enquanto — a FASE 7 adiciona a escolha de modo/fontes na
  // interface. Isso garante, por si so, que o Google nunca roda por padrao (§74) mesmo
  // que GOOGLE_PLACES_ENABLED esteja ligado: a barreira de custo nao depende so da flag.
  const { selected } = selectSources(getRegisteredSources(), DEFAULT_PROSPECTING_MODE);

  if (!selected.length) {
    console.error('[prospecting] nenhuma fonte disponivel', { userId });
    yield { type: 'error', message: 'Nenhuma fonte de dados esta disponivel no momento.' };
    return;
  }

  yield { type: 'stage', stage: 'locating', message: STAGE_MESSAGES.locating };

  const searchParams: ProspectingSearchParams = {
    query: input.segment,
    city: input.city,
    state: input.state || undefined,
    countryCode: country,
    radiusMeters: input.radiusKm ? input.radiusKm * 1000 : undefined,
    limit: input.limit,
  };

  yield {
    type: 'stage',
    stage: 'searching',
    message: `Consultando ${selected.map((s) => s.name).join(' e ')}...`,
  };

  const outcomes = await Promise.all(
    selected.map((source) => runSource(source, searchParams, userId, supabase)),
  );

  for (const outcome of outcomes) {
    for (const warning of outcome.warnings) yield { type: 'warning', message: warning };
  }

  const succeeded = outcomes.filter((o): o is SourceOutcome & { error: null } => o.error === null);

  // Nenhuma fonte selecionada respondeu: mesmo comportamento fatal da 1.1 quando havia
  // uma unica fonte (Google) e ela falhava — o diagnostico tecnico chega intacto. Nao ha
  // fallback automatico entre fontes (SPEC 1.2 §23): uma fonte gratuita fora do ar nunca
  // aciona uma fonte paga por conta propria.
  if (!succeeded.length) {
    const [first] = outcomes;
    yield {
      type: 'error',
      code: first.error?.code,
      message: first.error?.message ?? 'Nao foi possivel consultar as empresas agora. Tente novamente.',
      detail: first.error?.detail,
    };
    return;
  }

  // Falha parcial (uma fonte caiu, outra respondeu) vira aviso, nao erro fatal.
  for (const outcome of outcomes) {
    if (outcome.error) {
      yield { type: 'warning', message: `${outcome.source.name}: ${outcome.error.message}` };
    }
  }

  yield { type: 'stage', stage: 'processing', message: STAGE_MESSAGES.processing };

  const rawBusinesses = succeeded.flatMap((o) => o.businesses);
  const limitReached = succeeded.some((o) => o.limitReached);
  const searchCacheHit = succeeded.every((o) => o.cacheHit);

  const normalized = dedupeNormalizedBusinesses(
    rawBusinesses
      .map(normalizeRawBusiness)
      .filter((business): business is NormalizedBusiness => business !== null),
  );

  if (!normalized.length) {
    console.info('[prospecting] fim sem resultados', { userId, ms: Date.now() - startedAt });
    yield { type: 'done', summary: emptySummary, searchId: null };
    return;
  }

  yield { type: 'progress', processed: 0, total: normalized.length };

  // Resolve identidade (SPEC 1.2 FASE 6): quais empresas ja sao conhecidas, por qual
  // caminho (match exato em `lead_sources` ou consolidacao cross-source por telefone/
  // site), e quais sao genuinamente novas. Usado tanto para decidir presenca digital
  // (abaixo) quanto para persistir (no final).
  let identities: IdentityResolution[];
  try {
    identities = await resolveIdentities(supabase, userId, input.city || null, normalized);
  } catch {
    console.error('[prospecting] falha ao resolver identidade dos leads', { userId });
    yield { type: 'error', message: 'Nao foi possivel acessar os dados salvos. Tente novamente.' };
    return;
  }

  yield { type: 'stage', stage: 'digital_presence', message: STAGE_MESSAGES.digital_presence };

  let processed = 0;
  const outcomesByBusiness = await mapWithConcurrency(
    normalized,
    ENRICHMENT_CONCURRENCY,
    async (business, index): Promise<EnrichmentOutcome> => {
      const identity = identities[index];
      const existing = identity.kind === 'EXACT' || identity.kind === 'CONSOLIDATED' ? identity.company : null;

      const reuse = (): EnrichmentOutcome => ({
        instagram: {
          instagram_url: existing?.instagram_url ?? null,
          instagram_handle: existing?.instagram_handle ?? null,
          instagram_confidence: existing?.instagram_confidence ?? null,
          instagram_status: existing?.instagram_status ?? 'NOT_FOUND',
          instagram_source: existing?.instagram_source ?? null,
          instagram_evidence: existing?.instagram_evidence ?? [],
          instagram_checked_at: existing?.instagram_checked_at ?? null,
        },
        status: 'SKIPPED',
        error: null,
        fromCache: true,
      });

      // Decisao humana sempre vence a deteccao automatica.
      if (
        existing &&
        (existing.instagram_status === 'CONFIRMED' || existing.instagram_status === 'REJECTED')
      ) {
        return reuse();
      }

      // Cache: nao reconsulta quem foi verificado recentemente.
      if (existing && isFresh(existing.last_checked_at)) return reuse();

      try {
        const found = await discoverInstagram({
          name: business.name,
          category: business.category,
          city: business.city,
          state: business.state,
          phone: business.phone ?? business.phoneInternational,
          website: business.website,
          address: business.address,
        });
        return { instagram: found, status: 'OK', error: null, fromCache: false };
      } catch (error) {
        console.error('[prospecting] falha ao verificar presenca digital', {
          business: business.sourceId,
          error: error instanceof Error ? error.message : 'desconhecido',
        });
        return {
          instagram: INSTAGRAM_NOT_FOUND,
          status: 'FAILED',
          error: 'Nao foi possivel verificar a presenca digital.',
          fromCache: false,
        };
      }
    },
    (done) => {
      processed = done;
    },
  );

  yield { type: 'progress', processed, total: normalized.length };
  yield { type: 'stage', stage: 'scoring', message: STAGE_MESSAGES.scoring };
  yield { type: 'stage', stage: 'saving', message: STAGE_MESSAGES.saving };

  let persistFailed = 0;
  const persistResults = await mapWithConcurrency(
    normalized,
    PERSIST_CONCURRENCY,
    async (business, index) => {
      const outcome = outcomesByBusiness[index];
      const identity = identities[index];
      const buildRow = (sourcesOverride?: SourceId[]) =>
        buildCompanyRow(userId, business, outcome, sourcesOverride);

      try {
        return await persistBusiness(supabase, userId, business, identity, buildRow, {
          sourceUrl: business.sourceUrl,
          sourceQuality: assessSourceQuality(business),
          rawData: business.rawMetadata ?? {},
        });
      } catch (error) {
        persistFailed += 1;
        console.error('[prospecting] falha ao salvar empresa', {
          userId,
          business: business.sourceId,
          error: error instanceof Error ? error.message : 'desconhecido',
        });
        return null;
      }
    },
  );

  if (persistFailed === normalized.length) {
    console.error('[prospecting] falha ao salvar todas as empresas', { userId });
    yield { type: 'error', message: 'Nao foi possivel salvar os resultados. Tente novamente.' };
    return;
  }

  const saved = persistResults.filter((r): r is NonNullable<typeof r> => r !== null);
  const enrichmentFailed = outcomesByBusiness.filter((o) => o.status === 'FAILED').length;
  const enriched = outcomesByBusiness.filter((o) => o.status === 'OK').length;
  const digitalPresenceFromCache = outcomesByBusiness.filter((o) => o.fromCache).length;
  const alreadyKnown = saved.filter((r) => !r.isNew).length;

  const excellent = saved.filter((r) => r.opportunityLevel === 'EXCELENTE').length;
  const high = saved.filter((r) => r.opportunityLevel === 'ALTA').length;

  const summary: ProspectingSummary = {
    // Falha parcial nunca e apresentada como sucesso (SPEC 1.1 §86).
    status: enrichmentFailed > 0 || persistFailed > 0 ? 'PARTIAL' : 'COMPLETED',
    found: normalized.length,
    saved: saved.length,
    newCompanies: saved.filter((r) => r.isNew).length,
    alreadyKnown,
    withoutWebsite: saved.filter((r) => r.websiteStatus === 'NO_WEBSITE_DETECTED').length,
    qualified: excellent + high,
    excellent,
    high,
    enrichmentFailed,
    fromCache: digitalPresenceFromCache,
    limitReached,
  };

  yield { type: 'stage', stage: 'done', message: STAGE_MESSAGES.done };

  if (searchCacheHit) {
    yield { type: 'warning', message: 'Resultado reaproveitado do cache de descoberta.' };
  }

  // Registro da pesquisa + historico de onde cada empresa apareceu (SPEC 19/46/84).
  let searchId: string | null = null;
  const { data: searchRow, error: searchError } = await supabase
    .from('prospecting_searches')
    .insert({
      user_id: userId,
      query: textQuery,
      segment: input.segment,
      city: input.city,
      state: input.state || null,
      country,
      radius: input.radiusKm ?? null,
      filters: { segment: input.segment, limit: input.limit, radiusKm: input.radiusKm ?? null },
      status: summary.status,
      results_count: summary.found,
      qualified_count: summary.qualified,
      new_companies_count: summary.newCompanies,
      existing_companies_count: summary.alreadyKnown,
      high_opportunity_count: summary.high,
      excellent_opportunity_count: summary.excellent,
      without_website_count: summary.withoutWebsite,
      places_requested: input.limit,
      places_processed: summary.found,
      enrichment_count: enriched,
      enrichment_failed_count: enrichmentFailed,
    })
    .select('id')
    .single();

  if (searchError) {
    console.error('[prospecting] falha ao registrar a pesquisa', { userId });
    yield {
      type: 'warning',
      message: 'Os leads foram salvos, mas o historico da pesquisa nao pode ser gravado.',
    };
  } else {
    searchId = searchRow.id;
    const hits = saved.map((row) => ({
      user_id: userId,
      company_id: row.companyId,
      search_id: searchRow.id,
    }));
    if (hits.length) {
      const { error: hitsError } = await supabase
        .from('company_search_hits')
        .upsert(hits, { onConflict: 'company_id,search_id' });
      if (hitsError) console.error('[prospecting] falha ao gravar historico', { userId });
    }
  }

  console.info('[prospecting] fim', {
    userId,
    ms: Date.now() - startedAt,
    found: summary.found,
    saved: summary.saved,
    novas: summary.newCompanies,
    existentes: summary.alreadyKnown,
    enriquecidas: enriched,
    falhas: enrichmentFailed,
    status: summary.status,
  });

  yield { type: 'done', summary, searchId };
}

/**
 * Reprocessa apenas as empresas cujo enriquecimento falhou (SPEC 1.1 §87).
 * Nao repete a pesquisa na fonte original: usa os dados ja salvos.
 */
export async function reprocessFailedEnrichment(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ processed: number; recovered: number; stillFailing: number }> {
  const { data, error } = await supabase
    .from('companies')
    .select('*')
    .eq('user_id', userId)
    .eq('enrichment_status', 'FAILED')
    .limit(100);

  if (error || !data?.length) return { processed: 0, recovered: 0, stillFailing: 0 };

  const companies = data as Company[];
  // Capacidades combinadas de TODAS as fontes que ja contribuiram para cada lead
  // (SPEC 1.2 FASE 6) — nao so a que o `source_data` legado lembra.
  const sourcesByCompany = await loadCompanySources(
    supabase,
    companies.map((c) => c.id),
  );

  let recovered = 0;
  let stillFailing = 0;

  await mapWithConcurrency(companies, ENRICHMENT_CONCURRENCY, async (company) => {
    let outcome: EnrichmentOutcome;
    try {
      const found = await discoverInstagram({
        name: company.name,
        category: company.category,
        city: company.city,
        state: company.state,
        phone: company.phone ?? company.phone_international,
        website: company.website,
        address: company.address,
      });
      outcome = { instagram: found, status: 'OK', error: null, fromCache: false };
      recovered += 1;
    } catch {
      outcome = {
        instagram: INSTAGRAM_NOT_FOUND,
        status: 'FAILED',
        error: 'Nao foi possivel verificar a presenca digital.',
        fromCache: false,
      };
      stillFailing += 1;
    }

    const knownSources = sourcesByCompany.get(company.id);
    const sourcesOverride = knownSources?.length ? knownSources : [inferCompanySource(company).source];
    const row = buildCompanyRow(userId, companyToBusiness(company), outcome, sourcesOverride);
    await supabase
      .from('companies')
      .update({
        instagram_url: row.instagram_url,
        instagram_handle: row.instagram_handle,
        instagram_confidence: row.instagram_confidence,
        instagram_status: row.instagram_status,
        instagram_source: row.instagram_source,
        instagram_evidence: row.instagram_evidence,
        instagram_checked_at: row.instagram_checked_at,
        opportunity_score: row.opportunity_score,
        opportunity_level: row.opportunity_level,
        score_breakdown: row.score_breakdown,
        google_business_quality: row.google_business_quality,
        next_action: row.next_action,
        next_action_reason: row.next_action_reason,
        enrichment_status: row.enrichment_status,
        enrichment_error: row.enrichment_error,
        last_checked_at: row.last_checked_at,
      })
      .eq('id', company.id)
      .eq('user_id', userId);
  });

  console.info('[prospecting] reprocessamento', {
    userId,
    processed: companies.length,
    recovered,
    stillFailing,
  });

  return { processed: companies.length, recovered, stillFailing };
}

/** Converte uma empresa salva de volta ao formato normalizado, com a fonte recuperada (SPEC 1.2 §76). */
function companyToBusiness(company: Company): NormalizedBusiness {
  const { source, sourceId } = inferCompanySource(company);

  return {
    source,
    // Nunca usar company.id como source_id: e um identificador interno, nao um id da
    // fonte externa (SPEC 1.2 FASE 6). LEGACY sem origem conhecida fica genuinamente null.
    sourceId,
    name: company.name,
    category: company.category,
    categories: company.categories,
    description: company.description,
    phone: company.phone,
    phoneInternational: company.phone_international,
    website: company.website,
    websiteStatus: company.website_status,
    sourceUrl: company.google_maps_url,
    address: company.address,
    city: company.city,
    state: company.state,
    country: company.country,
    latitude: company.latitude,
    longitude: company.longitude,
    rating: company.rating,
    reviewCount: company.review_count,
    openingHours: company.opening_hours,
    businessStatus: company.business_status,
    // Reprocessamento nunca grava lead_sources; nao precisa do retrato bruto original.
    rawMetadata: null,
  };
}
