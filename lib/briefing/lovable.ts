import type { BriefingManualData, Company } from '@/types/database';
import { NOT_FOUND_LABEL, suggestedSiteStructure } from './generate';
import { formatPhoneDisplay, whatsappLink } from '@/lib/whatsapp/phone';

/**
 * Prompt pronto para colar no Lovable (SPEC 27).
 * Inclui explicitamente o que NAO se sabe, para que a ferramenta nao invente conteudo.
 */
export function buildLovablePrompt(company: Company, manual: BriefingManualData = {}): string {
  const wa = whatsappLink(company.phone_international ?? company.phone);
  const location = [company.city, company.state].filter(Boolean).join(' - ');

  const known: string[] = [
    `Nome: ${company.name}`,
    company.category ? `Segmento: ${company.category}` : null,
    location ? `Cidade/Estado: ${location}` : null,
    company.address ? `Endereco: ${company.address}` : null,
    company.phone ? `Telefone: ${formatPhoneDisplay(company.phone)}` : null,
    wa ? `WhatsApp: ${wa}` : null,
    company.rating !== null
      ? `Avaliacao no Google: ${company.rating} (${company.review_count ?? 0} avaliacoes)`
      : null,
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
    'INFORMACOES CONFIRMADAS (use exatamente como estao)',
    ...known.map((line) => `- ${line}`),
    '',
    'INFORMACOES QUE AINDA NAO EXISTEM',
    ...(unknown.length ? unknown.map((line) => `- ${line}`) : ['- Nenhuma']),
    '',
    'REGRA CRITICA',
    '- NAO invente dados de contato, precos, servicos, depoimentos, premios, numeros ou historia da empresa.',
    '- Para qualquer informacao ausente, use um placeholder explicito no formato [PREENCHER: item].',
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
    company.google_maps_url ? `- Link para a ficha no Google: ${company.google_maps_url}` : null,
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
