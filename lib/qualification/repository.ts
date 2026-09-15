import {
  GAP_TYPES,
  OFFER_TYPES,
  OPPORTUNITY_LEVELS_V2,
  RECOMMENDED_ACTIONS,
  type QualificationResult,
  type QualificationResultV2,
} from '@/types/spec2';

const V1_LEVELS = ['BAIXA', 'MEDIA', 'ALTA', 'EXCELENTE'] as const;
const V1_ACTIONS = ['CONTACT_NOW', 'RESEARCH_MORE', 'LOW_PRIORITY', 'ALREADY_CONTACTED', 'DO_NOT_CONTACT'] as const;

/** Hydrates the persisted snake_case contract and rejects corrupt/unknown versions. */
export function hydrateQualificationResult(row: Record<string, unknown>): QualificationResult {
  const version = row.score_version;
  if (version !== 1 && version !== 2) throw new Error(`Unsupported score_version: ${String(version)}`);
  const level = String(row.opportunity_level);
  const action = String(row.recommended_action);
  if (version === 1) {
    if (!V1_LEVELS.includes(level as (typeof V1_LEVELS)[number]) || !V1_ACTIONS.includes(action as (typeof V1_ACTIONS)[number])) {
      throw new Error('Invalid v1 qualification vocabulary');
    }
    return { ...row, score_version: 1, opportunity_level: level, recommended_action: action } as QualificationResult;
  }
  if (!OPPORTUNITY_LEVELS_V2.includes(level as never) || !RECOMMENDED_ACTIONS.includes(action as never)) {
    throw new Error('Invalid v2 qualification vocabulary');
  }
  if (row.primary_gap != null && !GAP_TYPES.includes(row.primary_gap as never)) throw new Error('Invalid v2 gap');
  if (row.recommended_offer != null && !OFFER_TYPES.includes(row.recommended_offer as never)) throw new Error('Invalid v2 offer');
  return { ...row, score_version: 2, opportunity_level: level, recommended_action: action } as QualificationResult;
}

export function requireV2(result: QualificationResult): QualificationResultV2 {
  if (result.score_version !== 2) throw new Error('Explicit conversion required for score v1');
  return result;
}
