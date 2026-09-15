import type {
  EmailVerificationStatus,
  GapStatus,
  GapType,
  ObservationType,
  OfferType,
  OpportunityLevelV2,
  QualificationReason,
  RecommendedAction,
} from '@/types/spec2';
import { recommendOffer } from '@/lib/offers/catalog';
import {
  MAX_SINGLE_GAP_SHARE,
  MIN_DATA_CONFIDENCE_FOR_HIGH,
  MIN_SCORE_FOR_EMAIL_REVIEW,
  MIN_SCORE_FOR_READY,
  OPPORTUNITY_LEVEL_RANGES_V2,
  SCORE_VERSION_V2,
  SUBSCORE_WEIGHTS,
} from './config';
import {
  computeCapacityScore,
  computeCommercialFitScore,
  computeContactabilityScore,
  computeDataConfidence,
  computeNeedScore,
  computeTimingScore,
  type CapacitySignals,
  type ContactSignal,
  type DataConfidenceInput,
  type ScoredGap,
  type TimingTrigger,
} from './subscores';

/**
 * Qualificacao multidimensional versionada (SPEC 2.0 §14).
 *
 * O que este modulo entrega nao e uma previsao de compra e nunca deve ser lido
 * como tal (§14.4, ultima linha): e uma ordenacao de oportunidade a partir de
 * sinais observados, com a confianca nesses sinais reportada em separado.
 *
 * Toda saida carrega `score_version`. Mexer nos pesos exige subir a versao, para
 * que um lead pontuado ontem continue explicavel amanha (§14.6).
 */

export type QualificationInput = {
  gaps: ScoredGap[];
  contacts: ContactSignal[];
  capacity: CapacitySignals;
  timing: TimingTrigger[];
  dataConfidence: DataConfidenceInput;
  segment?: string | null;
  /** Gaps e ofertas que a campanha procura. `null`/ausente = sem restricao. */
  targetGapTypes?: GapType[] | null;
  targetOfferTypes?: OfferType[] | null;
  /** Observacoes disponiveis — filtram quais ofertas podem ser recomendadas. */
  availableObservations?: ObservationType[];
  /** Empresa marcada como fechada na fonte (SPEC 2.0 §14.4). */
  businessClosed?: boolean;
  /** Contato/empresa na lista de supressao (SPEC 2.0 §14.4/§29.2). */
  isSuppressed?: boolean;
  /** Decisao humana explicita de nao contatar. */
  doNotContact?: boolean;
  evidenceIds?: string[];
};

export type QualificationOutput = {
  score_version: number;
  opportunity_score: number;
  opportunity_level: OpportunityLevelV2;
  need_score: number;
  commercial_fit_score: number;
  capacity_score: number;
  contactability_score: number;
  timing_score: number;
  data_confidence: number;
  primary_gap: GapType | null;
  recommended_offer: OfferType | null;
  recommended_action: RecommendedAction;
  reasons: QualificationReason[];
  evidence_ids: string[];
};

/** Estados de e-mail que jamais podem ser agendados (SPEC 2.0 §10.3/§17.3). */
const UNSENDABLE_EMAIL_STATUSES: ReadonlySet<EmailVerificationStatus> = new Set<
  EmailVerificationStatus
>(['INVALID', 'BOUNCED', 'SUPPRESSED', 'DISPOSABLE']);

/** Estados que o sistema aceita agendar — `VALID` e o unico plenamente seguro. */
const SENDABLE_EMAIL_STATUSES: ReadonlySet<EmailVerificationStatus> = new Set<
  EmailVerificationStatus
>(['VALID', 'ROLE_BASED', 'ACCEPT_ALL']);

function hasSendableEmail(contacts: ContactSignal[]): boolean {
  return contacts.some(
    (contact) =>
      SENDABLE_EMAIL_STATUSES.has(contact.email_verification_status) &&
      !UNSENDABLE_EMAIL_STATUSES.has(contact.email_verification_status),
  );
}

export function classifyLevel(score: number): OpportunityLevelV2 {
  return (
    OPPORTUNITY_LEVEL_RANGES_V2.find((range) => score >= range.min)?.level ?? 'LOW'
  );
}

