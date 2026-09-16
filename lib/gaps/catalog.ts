import type { GapType, ObservationType, OfferType } from '@/types/spec2';
import { EXTERNAL_GAP_TYPES, INTERNAL_GAP_TYPES } from '@/types/spec2';

/**
 * Catalogo de gaps (SPEC 2.0 §12).
 *
 * Um gap e uma lacuna **observada**, com evidencia apontavel, e nunca um palpite.
 * Por isso cada entrada declara:
 *
 * - `requiredObservations`: o que precisa ter sido olhado para o gap sequer ser
 *   avaliavel. Se a auditoria nao conseguiu olhar, o gap nao e detectado — ele
 *   simplesmente nao existe ainda (SPEC 2.0 §3.2).
 * - `internal`: gaps internos (§12.2) nunca podem ser afirmados por auditoria
 *   externa. Eles entram no sistema por conversa ou diagnostico e nascem em
 *   `NEEDS_REVIEW`, nunca em `DETECTED`.
 * - `needPoints`: quanto o gap pesa no Need Score. E aqui que mora a regra de que
 *   `WEBSITE_UNKNOWN` nao vale o mesmo que `NO_WEBSITE` (§14.4): desconhecimento
 *   nao e oportunidade, e so um convite a pesquisar mais.
 */

export type GapDefinition = {
  type: GapType;
  label: string;
  description: string;
  recommendedOffer: OfferType;
  /** 0 a 100. Contribuicao maxima deste gap para o Need Score, com severidade e confianca plenas. */
  needPoints: number;
  /** Severidade padrao (1 a 5) quando o detector nao calcula uma propria. */
  defaultSeverity: number;
  /** Gap interno: exige confirmacao humana, nunca auditoria externa (SPEC 2.0 §12.2). */
  internal: boolean;
  /** Observacoes necessarias para o gap ser avaliavel. Vazio = nao depende de auditoria. */
  requiredObservations: ObservationType[];
};

export type GapEvidence = {
  id: string;
  user_id: string;
  company_id: string;
  type: ObservationType;
  value: boolean | null;
  status: 'OBSERVED' | 'INFERRED' | 'CONFIRMED' | 'REJECTED' | 'EXPIRED';
  observed_at: string;
  expires_at: string | null;
  source_url: string | null;
};

/**
 * Canonical, conjunctive evidence policy. Each tuple is an observation and the
 * value it must have. `null` means the gap cannot be promoted automatically and
 * must remain in human review. Migration 0009 mirrors this table and the
 * contract tests exercise every external gap in both directions.
 */
export const GAP_EVIDENCE_POLICY: Record<GapType, readonly (readonly [ObservationType, boolean])[] | null> = {
  NO_WEBSITE: [['WEBSITE_REACHABLE', false]],
  WEBSITE_UNKNOWN: null,
  WEAK_WEBSITE: null,
  NO_CONVERSION_PAGE: [['WEBSITE_REACHABLE', true], ['HAS_CTA', false]],
  NO_LEAD_CAPTURE: [['WEBSITE_REACHABLE', true], ['HAS_FORM', false]],
  NO_SCHEDULING: [['WEBSITE_REACHABLE', true], ['HAS_SCHEDULING', false]],
  POOR_SERVICE_PRESENTATION: [['WEBSITE_REACHABLE', true], ['HAS_SERVICE_PAGES', false]],
  WEAK_CTA: [['WEBSITE_REACHABLE', true], ['HAS_CTA', false]],
  NO_FAQ: [['WEBSITE_REACHABLE', true], ['HAS_FAQ', false]],
  WEAK_SOCIAL_DESTINATION: null,
  NO_QUOTE_FLOW: [['WEBSITE_REACHABLE', true], ['HAS_QUOTE_FLOW', false]],
  OUTDATED_INFORMATION: [['INFORMATION_OUTDATED', true]],
  MANUAL_FOLLOW_UP: null,
  MANUAL_PROPOSALS: null,
  REPETITIVE_SERVICE_MESSAGES: null,
  DISCONNECTED_WORKFLOW: null,
};

