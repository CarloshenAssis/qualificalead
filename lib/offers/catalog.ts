import type { DemoType, GapType, ObservationType, OfferType } from '@/types/spec2';
import { GAP_CATALOG } from '@/lib/gaps/catalog';

/**
 * Catalogo de ofertas (SPEC 2.0 §13).
 *
 * A oferta e uma consequencia do gap, nunca do humor da campanha: a empresa recebe
 * a proposta que responde ao problema observado nela. Cada entrada declara os gaps
 * que ela resolve e a **evidencia minima** — sem essa evidencia a oferta nao pode
 * ser recomendada, porque a mensagem que a acompanha nao teria o que citar
 * (SPEC 2.0 §3.1/§17.6).
 */

export type OfferDefinition = {
  type: OfferType;
  name: string;
  description: string;
  /** Faixa de preco em centavos. `null` quando o usuario ainda nao definiu. */
  priceRangeCents: { min: number; max: number } | null;
  estimatedDays: number;
  compatibleGaps: GapType[];
  /** Vazio = serve a qualquer segmento. */
  compatibleSegments: string[];
  /** Observacoes que precisam existir para a oferta poder ser recomendada. */
  minimumEvidence: ObservationType[];
  recommendedCta: string;
  demoType: DemoType;
  /** Tempo maximo aceitavel para produzir a previa desta oferta. */
  maxPreviewHours: number;
  isActive: boolean;
};

function offer(
  type: OfferType,
  name: string,
  description: string,
  estimatedDays: number,
  compatibleGaps: GapType[],
  minimumEvidence: ObservationType[],
  recommendedCta: string,
  demoType: DemoType,
  maxPreviewHours: number,
): OfferDefinition {
  return {
    type,
    name,
    description,
    // Preco e decisao comercial do usuario: o catalogo nao inventa faixa (SPEC 2.0 §3.3).
    priceRangeCents: null,
    estimatedDays,
    compatibleGaps,
    compatibleSegments: [],
    minimumEvidence,
    recommendedCta,
    demoType,
    maxPreviewHours,
    isActive: true,
  };
}

