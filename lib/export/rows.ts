import type { Company, LeadStatus } from '@/types/database';
import { NEXT_ACTION_LABELS, WEBSITE_STATUS_LABELS } from '@/types/database';
import { levelLabel } from '@/lib/scoring/config';
import { whatsappLink } from '@/lib/whatsapp/phone';

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
  'Google Maps',
  'Encontrada em',
] as const;

export function companyToRow(company: Company, leadStatus?: LeadStatus | null): string[] {
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
  ];
}
