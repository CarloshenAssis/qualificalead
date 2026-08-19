import type { BriefingManualData, Company } from '@/types/database';
import { DEFAULT_SOURCE_LABEL, NOT_FOUND_LABEL, suggestedSiteStructure } from './generate';
import { formatPhoneDisplay, whatsappLink } from '@/lib/whatsapp/phone';

/**
 * Prompt pronto para colar no Lovable (SPEC 27).
 * Inclui explicitamente o que NAO se sabe, para que a ferramenta nao invente conteudo.
 */
export function buildLovablePrompt(
  company: Company,
  manual: BriefingManualData = {},
  sourceLabel: string = DEFAULT_SOURCE_LABEL,
): string {
  const wa = whatsappLink(company.phone_international ?? company.phone);
  const location = [company.city, company.state].filter(Boolean).join(' - ');

  const known: string[] = [
    `Nome: ${company.name}`,
    `Fonte dos dados: ${sourceLabel}`,
    company.category ? `Segmento: ${company.category}` : null,
    location ? `Cidade/Estado: ${location}` : null,
    company.address ? `Endereco: ${company.address}` : null,
    company.phone ? `Telefone: ${formatPhoneDisplay(company.phone)}` : null,
    wa ? `WhatsApp: ${wa}` : null,
    company.rating !== null ? `Avaliacao: ${company.rating} (${company.review_count ?? 0} avaliacoes)` : null,
    company.instagram_url && company.instagram_status === 'CONFIRMED'
      ? `Instagram confirmado: ${company.instagram_url}`
      : null,
    company.opening_hours?.length ? `Horarios: ${company.opening_hours.join(' | ')}` : null,
    company.description ? `Descricao publica: ${company.description}` : null,
    manual.description?.trim() ? `Descricao fornecida pelo cliente: ${manual.description.trim()}` : null,
    manual.services?.trim() ? `Servicos: ${manual.services.trim()}` : null,
    manual.products?.trim() ? `Produtos: ${manual.products.trim()}` : null,
    manual.differentials?.trim() ? `Diferenciais: ${manual.differentials.trim()}` : null,
    manual.menu?.trim() ? `Cardapio: ${manual.menu.trim()}` : null,
    manual.prices?.trim() ? `Precos: ${manual.prices.trim()}` : null,
    manual.colors?.trim() ? `Paleta desejada: ${manual.colors.trim()}` : null,
    manual.logo_url?.trim() ? `Logo: ${manual.logo_url.trim()}` : null,
    manual.photos?.trim() ? `Fotos disponiveis: ${manual.photos.trim()}` : null,
    manual.institutional?.trim() ? `Institucional: ${manual.institutional.trim()}` : null,
    manual.links?.trim() ? `Links: ${manual.links.trim()}` : null,
  ].filter((line): line is string => Boolean(line));

  // Encontrado, porem sem confirmacao humana: entra em secao separada (SPEC 1.1 §38).
  const pending: string[] = [
    company.instagram_url && company.instagram_status === 'PENDING'
      ? `Instagram ${company.instagram_handle ?? company.instagram_url} (confianca ${
          company.instagram_confidence ?? 0
        }/100, ainda nao confirmado — nao apresentar como perfil oficial)`
      : null,
    company.website_status === 'UNKNOWN'
      ? 'Existencia de site (nao foi possivel verificar)'
      : null,
    company.website_status === 'NO_WEBSITE_DETECTED'
      ? 'Ausencia de site (a fonte consultada nao informou site; confirmar com o cliente)'
      : null,
  ].filter((line): line is string => Boolean(line));

  const unknown: string[] = [
    !company.phone ? 'Telefone' : null,
    !company.address ? 'Endereco completo' : null,
    !manual.services?.trim() ? 'Lista de servicos' : null,
    !manual.differentials?.trim() ? 'Diferenciais da empresa' : null,
    !manual.logo_url?.trim() ? 'Logo' : null,
    !manual.colors?.trim() ? 'Paleta de cores da marca' : null,
    !manual.photos?.trim() ? 'Fotos reais' : null,
    !manual.prices?.trim() ? 'Precos' : null,
    company.instagram_status !== 'CONFIRMED' ? 'Instagram confirmado' : null,
    !company.opening_hours?.length ? 'Horario de funcionamento' : null,
  ].filter((line): line is string => Boolean(line));

  const structure = suggestedSiteStructure(company, manual);

  return [
    `Crie um site institucional moderno, leve e 100% responsivo para a empresa "${company.name}".`,
    '',
    'CONTEXTO',
    `- Segmento: ${company.category ?? NOT_FOUND_LABEL}`,
    `- Publico: clientes locais${location ? ` de ${location}` : ''}`,
    '- Objetivo principal: gerar contato via WhatsApp',
    '',
    'DADOS CONFIRMADOS (use exatamente como estao)',
    ...known.map((line) => `- ${line}`),
    '',
    'DADOS A CONFIRMAR (nao trate como fato)',
    ...(pending.length ? pending.map((line) => `- ${line}`) : ['- Nenhum']),
    '',
    'DADOS QUE AINDA NAO EXISTEM',
    ...(unknown.length ? unknown.map((line) => `- ${line}`) : ['- Nenhum']),
    '',
    'REGRA CRITICA',
    '- Nao invente informacoes sobre a empresa.',
    '- Quando um dado estiver ausente ou marcado como pendente, nao crie conteudo factual para preenche-lo.',
    '- Utilize placeholders no formato [PREENCHER: item] para informacoes que precisam ser confirmadas.',
    '- NAO invente dados de contato, precos, servicos, depoimentos, premios, numeros ou historia da empresa.',
    '- Nao gere depoimentos ficticios nem avaliacoes falsas.',
    '',
    'ESTRUTURA SUGERIDA',
    ...structure.map((page, index) => `${index + 1}. ${page}`),
    '',
    'REQUISITOS TECNICOS',
    '- Mobile-first e totalmente responsivo (celular, tablet, desktop).',
    '- Performance: imagens otimizadas e carregamento rapido.',
    '- Acessibilidade: contraste adequado, foco visivel, labels e aria-labels.',
    wa
      ? `- Botao flutuante de WhatsApp em todas as telas apontando para ${wa} (sem mensagem automatica pre-enviada alem de uma saudacao simples).`
      : '- Botao de contato principal com placeholder [PREENCHER: telefone/WhatsApp].',
    '- CTA claro em todas as secoes.',
    '',
    'SEO LOCAL',
    `- Title e meta description mencionando "${company.name}"${
      location ? ` e "${location}"` : ''
    }.`,
    '- Dados estruturados schema.org/LocalBusiness com nome, endereco e telefone reais informados acima.',
    company.google_maps_url ? `- Link para a ficha: ${company.google_maps_url}` : null,
    '- Headings semanticos (um unico h1 por pagina).',
    '',
    'ESTILO',
    manual.colors?.trim()
      ? `- Paleta: ${manual.colors.trim()}`
      : '- Paleta: escolha uma paleta sobria coerente com o segmento e deixe as cores facilmente ajustaveis.',
    '- Visual claro, moderno, profissional e limpo. Sem excesso de gradientes ou sombras.',
    '- Tipografia legivel e hierarquia visual evidente.',
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
}