export const OFFER_CATALOG: Record<OfferType, OfferDefinition> = {
  INSTITUTIONAL_WEBSITE: offer(
    'INSTITUTIONAL_WEBSITE',
    'Site institucional',
    'Presenca digital propria para uma empresa que hoje nao tem site.',
    10,
    ['NO_WEBSITE', 'WEBSITE_UNKNOWN'],
    [],
    'Posso te mostrar como ficaria?',
    'LIGHT_PREVIEW',
    4,
  ),
  WEBSITE_REDESIGN: offer(
    'WEBSITE_REDESIGN',
    'Reformulacao de site',
    'Reconstrucao de um site que existe mas nao sustenta o trabalho comercial.',
    12,
    ['WEAK_WEBSITE', 'OUTDATED_INFORMATION'],
    ['WEBSITE_REACHABLE'],
    'Quer ver o que eu mudaria primeiro?',
    'LIGHT_PREVIEW',
    4,
  ),
  LANDING_PAGE: offer(
    'LANDING_PAGE',
    'Landing page',
    'Pagina unica orientada a uma acao comercial especifica.',
    5,
    ['NO_CONVERSION_PAGE', 'WEAK_CTA'],
    ['WEBSITE_REACHABLE'],
    'Posso enviar um esboco da pagina?',
    'LIGHT_PREVIEW',
    3,
  ),
  BIO_PAGE: offer(
    'BIO_PAGE',
    'Pagina de bio',
    'Destino de conversao para quem chega pela rede social.',
    2,
    ['WEAK_SOCIAL_DESTINATION'],
    [],
    'Quer ver como ficaria o link da bio?',
    'LIGHT_PREVIEW',
    2,
  ),
  SERVICE_CATALOG: offer(
    'SERVICE_CATALOG',
    'Catalogo de servicos',
    'Paginas proprias explicando cada servico oferecido.',
    7,
    ['POOR_SERVICE_PRESENTATION'],
    ['WEBSITE_REACHABLE'],
    'Posso montar a estrutura dos servicos?',
    'TEXT_DIAGNOSIS',
    3,
  ),
  QUALIFICATION_FORM: offer(
    'QUALIFICATION_FORM',
    'Formulario de qualificacao',
    'Captura de contato que ja chega triada.',
    3,
    ['NO_LEAD_CAPTURE'],
    ['WEBSITE_REACHABLE'],
    'Quer ver as perguntas que eu usaria?',
    'TEXT_DIAGNOSIS',
    2,
  ),
  QUOTE_FORM: offer(
    'QUOTE_FORM',
    'Formulario de orcamento',
    'Caminho estruturado para o cliente pedir orcamento.',
    3,
    ['NO_QUOTE_FLOW'],
    ['WEBSITE_REACHABLE'],
    'Posso te mandar o fluxo de orcamento?',
    'TEXT_DIAGNOSIS',
    2,
  ),
  SCHEDULING_PAGE: offer(
    'SCHEDULING_PAGE',
    'Pagina de agendamento',
    'Agendamento online sem depender de troca de mensagens.',
    4,
    ['NO_SCHEDULING'],
    ['WEBSITE_REACHABLE'],
    'Quer ver como seria o agendamento?',
    'LIGHT_PREVIEW',
    3,
  ),
  FAQ_PAGE: offer(
    'FAQ_PAGE',
    'FAQ estruturado',
    'Respostas publicas para as duvidas que se repetem.',
    3,
    ['NO_FAQ', 'REPETITIVE_SERVICE_MESSAGES'],
    [],
    'Posso listar as duvidas mais comuns do seu setor?',
    'TEXT_DIAGNOSIS',
    2,
  ),
  MINI_CRM: offer(
    'MINI_CRM',
    'Mini-CRM',
    'Acompanhamento de clientes sem depender de memoria.',
    15,
    ['MANUAL_FOLLOW_UP'],
    [],
    'Quer ver como ficaria o acompanhamento?',
    'PROTOTYPE',
    8,
  ),
  PROPOSAL_GENERATOR: offer(
    'PROPOSAL_GENERATOR',
    'Gerador de propostas',
    'Propostas padronizadas geradas a partir de um modelo.',
    10,
    ['MANUAL_PROPOSALS'],
    [],
    'Posso te mostrar o gerador funcionando?',
    'PROTOTYPE',
    6,
  ),
  CUSTOM_AUTOMATION: offer(
    'CUSTOM_AUTOMATION',
    'Automacao sob medida',
    'Integracao entre etapas que hoje nao conversam.',
    20,
    ['DISCONNECTED_WORKFLOW'],
    [],
    'Vale uma conversa de diagnostico?',
    'TEXT_DIAGNOSIS',
    8,
  ),
};

export function offerDefinition(type: OfferType): OfferDefinition {
  return OFFER_CATALOG[type];
}

/** Ofertas que resolvem um gap, na ordem em que o catalogo as declara. */
export function offersForGap(gap: GapType): OfferDefinition[] {
  return Object.values(OFFER_CATALOG).filter(
    (candidate) => candidate.isActive && candidate.compatibleGaps.includes(gap),
  );
}

export type OfferRecommendation = {
  offer: OfferType | null;
  /** Por que esta oferta (ou por que nenhuma). Sempre preenchido. */
  reason: string;
};

/**
 * Recomenda a oferta para um gap (SPEC 2.0 §33.2: "oferta e recomendada por regras
 * versionadas"). A regra e deliberadamente simples e deterministica: o gap manda.
 *
 * `availableObservations` filtra por evidencia minima — uma oferta que precisa do
 * site alcancavel nao pode ser recomendada para uma empresa cujo site nunca foi
 * alcancado, porque a mensagem que a acompanha nao teria o que citar.
 */
export function recommendOffer(
  gap: GapType | null,
  availableObservations: ObservationType[] = [],
): OfferRecommendation {
  if (!gap) return { offer: null, reason: 'Nenhum gap identificado.' };

  const available = new Set(availableObservations);
  const candidates = offersForGap(gap);

  if (!candidates.length) {
    return { offer: null, reason: `Nenhuma oferta ativa cobre o gap ${gap}.` };
  }

  const preferred = GAP_CATALOG[gap].recommendedOffer;
  const ordered = candidates.sort((a, b) => {
    if (a.type === preferred) return -1;
    if (b.type === preferred) return 1;
    return 0;
  });

  const eligible = ordered.find((candidate) =>
    candidate.minimumEvidence.every((evidence) => available.has(evidence)),
  );

  if (!eligible) {
    return {
      offer: null,
      reason: `Evidencia minima ausente para as ofertas que cobrem ${gap}.`,
    };
  }

  return { offer: eligible.type, reason: `Oferta derivada do gap ${gap}.` };
}
