import type {
  GoogleBusinessQuality,
  InstagramStatus,
  LeadStatus,
  NextAction,
  OpportunityLevel,
  ScoreBreakdownItem,
  WebsiteStatus,
} from '@/types/database';
import type { SourceCapabilities } from '@/lib/prospecting/sources/types';
import {
  GOOGLE_PROFILE_MIN_FIELDS,
  GOOGLE_QUALITY,
  HIGH_RATING_THRESHOLD,
  INSTAGRAM_VERY_HIGH_CONFIDENCE_THRESHOLD,
  MAX_SCORE,
  NEXT_ACTION_RULES,
  OPPORTUNITY_LEVEL_RANGES,
  REVIEW_COUNT_TIERS,
  SCORE_WEIGHTS,
} from './config';

/**
 * Motor de qualificacao deterministico (SPEC 14/16/35, SPEC 1.1 §27-§33).
 * Nao depende de IA e nao estima probabilidade de compra: apenas soma sinais observaveis.
 *
 * Score relativo a fonte (SPEC 1.2 §34/§35): os pesos de `SCORE_WEIGHTS` nao mudam.
 * O que muda por fonte e **quais sinais entram na conta**. Um sinal que a fonte nao
 * consegue observar (ex.: rating no OSM) fica de fora tanto do numerador quanto do
 * denominador — nunca conta como ausencia. `SourceCoverage` mede, separadamente do
 * score comercial, quantos dos sinais possiveis essa fonte consegue avaliar, e capa
 * o nivel de oportunidade para nao deixar um lead com poucos dados parecer excelente.
 * Fontes com capacidade plena (Google, LEGACY) nunca sao capadas — o resultado para
 * elas e identico ao da 1.1.
 */

/** Todas as capacidades ligadas: usado quando o chamador nao informa a fonte (compat 1.1). */
const FULL_CAPABILITIES: SourceCapabilities = {
  rating: true,
  reviewCount: true,
  businessProfile: true,
  phone: true,
  website: true,
};

export type SourceCoverageLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export type SourceCoverage = {
  level: SourceCoverageLevel;
  /** Codigos de sinal que esta fonte consegue avaliar. */
  evaluableSignals: string[];
  /** Codigos de sinal que esta fonte nao consegue avaliar — nao contam a favor nem contra. */
  unavailableSignals: string[];
};

/** Os oito sinais que compoe o score comercial (SPEC 14). */
const SCORE_SIGNAL_CODES = [
  'NO_WEBSITE',
  'GOOGLE_PROFILE_COMPLETE',
  'HIGH_RATING',
  'REVIEW_COUNT',
  'INSTAGRAM_FOUND',
  'INSTAGRAM_HIGH_CONFIDENCE',
  'PHONE_AVAILABLE',
  'BUSINESS_ACTIVE',
] as const;
type ScoreSignalCode = (typeof SCORE_SIGNAL_CODES)[number];

/**
 * Instagram e sempre avaliavel: e um enriquecimento proprio do LeadHunter, independente
 * da fonte de descoberta. `BUSINESS_ACTIVE` depende de volume de avaliacoes como evidencia
 * de atividade — sem essa capacidade a pergunta simplesmente nao pode ser respondida.
 */
function isSignalEvaluable(code: ScoreSignalCode, capabilities: SourceCapabilities): boolean {
  switch (code) {
    case 'NO_WEBSITE':
      return capabilities.website;
    case 'GOOGLE_PROFILE_COMPLETE':
      return capabilities.businessProfile;
    case 'HIGH_RATING':
      return capabilities.rating;
    case 'REVIEW_COUNT':
      return capabilities.reviewCount;
    case 'INSTAGRAM_FOUND':
    case 'INSTAGRAM_HIGH_CONFIDENCE':
      return true;
    case 'PHONE_AVAILABLE':
      return capabilities.phone;
    case 'BUSINESS_ACTIVE':
      return capabilities.reviewCount;
  }
}

export function computeSourceCoverage(capabilities: SourceCapabilities): SourceCoverage {
  const evaluableSignals: string[] = [];
  const unavailableSignals: string[] = [];

  for (const code of SCORE_SIGNAL_CODES) {
    (isSignalEvaluable(code, capabilities) ? evaluableSignals : unavailableSignals).push(code);
  }

  const ratio = evaluableSignals.length / SCORE_SIGNAL_CODES.length;
  const level: SourceCoverageLevel = ratio >= 1 ? 'HIGH' : ratio >= 0.5 ? 'MEDIUM' : 'LOW';

  return { level, evaluableSignals, unavailableSignals };
}

/**
 * Guarda contra inflacao: poucos sinais avaliaveis nao podem produzir um nivel de
 * oportunidade que sugira confianca que os dados nao sustentam. Cobertura plena nunca
 * e capada — e o caso do Google e da LEGACY, o que preserva o resultado da 1.1.
 */