const LEVEL_ORDER: OpportunityLevelV2[] = ['LOW', 'MEDIUM', 'HIGH', 'EXCELLENT'];

/** Rebaixa o nivel ate o teto, nunca promove. */
function capLevel(level: OpportunityLevelV2, ceiling: OpportunityLevelV2): OpportunityLevelV2 {
  return LEVEL_ORDER.indexOf(level) > LEVEL_ORDER.indexOf(ceiling) ? ceiling : level;
}

function weightedScore(parts: {
  need: number;
  commercialFit: number;
  capacity: number;
  contactability: number;
  timing: number;
}): number {
  return (
    parts.need * SUBSCORE_WEIGHTS.need +
    parts.commercialFit * SUBSCORE_WEIGHTS.commercialFit +
    parts.capacity * SUBSCORE_WEIGHTS.capacity +
    parts.contactability * SUBSCORE_WEIGHTS.contactability +
    parts.timing * SUBSCORE_WEIGHTS.timing
  );
}

export function qualifyCompany(input: QualificationInput): QualificationOutput {
  const reasons: QualificationReason[] = [];

  const need = computeNeedScore(input.gaps);

  const offerRecommendation = recommendOffer(need.primaryGap, input.availableObservations ?? []);
  const recommendedOffer = offerRecommendation.offer;

  const commercialFit = computeCommercialFitScore({
    primaryGap: need.primaryGap,
    recommendedOffer,
    segment: input.segment ?? null,
    targetGapTypes: input.targetGapTypes ?? null,
    targetOfferTypes: input.targetOfferTypes ?? null,
  });

  const capacity = computeCapacityScore(input.capacity);
  const contactability = computeContactabilityScore(input.contacts);
  const timing = computeTimingScore(input.timing);
  const dataConfidence = computeDataConfidence(input.dataConfidence);

  let needScore = need.score;
  let rawScore = weightedScore({
    need: needScore,
    commercialFit,
    capacity,
    contactability,
    timing,
  });

  /**
   * Teto de participacao de um unico gap (SPEC 2.0 §14.4).
   *
   * `g` e quanto o gap dominante contribui para o score final. Se `g` passa de 40%
   * do final, reduzimos para o maior `g'` que satisfaz `g' = 0.4 * (S - g + g')`,
   * ou seja `g' = (2/3) * (S - g)`. Reduzir o gap tambem reduz o total, entao a
   * forma fechada e necessaria: cortar direto para "40% do score antigo" deixaria
   * o gap acima de 40% do score novo.
   */
  if (need.rawTotal > 0 && need.contributions.length > 0) {
    const dominant = need.contributions[0];
    const dominantShareOfNeed = (dominant.rawPoints / need.rawTotal) * needScore;
    const dominantFinalContribution = dominantShareOfNeed * SUBSCORE_WEIGHTS.need;

    if (dominantFinalContribution > MAX_SINGLE_GAP_SHARE * rawScore) {
      const allowed = (2 / 3) * (rawScore - dominantFinalContribution);
      const removedFinalPoints = dominantFinalContribution - allowed;
      needScore = Math.max(0, needScore - removedFinalPoints / SUBSCORE_WEIGHTS.need);
      rawScore = weightedScore({
        need: needScore,
        commercialFit,
        capacity,
        contactability,
        timing,
      });

      reasons.push({
        code: 'SINGLE_GAP_SHARE_CAPPED',
        label: `O gap ${dominant.gap_type} foi limitado a ${Math.round(
          MAX_SINGLE_GAP_SHARE * 100,
        )}% do score final.`,
      });
    }
  }

  const opportunityScore = Math.max(0, Math.min(100, Math.round(rawScore)));
  const roundedNeed = Math.round(needScore);

  let level = classifyLevel(opportunityScore);

  // Guardrail: pouca confianca nos dados nunca sustenta nivel alto (SPEC 2.0 §14.4).
  if (dataConfidence < MIN_DATA_CONFIDENCE_FOR_HIGH) {
    const capped = capLevel(level, 'MEDIUM');
    if (capped !== level) {
      reasons.push({
        code: 'LOW_DATA_CONFIDENCE_CAP',
        label: `Confianca de dados ${dataConfidence} (< ${MIN_DATA_CONFIDENCE_FOR_HIGH}) limita o nivel a MEDIUM.`,
      });
    }
    level = capped;
  }

  if (need.primaryGap) {
    reasons.push({
      code: 'PRIMARY_GAP',
      label: `Gap primario: ${need.primaryGap}.`,
      points: Math.round(
        ((need.contributions[0].rawPoints / need.rawTotal) * roundedNeed) * SUBSCORE_WEIGHTS.need,
      ),
    });
  } else {
    reasons.push({ code: 'NO_GAP', label: 'Nenhum gap estabelecido para esta empresa.' });
  }

  if (!recommendedOffer) {
    reasons.push({ code: 'NO_OFFER', label: offerRecommendation.reason });
  }

  const recommendedAction = decideAction({
    score: opportunityScore,
    dataConfidence,
    gaps: input.gaps,
    primaryGap: need.primaryGap,
    contacts: input.contacts,
    businessClosed: Boolean(input.businessClosed),
    isSuppressed: Boolean(input.isSuppressed),
    doNotContact: Boolean(input.doNotContact),
    reasons,
  });

  return {
    score_version: SCORE_VERSION_V2,
    opportunity_score: opportunityScore,
    opportunity_level: level,
    need_score: roundedNeed,
    commercial_fit_score: commercialFit,
    capacity_score: capacity,
    contactability_score: contactability,
    timing_score: timing,
    data_confidence: dataConfidence,
    primary_gap: need.primaryGap,
    recommended_offer: recommendedOffer,
    recommended_action: recommendedAction,
    reasons,
    evidence_ids: input.evidenceIds ?? [],
  };
}

