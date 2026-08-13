import type { BriefingManualData, Company } from '@/types/database';
import { formatScoreBreakdown } from '@/lib/scoring/score';
import { instagramConfidenceLabel, levelLabel } from '@/lib/scoring/config';
import { formatPhoneDisplay, whatsappLink } from '@/lib/whatsapp/phone';

/**
 * Briefing deterministico montado apenas com o que foi observado (SPEC 25).
 * Lacuna permanece lacuna: nada e preenchido por suposicao (SPEC 3.1/45).
 */

export const NOT_FOUND_LABEL = 'Nao encontrado';
export const NOT_INFORMED_LABEL = 'Nao informado';

function value(input: string | null | undefined, fallback = NOT_FOUND_LABEL): string {
  const text = input?.toString().trim();
  return text ? text : fallback;
}

function section(title: string, lines: (string | null)[]): string {
  const content = lines.filter((line): line is string => Boolean(line && line.trim()));
  return [title, ...(content.length ? content : ['- ' + NOT_FOUND_LABEL])].join('\n');
}

/** Campos coletados que existem / faltam — alimenta as secoes de lacunas. */
function auditFields(company: Company) {
  const checks: { label: string; present: boolean }[] = [
    { label: 'Nome', present: Boolean(company.name) },
    { label: 'Categoria', present: Boolean(company.category) },
    { label: 'Endereco', present: Boolean(company.address) },
    { label: 'Telefone', present: Boolean(company.phone || company.phone_international) },
    { label: 'Website', present: company.website_status === 'HAS_WEBSITE' },
    { label: 'Instagram', present: Boolean(company.instagram_url) },
    { label: 'Avaliacao no Google', present: company.rating !== null },
    { label: 'Quantidade de avaliacoes', present: company.review_count !== null },
    { label: 'Horario de funcionamento', present: Boolean(company.opening_hours?.length) },
    { label: 'Descricao publica', present: Boolean(company.description) },
  ];

  return {
    present: checks.filter((c) => c.present).map((c) => c.label),
    missing: checks.filter((c) => !c.present).map((c) => c.label),
  };
}

/** Estrutura de site sugerida a partir do que existe — sem prometer conteudo inexistente. */
export function suggestedSiteStructure(company: Company, manual: BriefingManualData): string[] {
  const pages = [
    'Home (identidade, proposta de valor, CTA de WhatsApp)',
    'Sobre (historia e diferenciais — conteudo a ser confirmado com o cliente)',
  ];

  if (manual.services?.trim()) pages.push('Servicos (lista informada pelo cliente)');
  else pages.push('Servicos (a definir com o cliente)');

  if (manual.menu?.trim()) pages.push('Cardapio (conteudo informado pelo cliente)');
  if (manual.products?.trim()) pages.push('Produtos (conteudo informado pelo cliente)');

  if (company.rating !== null && (company.review_count ?? 0) > 0) {
    pages.push(`Prova social (avaliacao ${company.rating} com ${company.review_count} avaliacoes no Google)`);
  }

  pages.push('Contato (telefone, WhatsApp, endereco e mapa)');

  if (company.instagram_url && company.instagram_status === 'CONFIRMED') {
    pages.push('Integracao com Instagram confirmado');
  }

  return pages;
}