export const GAP_CATALOG: Record<GapType, GapDefinition> = {
  NO_WEBSITE: {
    type: 'NO_WEBSITE',
    label: 'Sem site confirmado',
    description: 'Ausencia de site confirmada por verificacao, nao apenas por omissao da fonte.',
    recommendedOffer: 'INSTITUTIONAL_WEBSITE',
    needPoints: 60,
    defaultSeverity: 5,
    internal: false,
    requiredObservations: ['WEBSITE_REACHABLE'],
  },
  /**
   * Nao e uma oportunidade: e a ausencia de informacao. Vale pouco de proposito, para
   * que um lead sobre o qual nada se sabe nunca dispute prioridade com um lead cujo
   * gap foi de fato observado (SPEC 2.0 §3.2/§14.4).
   */
  WEBSITE_UNKNOWN: {
    type: 'WEBSITE_UNKNOWN',
    label: 'Site nao verificado',
    description: 'A fonte nao informou site e ainda nao houve verificacao propria.',
    recommendedOffer: 'INSTITUTIONAL_WEBSITE',
    needPoints: 12,
    defaultSeverity: 1,
    internal: false,
    requiredObservations: [],
  },
  WEAK_WEBSITE: {
    type: 'WEAK_WEBSITE',
    label: 'Site com estrutura insuficiente',
    description: 'O site responde, mas nao sustenta os elementos basicos de uma pagina comercial.',
    recommendedOffer: 'WEBSITE_REDESIGN',
    needPoints: 45,
    defaultSeverity: 4,
    internal: false,
    requiredObservations: ['WEBSITE_REACHABLE'],
  },
  NO_CONVERSION_PAGE: {
    type: 'NO_CONVERSION_PAGE',
    label: 'Sem pagina de conversao',
    description: 'Nao ha pagina orientada a uma acao comercial especifica.',
    recommendedOffer: 'LANDING_PAGE',
    needPoints: 40,
    defaultSeverity: 4,
    internal: false,
    requiredObservations: ['WEBSITE_REACHABLE', 'HAS_CTA'],
  },
  NO_LEAD_CAPTURE: {
    type: 'NO_LEAD_CAPTURE',
    label: 'Sem captura de contato',
    description: 'Nao ha formulario nem mecanismo identificavel de captura de contato.',
    recommendedOffer: 'QUALIFICATION_FORM',
    needPoints: 38,
    defaultSeverity: 4,
    internal: false,
    requiredObservations: ['WEBSITE_REACHABLE', 'HAS_FORM'],
  },
  NO_SCHEDULING: {
    type: 'NO_SCHEDULING',
    label: 'Sem agendamento',
    description: 'Nenhum recurso de agendamento identificado nas paginas publicas.',
    recommendedOffer: 'SCHEDULING_PAGE',
    needPoints: 30,
    defaultSeverity: 3,
    internal: false,
    requiredObservations: ['WEBSITE_REACHABLE', 'HAS_SCHEDULING'],
  },
  POOR_SERVICE_PRESENTATION: {
    type: 'POOR_SERVICE_PRESENTATION',
    label: 'Servicos pouco explicados',
    description: 'Os servicos nao tem paginas ou secoes proprias que os expliquem.',
    recommendedOffer: 'SERVICE_CATALOG',
    needPoints: 28,
    defaultSeverity: 3,
    internal: false,
    requiredObservations: ['WEBSITE_REACHABLE', 'HAS_SERVICE_PAGES'],
  },
  WEAK_CTA: {
    type: 'WEAK_CTA',
    label: 'Proxima acao pouco clara',
    description: 'O visitante nao encontra uma proxima acao evidente.',
    recommendedOffer: 'LANDING_PAGE',
    needPoints: 25,
    defaultSeverity: 3,
    internal: false,
    requiredObservations: ['WEBSITE_REACHABLE', 'HAS_CTA'],
  },
  NO_FAQ: {
    type: 'NO_FAQ',
    label: 'Sem FAQ',
    description: 'Duvidas comuns nao sao respondidas publicamente.',
    recommendedOffer: 'FAQ_PAGE',
    needPoints: 18,
    defaultSeverity: 2,
    internal: false,
    requiredObservations: ['WEBSITE_REACHABLE', 'HAS_FAQ'],
  },
  WEAK_SOCIAL_DESTINATION: {
    type: 'WEAK_SOCIAL_DESTINATION',
    label: 'Rede social sem destino',
    description: 'Ha rede social ativa, mas nenhum destino de conversao a partir dela.',
    recommendedOffer: 'BIO_PAGE',
    needPoints: 30,
    defaultSeverity: 3,
    internal: false,
    requiredObservations: [],
  },
  NO_QUOTE_FLOW: {
    type: 'NO_QUOTE_FLOW',
    label: 'Sem fluxo de orcamento',
    description: 'Nao ha caminho estruturado para pedir orcamento.',
    recommendedOffer: 'QUOTE_FORM',
    needPoints: 32,
    defaultSeverity: 3,
    internal: false,
    requiredObservations: ['WEBSITE_REACHABLE', 'HAS_QUOTE_FLOW'],
  },
  OUTDATED_INFORMATION: {
    type: 'OUTDATED_INFORMATION',
    label: 'Informacao desatualizada',
    description: 'Dados publicos inconsistentes entre si ou visivelmente antigos.',
    recommendedOffer: 'WEBSITE_REDESIGN',
    needPoints: 22,
    defaultSeverity: 2,
    internal: false,
    requiredObservations: ['INFORMATION_OUTDATED'],
  },

  // Gaps internos (SPEC 2.0 §12.2) — so entram por conversa ou diagnostico.
  MANUAL_FOLLOW_UP: {
    type: 'MANUAL_FOLLOW_UP',
    label: 'Follow-up manual',
    description: 'O acompanhamento de clientes depende de memoria e planilha.',
    recommendedOffer: 'MINI_CRM',
    needPoints: 35,
    defaultSeverity: 4,
    internal: true,
    requiredObservations: [],
  },
  MANUAL_PROPOSALS: {
    type: 'MANUAL_PROPOSALS',
    label: 'Propostas manuais',
    description: 'Cada proposta e montada do zero, manualmente.',
    recommendedOffer: 'PROPOSAL_GENERATOR',
    needPoints: 30,
    defaultSeverity: 3,
    internal: true,
    requiredObservations: [],
  },
  REPETITIVE_SERVICE_MESSAGES: {
    type: 'REPETITIVE_SERVICE_MESSAGES',
    label: 'Atendimento repetitivo',
    description: 'A equipe responde as mesmas perguntas o tempo todo.',
    recommendedOffer: 'FAQ_PAGE',
    needPoints: 25,
    defaultSeverity: 3,
    internal: true,
    requiredObservations: [],
  },
  DISCONNECTED_WORKFLOW: {
    type: 'DISCONNECTED_WORKFLOW',
    label: 'Processo desconectado',
    description: 'Sistemas e etapas nao conversam entre si.',
    recommendedOffer: 'CUSTOM_AUTOMATION',
    needPoints: 40,
    defaultSeverity: 4,
    internal: true,
    requiredObservations: [],
  },
};