type ActionInput = {
  score: number;
  dataConfidence: number;
  gaps: ScoredGap[];
  primaryGap: GapType | null;
  contacts: ContactSignal[];
  businessClosed: boolean;
  isSuppressed: boolean;
  doNotContact: boolean;
  reasons: QualificationReason[];
};

/**
 * Traduz o score numa acao (SPEC 2.0 §14.4/§14.5). A ordem das checagens e a
 * propria regra de negocio: as barreiras absolutas vem antes de qualquer nota.
 *
 * `READY_FOR_EMAIL` exige gap **confirmado por humano**, nao apenas detectado.
 * Isso mantem a promessa do §3.5 (o humano controla as acoes de maior risco) sem
 * empurrar para a fila de revisao leads que ja passaram por ela.
 */
function decideAction(input: ActionInput): RecommendedAction {
  if (input.doNotContact) {
    input.reasons.push({ code: 'DO_NOT_CONTACT_MANUAL', label: 'Marcado como nao contatar.' });
    return 'DO_NOT_CONTACT';
  }

  if (input.isSuppressed) {
    input.reasons.push({ code: 'SUPPRESSED', label: 'Lead esta na lista de supressao.' });
    return 'DO_NOT_CONTACT';
  }

  if (input.businessClosed) {
    input.reasons.push({ code: 'BUSINESS_CLOSED', label: 'Empresa marcada como fechada.' });
    return 'DO_NOT_CONTACT';
  }

  // Sem e-mail agendavel, nenhuma acao de e-mail e possivel (SPEC 2.0 §14.4).
  if (!hasSendableEmail(input.contacts)) {
    input.reasons.push({
      code: 'NO_SENDABLE_EMAIL',
      label: 'Nenhum contato com e-mail agendavel.',
    });
    return input.score >= MIN_SCORE_FOR_EMAIL_REVIEW ? 'RESEARCH_MORE' : 'LOW_PRIORITY';
  }

  const primaryGapConfirmed = input.gaps.some(
    (gap) => gap.gap_type === input.primaryGap && gap.status === ('CONFIRMED' satisfies GapStatus),
  );

  if (
    input.score >= MIN_SCORE_FOR_READY &&
    input.dataConfidence >= MIN_DATA_CONFIDENCE_FOR_HIGH &&
    primaryGapConfirmed
  ) {
    return 'READY_FOR_EMAIL';
  }

  if (input.score >= MIN_SCORE_FOR_EMAIL_REVIEW) return 'REVIEW_FOR_EMAIL';

  return input.dataConfidence < MIN_DATA_CONFIDENCE_FOR_HIGH ? 'RESEARCH_MORE' : 'LOW_PRIORITY';
}
