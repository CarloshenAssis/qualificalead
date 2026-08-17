import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Company } from '@/types/database';
import type { SourceId } from './types';

/**
 * Identidade neutra por fonte (SPEC 1.2 FASE 6): `lead_sources` e a fonte de verdade —
 * uma empresa pode ter varias linhas (uma por fonte que a encontrou), todas apontando
 * para o mesmo `company_id`. `google_place_id`/`dedup_key` continuam existindo em
 * `companies` por compatibilidade com a 1.1, mas deixam de ser a identidade
 * arquitetural: quem decide "essa empresa ja existe?" e "quais capacidades ela tem?"
 * e sempre `lead_sources`.
 */

/** Todas as fontes que ja contribuiram para cada empresa, buscadas em lote (evita N+1). */
export async function loadCompanySources(
  supabase: SupabaseClient,
  companyIds: string[],
): Promise<Map<string, SourceId[]>> {
  const map = new Map<string, SourceId[]>();
  if (!companyIds.length) return map;

  const { data, error } = await supabase
    .from('lead_sources')
    .select('company_id, source')
    .in('company_id', companyIds);

  if (error || !data) return map;

  for (const row of data as { company_id: string; source: SourceId }[]) {
    const list = map.get(row.company_id) ?? [];
    list.push(row.source);
    map.set(row.company_id, list);
  }

  return map;
}

/**
 * Fallback usado apenas quando uma empresa ainda nao tem nenhuma linha em `lead_sources`
 * (nao deveria acontecer para empresas criadas apos a migration 0004, cujo backfill
 * preenche todas as existentes — mas protege contra uma falha isolada de escrita).
 * `source_data` (jsonb, preenchido desde a FASE 4) e o unico sinal que sobra nesse caso;
 * sem ele, sem `google_place_id`, a origem nunca e inferida — vira `LEGACY`.
 */
export function inferCompanySource(
  company: Pick<Company, 'source_data' | 'google_place_id'>,
): { source: SourceId; sourceId: string | null } {
  const sourceData = company.source_data as { source?: SourceId; source_id?: string } | null;
  if (sourceData?.source && sourceData.source_id) {
    return { source: sourceData.source, sourceId: sourceData.source_id };
  }
  if (company.google_place_id) {
    return { source: 'GOOGLE_PLACES', sourceId: company.google_place_id };
  }
  // Nunca usar um id interno (ex.: company.id) como se fosse um identificador externo:
  // `LEGACY` sem origem conhecida realmente nao tem um source_id (SPEC 1.2 FASE 6).
  return { source: 'LEGACY', sourceId: null };
}
