import type { Company } from '@/types/database';
import type { SourceId } from './types';

/**
 * Recupera a fonte de uma empresa ja salva, sem depender de coluna nova no banco.
 *
 * A identidade neutra de verdade (uma tabela `lead_sources` que suporte varias fontes
 * por empresa) e trabalho de schema — fica para a FASE 6 (SPEC 1.2 §6, exigencia do
 * usuario de nao reduzir isso a "trocar `google_place_id` por outro campo escondido").
 * Ate la, `source_data` (jsonb ja existente) carrega `{ source, source_id }` desde a
 * FASE 4, e serve como o ponto de integracao que a FASE 6 vai promover a coluna/tabela.
 *
 * Empresas gravadas antes da 1.2 nao tem esses campos: caem no fallback abaixo, que
 * preserva o comportamento da 1.1 (toda empresa com `google_place_id` e tratada como
 * Google; sem ele, como `LEGACY`, sem inferir uma origem que nao foi registrada).
 */
export function inferCompanySource(
  company: Pick<Company, 'source_data' | 'google_place_id'>,
): { source: SourceId; sourceId: string } {
  const sourceData = company.source_data as { source?: SourceId; source_id?: string } | null;
  if (sourceData?.source && sourceData.source_id) {
    return { source: sourceData.source, sourceId: sourceData.source_id };
  }
  if (company.google_place_id) {
    return { source: 'GOOGLE_PLACES', sourceId: company.google_place_id };
  }
  return { source: 'LEGACY', sourceId: '' };
}