function capLevelByCoverage(level: OpportunityLevel, coverage: SourceCoverageLevel): OpportunityLevel {
  if (coverage === 'HIGH') return level;
  if (coverage === 'MEDIUM') return level === 'EXCELENTE' ? 'ALTA' : level;
  return level === 'EXCELENTE' || level === 'ALTA' ? 'MEDIA' : level;
}

export type ScoreInput = {
  website_status: WebsiteStatus;
  rating: number | null;
  review_count: number | null;
  phone: string | null;
  instagram_url: string | null;
  instagram_confidence: number | null;
  instagram_status: InstagramStatus;
  business_status: string | null;
  address: string | null;
  category: string | null;
  opening_hours: string[] | null;
  description: string | null;
  google_maps_url: string | null;
};

export type ScoreResult = {
  score: number;
  level: OpportunityLevel;
  breakdown: ScoreBreakdownItem[];
  /** Separado do score comercial (SPEC 1.2 §35): nunca soma nem subtrai pontos. */
  coverage: SourceCoverage;
};

function reviewCountPoints(reviewCount: number): number {
  return REVIEW_COUNT_TIERS.find((tier) => reviewCount >= tier.min)?.points ?? 0;
}

/** Quantidade de campos do perfil Google efetivamente preenchidos. */
function googleProfileFilledFields(input: ScoreInput): number {
  const fields = [
    input.address,
    input.category,
    input.opening_hours?.length ? 'ok' : null,
    input.description,
    input.google_maps_url,
    input.rating !== null ? 'ok' : null,
  ];
  return fields.filter((f) => f !== null && f !== undefined && f !== '').length;
}

/** O Google nao marcou o estabelecimento como fechado. */
function isOperational(businessStatus: string | null): boolean {
  const status = businessStatus?.toUpperCase() ?? null;
  return status === null || status === 'OPERATIONAL';
}

/**
 * O Instagram so soma o bonus extra quando ha confirmacao humana ou confianca
 * muito alta — perfil de baixa confianca nunca vale pontos extras (SPEC 1.1 §29).
 */
function instagramCountsAsSolid(input: ScoreInput): boolean {
  if (input.instagram_status === 'CONFIRMED') return true;
  return (input.instagram_confidence ?? 0) >= INSTAGRAM_VERY_HIGH_CONFIDENCE_THRESHOLD;
}

/** Instagram rejeitado pelo usuario deixa de contar como sinal. */
function hasUsableInstagram(input: ScoreInput): boolean {
  return Boolean(input.instagram_url) && input.instagram_status !== 'REJECTED';
}

export function classifyScore(score: number): OpportunityLevel {
  return OPPORTUNITY_LEVEL_RANGES.find((range) => score >= range.min)?.level ?? 'BAIXA';
}

export function computeOpportunityScore(
  input: ScoreInput,
  capabilities: SourceCapabilities = FULL_CAPABILITIES,
): ScoreResult {
  const breakdown: ScoreBreakdownItem[] = [];
  const evaluable = (code: ScoreSignalCode) => isSignalEvaluable(code, capabilities);

  const add = (code: string, label: string, points: number) => {
    if (points > 0) breakdown.push({ code, label, points });
  };

  // "UNKNOWN" nao pontua: nao se sabe se ha site (SPEC 1.1 §17).
  if (evaluable('NO_WEBSITE') && input.website_status === 'NO_WEBSITE_DETECTED') {
    add('NO_WEBSITE', 'Site nao identificado', SCORE_WEIGHTS.NO_WEBSITE);
  }

  if (evaluable('GOOGLE_PROFILE_COMPLETE') && googleProfileFilledFields(input) >= GOOGLE_PROFILE_MIN_FIELDS) {
    add(
      'GOOGLE_PROFILE_COMPLETE',
      'Google Business bem configurado',
      SCORE_WEIGHTS.GOOGLE_PROFILE_COMPLETE,
    );
  }

  if (evaluable('HIGH_RATING') && input.rating !== null && input.rating >= HIGH_RATING_THRESHOLD) {
    add('HIGH_RATING', `Avaliacao ${input.rating.toFixed(1)}`, SCORE_WEIGHTS.HIGH_RATING);
  }

  const reviewCount = input.review_count ?? 0;
  if (evaluable('REVIEW_COUNT')) {
    add('REVIEW_COUNT', `${reviewCount} avaliacoes`, reviewCountPoints(reviewCount));
  }

  if (hasUsableInstagram(input)) {
    add('INSTAGRAM_FOUND', 'Instagram encontrado', SCORE_WEIGHTS.INSTAGRAM_FOUND);

    if (instagramCountsAsSolid(input)) {
      add(
        'INSTAGRAM_HIGH_CONFIDENCE',
        input.instagram_status === 'CONFIRMED'
          ? 'Instagram confirmado'
          : 'Instagram com confianca muito alta',
        SCORE_WEIGHTS.INSTAGRAM_HIGH_CONFIDENCE,
      );
    }
  }

  if (evaluable('PHONE_AVAILABLE') && input.phone) {
    add('PHONE_AVAILABLE', 'Telefone disponivel', SCORE_WEIGHTS.PHONE_AVAILABLE);
  }

  if (evaluable('BUSINESS_ACTIVE') && isOperational(input.business_status) && reviewCount > 0) {
    add('BUSINESS_ACTIVE', 'Empresa ativa', SCORE_WEIGHTS.BUSINESS_ACTIVE);
  }

  const rawScore = breakdown.reduce((total, item) => total + item.points, 0);
  const score = Math.min(rawScore, MAX_SCORE);
  const coverage = computeSourceCoverage(capabilities);

  return { score, level: capLevelByCoverage(classifyScore(score), coverage.level), breakdown, coverage };
}

