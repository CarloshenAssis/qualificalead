import type { OpportunityLevelV2 } from '@/types/spec2';

/**
 * Pesos e faixas do score multidimensional (SPEC 2.0 §14).
 * Fonte unica: nenhum numero magico de qualificacao deve existir fora deste arquivo.
 *
 * O score da 1.x continua valendo como historico com `score_version = 1`
 * (SPEC 2.0 §36.2). Tudo aqui e a versao 2.
 */

export const SCORE_VERSION_V2 = 2;

/** SPEC 2.0 §14.2. Soma exatamente 1. */
export const SUBSCORE_WEIGHTS = {
  need: 0.35,
  commercialFit: 0.25,
  capacity: 0.2,
  contactability: 0.15,
  timing: 0.05,
} as const;

export type SubscoreKey = keyof typeof SUBSCORE_WEIGHTS;

export const MAX_SUBSCORE = 100;

/** SPEC 2.0 §14.3. */
export const OPPORTUNITY_LEVEL_RANGES_V2: ReadonlyArray<{
  level: OpportunityLevelV2;
  min: number;
  label: string;
}> = [
  { level: 'EXCELLENT', min: 85, label: 'OPORTUNIDADE EXCELENTE' },
  { level: 'HIGH', min: 70, label: 'OPORTUNIDADE ALTA' },
  { level: 'MEDIUM', min: 50, label: 'OPORTUNIDADE MEDIA' },
  { level: 'LOW', min: 0, label: 'OPORTUNIDADE BAIXA' },
];

/**
 * Abaixo disso o lead nao pode passar de MEDIUM, por melhor que o score pareca
 * (SPEC 2.0 §14.4). Confianca baixa significa que o score esta opinando sobre
 * dados que mal existem.
 */
export const MIN_DATA_CONFIDENCE_FOR_HIGH = 50;

/**
 * Nenhum gap isolado pode responder por mais que esta fracao do score final
 * (SPEC 2.0 §14.4). Impede que um unico sinal — tipicamente "sem site" — carregue
 * sozinho um lead sobre o qual nada mais se sabe.
 */
export const MAX_SINGLE_GAP_SHARE = 0.4;

/** Score minimo para o lead sequer ser oferecido a revisao de e-mail. */
export const MIN_SCORE_FOR_EMAIL_REVIEW = 50;

/** Score a partir do qual o lead e considerado pronto para e-mail sem pesquisa extra. */
export const MIN_SCORE_FOR_READY = 70;

export function levelLabelV2(level: OpportunityLevelV2): string {
  return (
    OPPORTUNITY_LEVEL_RANGES_V2.find((range) => range.level === level)?.label ?? 'OPORTUNIDADE BAIXA'
  );
}