export function gapDefinition(type: GapType): GapDefinition {
  return GAP_CATALOG[type];
}

export function isInternalGap(type: GapType): boolean {
  return GAP_CATALOG[type].internal;
}

export function isExternalGap(type: GapType): type is (typeof EXTERNAL_GAP_TYPES)[number] {
  return !GAP_CATALOG[type].internal;
}

export const EXTERNAL_GAPS = EXTERNAL_GAP_TYPES;
export const INTERNAL_GAPS = INTERNAL_GAP_TYPES;

/**
 * Um gap so pode ser avaliado quando todas as observacoes que ele exige foram
 * conclusivas. `null` numa observacao significa "nao consegui olhar" e derruba a
 * avaliacao inteira — nao vira `false` nem gap detectado (SPEC 2.0 §3.1/§3.2).
 */
export function isGapEvaluable(
  type: GapType,
  observations: Partial<Record<ObservationType, boolean | null>>,
): boolean {
  return GAP_CATALOG[type].requiredObservations.every(
    (required) => typeof observations[required] === 'boolean',
  );
}

/**
 * Estado inicial correto de um gap recem-identificado (SPEC 2.0 §12.4).
 * Gap interno nunca nasce `DETECTED`: falta a confirmacao humana que so a conversa da.
 */
export function initialGapStatus(type: GapType): 'DETECTED' | 'NEEDS_REVIEW' {
  return GAP_CATALOG[type].internal ? 'NEEDS_REVIEW' : 'DETECTED';
}

/** Checks ownership, freshness and semantic compatibility of an observation. */
export function evidenceSupportsGap(
  evidence: GapEvidence,
  gap: GapType,
  userId: string,
  companyId: string,
  decisionAt: string,
): boolean {
  if (evidence.user_id !== userId || evidence.company_id !== companyId) return false;
  if (!['OBSERVED', 'CONFIRMED'].includes(evidence.status)) return false;
  if (evidence.expires_at && Date.parse(evidence.expires_at) <= Date.parse(decisionAt)) return false;
  if (!evidence.source_url || !Number.isFinite(Date.parse(evidence.observed_at))) return false;
  const policy = GAP_EVIDENCE_POLICY[gap];
  return Boolean(policy?.some(([type, value]) => type === evidence.type && value === evidence.value));
}

/** All clauses must be supported by distinct, valid records; one observation is never enough. */
export function evidenceSetSupportsGap(
  evidence: readonly GapEvidence[], gap: GapType, userId: string, companyId: string, decisionAt: string,
): boolean {
  const policy = GAP_EVIDENCE_POLICY[gap];
  if (!policy?.length) return false;
  return policy.every(([type, value]) => evidence.some((item) =>
    item.type === type && item.value === value &&
    evidenceSupportsGap(item, gap, userId, companyId, decisionAt),
  ));
}
