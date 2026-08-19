import type { Company, LeadSource, LeadStatus } from '@/types/database';
import { NEXT_ACTION_LABELS, WEBSITE_STATUS_LABELS } from '@/types/database';
import { levelLabel } from '@/lib/scoring/config';
import { whatsappLink } from '@/lib/whatsapp/phone';

export type ExportSourceRow = Pick<LeadSource, 'source' | 'source_id' | 'source_url' | 'source_quality'>;

/** Colunas exportadas (SPEC 29) — mesma ordem no CSV e no XLSX. */
export const EXPORT_HEADERS = [
  'Nome',
  'Categoria',
  'Cidade',
  'Estado',
  'Endereco',
  'Telefone',
  'WhatsApp',
  'Website',
  'Situacao do site',
  'Instagram',
  'Confianca Instagram',
  'Situacao Instagram',
  'Avaliacao',
  'Qtd. avaliacoes',
  'Score',
  'Classificacao',
  'Qualidade do perfil Google',
  'Acao recomendada',
  'Status do lead',
  'Link da ficha',
  'Encontrada em',
  'source',
  'source_id',
  'source_url',
  'source_quality',
] as const;

/**
 * Uma celula por coluna, alinhada por indice: a N-esima fonte contribui a N-esima
 * posicao em cada uma das 4 colunas — nunca funde nem escolhe "a melhor" fonte,
 * para preservar a proveniencia completa mesmo em leads MULTI_SOURCE (SPEC 1.2 FASE 7 §7).
 */
function sourceColumn(sources: ExportSourceRow[], key: keyof ExportSourceRow): string {
  return sources.map((s) => s[key] ?? '').join('; ');
}

export function companyToRow(
  company: Company,
  leadStatus?: LeadStatus | null,
  sources: ExportSourceRow[] = [],
): string[] {
  return [
    company.name,
    company.category ?? '',
    company.city ?? '',
    company.state ?? '',
    company.address ?? '',
    company.phone ?? '',
    whatsappLink(company.phone_international ?? company.phone) ?? '',
    company.website ?? '',
    WEBSITE_STATUS_LABELS[company.website_status],
    company.instagram_url ?? '',
    company.instagram_confidence !== null ? String(company.instagram_confidence) : '',
    company.instagram_status,
    company.rating !== null ? String(company.rating) : '',
    company.review_count !== null ? String(company.review_count) : '',
    String(company.opportunity_score),
    levelLabel(company.opportunity_level),
    company.google_business_quality,
    NEXT_ACTION_LABELS[company.next_action],
    leadStatus ?? '',
    company.google_maps_url ?? '',
    company.created_at,
    sourceColumn(sources, 'source'),
    sourceColumn(sources, 'source_id'),
    sourceColumn(sources, 'source_url'),
    sourceColumn(sources, 'source_quality'),
  ];
}
