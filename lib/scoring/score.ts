import type { OpportunityLevel, ScoreBreakdownItem, WebsiteStatus } from '@/types/database';
import {
  GOOGLE_PROFILE_MIN_FIELDS,
  HIGH_RATING_THRESHOLD,
  INSTAGRAM_HIGH_CONFIDENCE_THRESHOLD,
  MAX_SCORE,
  OPPORTUNITY_LEVEL_RANGES,
  REVIEW_COUNT_TIERS,
  SCORE_WEIGHTS,
} from './config';

/**
 * Motor de score deterministico (SPEC 14/16/35).
 * Nao depende de IA e nao estima probabilidade de compra: apenas soma sinais observaveis.
 */

export type ScoreInput = {
  website_status: WebsiteStatus;
  rating: number | null;
  review_count: number | null;
  phone: string | null;
  instagram_url: string | null;
  instagram_confidence: number | null;
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

export function classifyScore(score: number): OpportunityLevel {
  return OPPORTUNITY_LEVEL_RANGES.find((range) => score >= range.min)?.level ?? 'BAIXA';
}

export function computeOpportunityScore(input: ScoreInput): ScoreResult {
  const breakdown: ScoreBreakdownItem[] = [];

  const add = (code: string, label: string, points: number) => {
    if (points > 0) breakdown.push({ code, label, points });
  };

  if (input.website_status === 'NO_WEBSITE_DETECTED') {
    add('NO_WEBSITE', 'Site nao identificado', SCORE_WEIGHTS.NO_WEBSITE);
  }

  if (googleProfileFilledFields(input) >= GOOGLE_PROFILE_MIN_FIELDS) {
    add(
      'GOOGLE_PROFILE_COMPLETE',
      'Google Business bem configurado',
      SCORE_WEIGHTS.GOOGLE_PROFILE_COMPLETE,
    );
  }

  if (input.rating !== null && input.rating >= HIGH_RATING_THRESHOLD) {
    add('HIGH_RATING', `Avaliacao ${input.rating.toFixed(1)}`, SCORE_WEIGHTS.HIGH_RATING);
  }

  const reviewCount = input.review_count ?? 0;
  const reviewPoints = reviewCountPoints(reviewCount);
  add('REVIEW_COUNT', `${reviewCount} avaliacoes`, reviewPoints);

  if (input.instagram_url) {
    add('INSTAGRAM_FOUND', 'Instagram encontrado', SCORE_WEIGHTS.INSTAGRAM_FOUND);

    if ((input.instagram_confidence ?? 0) >= INSTAGRAM_HIGH_CONFIDENCE_THRESHOLD) {
      add(
        'INSTAGRAM_HIGH_CONFIDENCE',
        'Instagram com alta confianca',
        SCORE_WEIGHTS.INSTAGRAM_HIGH_CONFIDENCE,
      );
    }
  }

  if (input.phone) {
    add('PHONE_AVAILABLE', 'Telefone disponivel', SCORE_WEIGHTS.PHONE_AVAILABLE);
  }

  // "Ativa" = o Google nao marcou o estabelecimento como fechado.
  const status = input.business_status?.toUpperCase() ?? null;
  const isActive = status === null || status === 'OPERATIONAL';
  if (isActive && reviewCount > 0) {
    add('BUSINESS_ACTIVE', 'Empresa ativa', SCORE_WEIGHTS.BUSINESS_ACTIVE);
  }

  const rawScore = breakdown.reduce((total, item) => total + item.points, 0);
  const score = Math.min(rawScore, MAX_SCORE);

  return { score, level: classifyScore(score), breakdown };
}

/** Justificativa textual do score (SPEC 16), pronta para exibir ou copiar. */
export function formatScoreBreakdown(score: number, breakdown: ScoreBreakdownItem[]): string {
  const lines = breakdown.map((item) => `+${item.points}  ${item.label}`);
  return [`Score: ${score}/${MAX_SCORE}`, '', ...lines].join('\n');
}
