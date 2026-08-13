import type { OpportunityLevel } from '@/types/database';

/**
 * Pesos e faixas do score de oportunidade (SPEC 14/15).
 * Fonte unica: nenhum numero magico de score deve existir fora deste arquivo.
 */

export const SCORE_WEIGHTS = {
  NO_WEBSITE: 30,
  GOOGLE_PROFILE_COMPLETE: 15,
  HIGH_RATING: 15,
  INSTAGRAM_FOUND: 10,
  INSTAGRAM_HIGH_CONFIDENCE: 5,
  PHONE_AVAILABLE: 5,
  BUSINESS_ACTIVE: 5,
} as const;

/** Escalonamento por quantidade de avaliacoes (SPEC 14). */
export const REVIEW_COUNT_TIERS: ReadonlyArray<{ min: number; points: number }> = [
  { min: 200, points: 15 },
  { min: 100, points: 12 },
  { min: 50, points: 10 },
  { min: 25, points: 7 },
  { min: 5, points: 3 },
  { min: 0, points: 0 },
];

export const MAX_SCORE = 100;

/** Nota minima para pontuar em "Rating alto". */
export const HIGH_RATING_THRESHOLD = 4.5;

/** Confianca minima do Instagram para o bonus de alta confianca (SPEC 10). */
export const INSTAGRAM_HIGH_CONFIDENCE_THRESHOLD = 70;

/** Quantos campos do Google precisam existir para o perfil contar como completo. */
export const GOOGLE_PROFILE_MIN_FIELDS = 4;

/** Faixas de classificacao (SPEC 15). */
export const OPPORTUNITY_LEVEL_RANGES: ReadonlyArray<{
  level: OpportunityLevel;
  min: number;
  label: string;
}> = [
  { level: 'EXCELENTE', min: 85, label: 'EXCELENTE OPORTUNIDADE' },
  { level: 'ALTA', min: 70, label: 'ALTA OPORTUNIDADE' },
  { level: 'MEDIA', min: 40, label: 'MEDIA OPORTUNIDADE' },
  { level: 'BAIXA', min: 0, label: 'BAIXA OPORTUNIDADE' },
];

export function levelLabel(level: OpportunityLevel): string {
  return OPPORTUNITY_LEVEL_RANGES.find((r) => r.level === level)?.label ?? 'BAIXA OPORTUNIDADE';
}

/** Faixas de confianca do Instagram (SPEC 10). */
export const INSTAGRAM_CONFIDENCE_RANGES: ReadonlyArray<{ min: number; label: string }> = [
  { min: 90, label: 'Muito alta' },
  { min: 70, label: 'Alta' },
  { min: 40, label: 'Possivel' },
  { min: 0, label: 'Baixa' },
];

export function instagramConfidenceLabel(confidence: number): string {
  return INSTAGRAM_CONFIDENCE_RANGES.find((r) => confidence >= r.min)?.label ?? 'Baixa';
}
