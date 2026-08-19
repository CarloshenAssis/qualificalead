import type { SupabaseClient } from '@supabase/supabase-js';
import type { CompanyFilters } from '@/lib/validation/schemas';
import { INSTAGRAM_HIGH_CONFIDENCE_THRESHOLD } from '@/lib/scoring/config';

/** Tamanho de pagina da listagem (SPEC 36). */
export const PAGE_SIZE = 20;

const COMPANY_COLUMNS =
  '*, leads(id, status, priority), lead_sources(source, source_id, source_url, source_quality)';

/**
 * Aplica os filtros da SPEC 13 sobre a tabela `companies`.
 * Usado tanto pela listagem quanto pela exportacao, para que o arquivo
 * exportado respeite exatamente os filtros da tela (SPEC 29).
 */
export function applyCompanyFilters<T>(query: T, filters: CompanyFilters): T {
  // O builder do supabase-js e encadeavel; o cast mantem a tipagem util para quem chama.
  let q = query as unknown as {
    eq: (column: string, value: unknown) => typeof q;
    not: (column: string, operator: string, value: unknown) => typeof q;
    is: (column: string, value: unknown) => typeof q;
    gte: (column: string, value: unknown) => typeof q;
    ilike: (column: string, value: string) => typeof q;
    in: (column: string, values: unknown[]) => typeof q;
  };

  if (filters.website === 'without') q = q.eq('website_status', 'NO_WEBSITE_DETECTED');
  if (filters.website === 'with') q = q.eq('website_status', 'HAS_WEBSITE');

  if (filters.minRating !== undefined) q = q.gte('rating', filters.minRating);
  if (filters.minReviews !== undefined) q = q.gte('review_count', filters.minReviews);

  switch (filters.instagram) {
    case 'found':
      q = q.not('instagram_url', 'is', null);
      break;
    case 'not_found':
      q = q.is('instagram_url', null);
      break;
    case 'high_confidence':
      q = q.gte('instagram_confidence', INSTAGRAM_HIGH_CONFIDENCE_THRESHOLD);
      break;
    case 'pending':
      q = q.eq('instagram_status', 'PENDING');
      break;
    default:
      break;
  }

  if (filters.phone === 'available') q = q.not('phone', 'is', null);
  if (filters.phone === 'unavailable') q = q.is('phone', null);

  if (filters.level !== 'all') q = q.eq('opportunity_level', filters.level);
  if (filters.minScore !== undefined) q = q.gte('opportunity_score', filters.minScore);
  if (filters.city) q = q.ilike('city', `%${filters.city}%`);
  if (filters.q) q = q.ilike('name', `%${filters.q}%`);

  return q as unknown as T;
}

/** Coluna e direcao de cada ordenacao disponivel (SPEC 1.1 §47). */
export const SORT_OPTIONS = {
  score: { column: 'opportunity_score', ascending: false, label: 'Maior score' },
  rating: { column: 'rating', ascending: false, label: 'Melhor avaliacao' },
  reviews: { column: 'review_count', ascending: false, label: 'Mais avaliacoes' },
  recent: { column: 'created_at', ascending: false, label: 'Descobertas recentemente' },
  name: { column: 'name', ascending: true, label: 'Nome (A-Z)' },
} as const;

export type SortKey = keyof typeof SORT_OPTIONS;

/**
 * Ids de empresa que casam com o filtro de fonte (SPEC 1.2 FASE 7 §5), via a view
 * `company_source_summary` (migration 0005) — o PostgREST nao expressa
 * "mais de uma fonte distinta" (MULTI_SOURCE) sobre `lead_sources` crua, entao a
 * agregacao mora na view. `null` significa "sem filtro de fonte" (nao restringe nada);
 * um array (mesmo vazio) e a lista exata de ids a manter.
 */
async function companyIdsForSourceFilter(
  supabase: SupabaseClient,
  filters: CompanyFilters,
): Promise<string[] | null> {
  if (filters.source === 'all') return null;

  let query = supabase.from('company_source_summary').select('company_id, sources, source_count');
  query =
    filters.source === 'MULTI_SOURCE' ? query.gt('source_count', 1) : query.contains('sources', [filters.source]);

  const { data, error } = await query;
  if (error) {
    console.error('[companies] falha ao filtrar por fonte', { code: error.code });
    return [];
  }
  return (data ?? []).map((row) => row.company_id as string);
}

/** Listagem paginada com filtros combinados e ordenacao (SPEC 21/23, SPEC 1.1 §47/§48). */
export async function companiesQuery(supabase: SupabaseClient, userId: string, filters: CompanyFilters) {
  const from = (filters.page - 1) * PAGE_SIZE;
  const sort = SORT_OPTIONS[filters.sort];

  const sourceIds = await companyIdsForSourceFilter(supabase, filters);
  if (sourceIds && sourceIds.length === 0) {
    return { data: [], count: 0, error: null };
  }

  let base = supabase.from('companies').select(COMPANY_COLUMNS, { count: 'exact' }).eq('user_id', userId);
  if (sourceIds) base = base.in('id', sourceIds);

  return applyCompanyFilters(base, filters)
    .order(sort.column, { ascending: sort.ascending, nullsFirst: false })
    .order('review_count', { ascending: false, nullsFirst: false })
    .range(from, from + PAGE_SIZE - 1);
}

/** Mesma selecao, sem paginacao — usada na exportacao. */
export async function companiesExportQuery(
  supabase: SupabaseClient,
  userId: string,
  filters: CompanyFilters,
) {
  const sourceIds = await companyIdsForSourceFilter(supabase, filters);
  if (sourceIds && sourceIds.length === 0) {
    return { data: [], error: null };
  }

  let base = supabase.from('companies').select(COMPANY_COLUMNS).eq('user_id', userId);
  if (sourceIds) base = base.in('id', sourceIds);

  const sort = SORT_OPTIONS[filters.sort];

  return applyCompanyFilters(base, filters)
    .order(sort.column, { ascending: sort.ascending, nullsFirst: false })
    .limit(5000);
}