export function buildBriefing(company: Company, manual: BriefingManualData = {}): string {
  const audit = auditFields(company);
  const wa = whatsappLink(company.phone_international ?? company.phone);

  const instagramLine = company.instagram_url
    ? `- Perfil: ${company.instagram_handle ?? company.instagram_url}\n- Confianca: ${instagramConfidenceLabel(
        company.instagram_confidence ?? 0,
      )} (${company.instagram_confidence ?? 0}/100)\n- Situacao: ${company.instagram_status}`
    : `- ${NOT_FOUND_LABEL}`;

  const websiteLine =
    company.website_status === 'HAS_WEBSITE' && company.website
      ? `- Site identificado: ${company.website}`
      : '- Site nao identificado na fonte consultada';

  const pending = [
    ...audit.missing.map((field) => `- ${field}`),
    company.instagram_status === 'PENDING'
      ? '- Confirmar se o perfil de Instagram encontrado pertence mesmo a empresa'
      : null,
    company.website_status === 'NO_WEBSITE_DETECTED'
      ? '- Confirmar com a empresa se realmente nao existe site'
      : null,
  ].filter((line): line is string => Boolean(line));

  const manualLines = [
    manual.description?.trim() ? `- Descricao (cliente): ${manual.description.trim()}` : null,
    manual.services?.trim() ? `- Servicos: ${manual.services.trim()}` : null,
    manual.products?.trim() ? `- Produtos: ${manual.products.trim()}` : null,
    manual.differentials?.trim() ? `- Diferenciais: ${manual.differentials.trim()}` : null,
    manual.colors?.trim() ? `- Cores: ${manual.colors.trim()}` : null,
    manual.logo_url?.trim() ? `- Logo: ${manual.logo_url.trim()}` : null,
    manual.photos?.trim() ? `- Fotos: ${manual.photos.trim()}` : null,
    manual.menu?.trim() ? `- Cardapio: ${manual.menu.trim()}` : null,
    manual.prices?.trim() ? `- Precos: ${manual.prices.trim()}` : null,
    manual.institutional?.trim() ? `- Institucional: ${manual.institutional.trim()}` : null,
    manual.links?.trim() ? `- Links: ${manual.links.trim()}` : null,
    manual.notes?.trim() ? `- Observacoes: ${manual.notes.trim()}` : null,
  ].filter((line): line is string => Boolean(line));

  return [
    'BRIEFING PARA PRODUCAO DE SITE',
    '',
    section('NOME DA EMPRESA', [`- ${value(company.name)}`]),
    '',
    section('SEGMENTO', [`- ${value(company.category)}`]),
    '',
    section('LOCALIZACAO', [
      `- Endereco: ${value(company.address)}`,
      `- Cidade: ${value(company.city)}`,
      `- Estado: ${value(company.state)}`,
      `- Pais: ${value(company.country)}`,
    ]),
    '',
    section('CONTATOS', [
      `- Telefone: ${value(formatPhoneDisplay(company.phone))}`,
      `- Telefone internacional: ${value(company.phone_international)}`,
      `- WhatsApp: ${value(wa)}`,
    ]),
    '',
    section('GOOGLE', [
      `- Avaliacao: ${company.rating !== null ? company.rating : NOT_FOUND_LABEL}`,
      `- Quantidade de avaliacoes: ${company.review_count ?? NOT_FOUND_LABEL}`,
      `- Situacao: ${value(company.business_status)}`,
      `- Ficha: ${value(company.google_maps_url)}`,
      company.opening_hours?.length
        ? `- Horarios:\n${company.opening_hours.map((h) => `  ${h}`).join('\n')}`
        : `- Horarios: ${NOT_FOUND_LABEL}`,
    ]),
    '',
    section('PRESENCA DIGITAL', [websiteLine]),
    '',
    section('INSTAGRAM', [instagramLine]),
    '',
    section('DESCRICAO ENCONTRADA', [`- ${value(company.description, NOT_FOUND_LABEL)}`]),
    '',
    section(
      'DADOS IDENTIFICADOS',
      audit.present.map((f) => `- ${f}`),
    ),
    '',
    section(
      'DADOS AUSENTES',
      audit.missing.length ? audit.missing.map((f) => `- ${f}`) : ['- Nenhum'],
    ),
    '',
    section(
      'INFORMACOES QUE PRECISAM SER CONFIRMADAS',
      pending.length ? pending : ['- Nenhuma'],
    ),
    '',
    section(
      'INFORMACOES FORNECIDAS MANUALMENTE',
      manualLines.length ? manualLines : [`- ${NOT_INFORMED_LABEL}`],
    ),
    '',
    section(
      'SUGESTAO DE ESTRUTURA DO SITE',
      suggestedSiteStructure(company, manual).map((p) => `- ${p}`),
    ),
    '',
    section('OPORTUNIDADE', [
      `- Classificacao: ${levelLabel(company.opportunity_level)}`,
      formatScoreBreakdown(company.opportunity_score, company.score_breakdown ?? [])
        .split('\n')
        .map((l) => (l ? `- ${l}` : null))
        .filter((l): l is string => Boolean(l))
        .join('\n'),
    ]),
  ].join('\n');
}