/**
 * Qualidade do perfil no Google (SPEC 1.1 §30/§31).
 * Considera completude do cadastro e volume de avaliacoes — nunca apenas o rating.
 */
export function computeGoogleBusinessQuality(input: ScoreInput): GoogleBusinessQuality {
  if (!isOperational(input.business_status)) return 'LOW';

  const fields = googleProfileFilledFields(input);
  const reviews = input.review_count ?? 0;

  if (fields >= GOOGLE_QUALITY.HIGH_MIN_FIELDS && reviews >= GOOGLE_QUALITY.HIGH_MIN_REVIEWS) {
    return 'HIGH';
  }
  if (fields >= GOOGLE_QUALITY.MEDIUM_MIN_FIELDS && reviews >= GOOGLE_QUALITY.MEDIUM_MIN_REVIEWS) {
    return 'MEDIUM';
  }
  return 'LOW';
}

export type NextActionResult = { action: NextAction; reason: string };

/**
 * Acao recomendada (SPEC 1.1 §33/§77). Determinística: derivada do score,
 * da qualidade do perfil, do contato disponivel e do estado do lead.
 */
export function computeNextAction(input: {
  score: number;
  quality: GoogleBusinessQuality;
  hasPhone: boolean;
  websiteStatus: WebsiteStatus;
  businessStatus: string | null;
  leadStatus?: LeadStatus | null;
}): NextActionResult {
  if (!isOperational(input.businessStatus)) {
    return {
      action: 'DO_NOT_CONTACT',
      reason: 'O Google indica que o estabelecimento nao esta em operacao.',
    };
  }

  if (input.leadStatus) {
    if (input.leadStatus === 'SEM_INTERESSE' || input.leadStatus === 'DESCARTADO') {
      return { action: 'DO_NOT_CONTACT', reason: 'Lead marcado como sem interesse ou descartado.' };
    }
    if (input.leadStatus !== 'NOVO' && input.leadStatus !== 'QUALIFICADO') {
      return { action: 'ALREADY_CONTACTED', reason: `Lead ja esta em "${input.leadStatus}".` };
    }
  }

  if (!input.hasPhone) {
    return {
      action: 'RESEARCH_MORE',
      reason: 'Nao ha telefone disponivel: e preciso localizar um canal de contato antes.',
    };
  }

  if (input.websiteStatus === 'UNKNOWN') {
    return {
      action: 'RESEARCH_MORE',
      reason: 'Nao foi possivel verificar se a empresa tem site. Confirme antes de abordar.',
    };
  }

  if (input.score >= NEXT_ACTION_RULES.CONTACT_NOW_MIN_SCORE && input.quality !== 'LOW') {
    return {
      action: 'CONTACT_NOW',
      reason:
        'Boa reputacao, volume relevante de avaliacoes, perfil ativo e telefone disponivel — com site nao identificado ou presenca digital incompleta.',
    };
  }

  if (input.score < NEXT_ACTION_RULES.LOW_PRIORITY_MAX_SCORE) {
    return {
      action: 'LOW_PRIORITY',
      reason: 'Poucos sinais de oportunidade em relacao as demais empresas da base.',
    };
  }

  return {
    action: 'RESEARCH_MORE',
    reason: 'Sinais intermediarios: vale checar presenca digital antes de investir tempo.',
  };
}

/** Justificativa textual do score (SPEC 16), pronta para exibir ou copiar. */
export function formatScoreBreakdown(score: number, breakdown: ScoreBreakdownItem[]): string {
  const lines = breakdown.map((item) => `+${item.points}  ${item.label}`);
  return [`Score: ${score}/${MAX_SCORE}`, '', ...lines].join('\n');
}
