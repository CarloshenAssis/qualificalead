import type { OpportunityLevel } from '@/types/database';

/**
 * Pesos e faixas do score de oportunidade (SPEC 14/15).
 * Fonte unica: nenhum numero magico de score deve existir fora deste arquivo.
 */

export const SCORE_WEIGHTS = {
  NO_WEBSITE: 30,
  /**
   * Oportunidade de presenca digital (correcao pontual, ver score.ts): substitui
   * "Google Business bem configurado" — um perfil rico no Google nao e o que este
   * produto vende. O que vale e o oposto: empresa identificavel, abordavel, com uma
   * lacuna real de presenca digital (sem site E sem Instagram identificados).
   */
  DIGITAL_PRESENCE_GAP: 30,
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

/** Confianca minima do Instagram para contar como "alta confianca" nos filtros (SPEC 10). */
export const INSTAGRAM_HIGH_CONFIDENCE_THRESHOLD = 70;

/**
 * Confianca minima para o bonus extra de score (SPEC 1.1 §29).
 * Abaixo disso o bonus so vale se o usuario tiver confirmado o perfil.
 */
export const INSTAGRAM_VERY_HIGH_CONFIDENCE_THRESHOLD = 90;

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

/** Faixas de confianca do Instagram (SPEC 10 / SPEC 1.1 §22). */
export const INSTAGRAM_CONFIDENCE_RANGES: ReadonlyArray<{
  min: number;
  tier: 'VERY_HIGH' | 'HIGH' | 'POSSIBLE' | 'LOW';
  label: string;
}> = [
  { min: 90, tier: 'VERY_HIGH', label: 'Muito alta' },
  { min: 70, tier: 'HIGH', label: 'Alta' },
  { min: 40, tier: 'POSSIBLE', label: 'Possivel' },
  { min: 0, tier: 'LOW', label: 'Baixa' },
];

export function instagramConfidenceTier(confidence: number) {
  return INSTAGRAM_CONFIDENCE_RANGES.find((r) => confidence >= r.min)?.tier ?? 'LOW';
}

export function instagramConfidenceLabel(confidence: number): string {
  return INSTAGRAM_CONFIDENCE_RANGES.find((r) => confidence >= r.min)?.label ?? 'Baixa';
}

/**
 * Qualidade do perfil no Google (SPEC 1.1 §30/§31).
 * Rating alto com pouquissimas avaliacoes nao vale o mesmo que rating alto com volume.
 */
export const GOOGLE_QUALITY = {
  /** Campos do perfil que contam como preenchidos. */
  HIGH_MIN_FIELDS: 5,
  MEDIUM_MIN_FIELDS: 3,
  /** Volume de avaliacoes que sustenta a nota. */
  HIGH_MIN_REVIEWS: 25,
  MEDIUM_MIN_REVIEWS: 5,
} as const;

/** Regras da acao recomendada (SPEC 1.1 §33). */
export const NEXT_ACTION_RULES = {
  /** Score minimo para recomendar contato imediato. */
  CONTACT_NOW_MIN_SCORE: 70,
  /** Abaixo disso a empresa entra como baixa prioridade. */
  LOW_PRIORITY_MAX_SCORE: 40,
} as const;
