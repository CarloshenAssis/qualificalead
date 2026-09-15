import type { EmailVerificationStatus, GapStatus, GapType, OfferType } from '@/types/spec2';
import { GAP_CATALOG } from '@/lib/gaps/catalog';
import { OFFER_CATALOG } from '@/lib/offers/catalog';
import { isEmailStatusSendable } from '@/lib/email/sendability';
import { MAX_SUBSCORE } from './config';

/**
 * Os seis subscores da SPEC 2.0 §14.1.
 *
 * Cada um vive numa funcao propria e pura para poder ser testado — e contestado —
 * isoladamente. Duas regras valem para todos:
 *
 * 1. Sinal que a fonte nao consegue observar nao entra na conta, nem a favor nem
 *    contra (herdado da 1.2 §34/§35). Um `null` e "nao olhei", nunca "nao tem".
 * 2. Nenhum subscore afirma faturamento, porte real ou intencao de compra. Eles
 *    medem sinais publicos, e so (SPEC 2.0 §15.2).
 */

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(MAX_SUBSCORE, Math.round(value)));
}

/**
 * Normaliza pontos ganhos pelo total que era **possivel** ganhar com os sinais
 * observaveis. Sem sinal algum observavel o resultado e 0 — nunca uma divisao por
 * zero disfarcada de nota alta.
 */
function normalize(earned: number, available: number): number {
  if (available <= 0) return 0;
  return clamp((earned / available) * MAX_SUBSCORE);
}

// --- Need Score -------------------------------------------------------------

export type ScoredGap = {
  gap_type: GapType;
  /** 1 a 5. */
  severity: number;
  /** 0 a 1. */
  confidence: number;
  status: GapStatus;
};

export type GapContribution = {
  gap_type: GapType;
  /** Pontos brutos antes de qualquer normalizacao ou teto. */
  rawPoints: number;
};

export type NeedScoreResult = {
  score: number;
  contributions: GapContribution[];
  /** Gap com a maior contribuicao bruta. `null` quando nao ha gap computavel. */
  primaryGap: GapType | null;
  /** Soma bruta antes do teto de 100 — necessaria para ratear o teto por gap. */
  rawTotal: number;
};

/**
 * So gap estabelecido entra: `DETECTED` (observado por auditoria) e `CONFIRMED`
 * (confirmado por humano). `NEEDS_REVIEW` fica de fora de proposito — e onde todo
 * gap interno nasce (§12.2), e uma suspeita nao confirmada nao pode empurrar um
 * lead para o topo da fila. `REJECTED`, `RESOLVED` e `EXPIRED` tambem nao contam.
 */
const COUNTABLE_GAP_STATUSES: ReadonlySet<GapStatus> = new Set<GapStatus>([
  'DETECTED',
  'CONFIRMED',
]);

export function computeNeedScore(gaps: ScoredGap[]): NeedScoreResult {
  const contributions: GapContribution[] = [];

  for (const gap of gaps) {
    if (!COUNTABLE_GAP_STATUSES.has(gap.status)) continue;

    const definition = GAP_CATALOG[gap.gap_type];
    if (!definition) continue;

    const severity = Math.max(1, Math.min(5, gap.severity));
    const confidence = Math.max(0, Math.min(1, gap.confidence));
    const rawPoints = definition.needPoints * (severity / 5) * confidence;

    if (rawPoints > 0) contributions.push({ gap_type: gap.gap_type, rawPoints });
  }

  contributions.sort((a, b) => b.rawPoints - a.rawPoints);

  const rawTotal = contributions.reduce((sum, item) => sum + item.rawPoints, 0);

  return {
    score: clamp(rawTotal),
    contributions,
    primaryGap: contributions[0]?.gap_type ?? null,
    rawTotal,
  };
}

// --- Commercial Fit Score ---------------------------------------------------

export type CommercialFitInput = {
  primaryGap: GapType | null;
  recommendedOffer: OfferType | null;
  segment: string | null;
  /** Gaps que a campanha procura. `null` = campanha nao restringe. */
  targetGapTypes: GapType[] | null;
  /** Ofertas que a campanha quer vender. `null` = campanha nao restringe. */
  targetOfferTypes: OfferType[] | null;
};

const FIT_POINTS = {
  offerExists: 55,
  segmentCompatible: 20,
  segmentExplicit: 5,
  gapTargeted: 10,
  offerTargeted: 10,
} as const;

/**
 * Mede o encaixe entre o problema da empresa e o que o usuario de fato vende.
 * Sem oferta recomendada o encaixe e zero: nao ha o que propor, por mais grave
 * que o gap seja.
 */
export function computeCommercialFitScore(input: CommercialFitInput): number {
  if (!input.primaryGap || !input.recommendedOffer) return 0;

  let points: number = FIT_POINTS.offerExists;

  const offer = OFFER_CATALOG[input.recommendedOffer];
  const segments = offer?.compatibleSegments ?? [];
  const segment = input.segment?.trim().toLowerCase() ?? '';

  if (!segments.length) {
    // Oferta generica: serve ao segmento, mas sem a confirmacao de um match explicito.
    points += FIT_POINTS.segmentCompatible;
  } else if (segment && segments.some((item) => item.trim().toLowerCase() === segment)) {
    points += FIT_POINTS.segmentCompatible + FIT_POINTS.segmentExplicit;
  }

  if (input.targetGapTypes?.includes(input.primaryGap)) points += FIT_POINTS.gapTargeted;
  if (input.targetOfferTypes?.includes(input.recommendedOffer)) points += FIT_POINTS.offerTargeted;

  return clamp(points);
}

// --- Capacity Score ---------------------------------------------------------

/**
 * Sinais publicos de estrutura aparente. `null` em qualquer campo significa que a
 * fonte nao informa aquilo — o sinal sai da conta inteira (numerador e denominador),
 * exatamente como a 1.2 ja faz. Nada aqui afirma faturamento (SPEC 2.0 §14.1/§15.2).
 */
export type CapacitySignals = {
  reviewCount: number | null;
  rating: number | null;
  hasOpeningHours: boolean | null;
  hasAddress: boolean | null;
  hasPhone: boolean | null;
  /** A empresa apresenta mais de uma categoria/servico publicamente. */
  hasMultipleServices: boolean | null;
  /** Mais de um contato identificado. */
  hasMultipleContacts: boolean | null;
  /** O site respondeu. `null` quando nao houve auditoria. */
  websiteReachable: boolean | null;
};

const CAPACITY_MAX = {
  reviewCount: 30,
  rating: 10,
  openingHours: 12,
  address: 10,
  phone: 10,
  multipleServices: 8,
  multipleContacts: 10,
  websiteReachable: 10,
} as const;

const REVIEW_COUNT_TIERS: ReadonlyArray<{ min: number; points: number }> = [
  { min: 200, points: 30 },
  { min: 100, points: 25 },
  { min: 50, points: 20 },
  { min: 25, points: 14 },
  { min: 5, points: 8 },
  { min: 0, points: 0 },
];

const GOOD_RATING_THRESHOLD = 4.0;

export function computeCapacityScore(signals: CapacitySignals): number {
  let earned = 0;
  let available = 0;

  const reviewCount = signals.reviewCount;
  if (reviewCount !== null) {
    available += CAPACITY_MAX.reviewCount;
    earned += REVIEW_COUNT_TIERS.find((tier) => reviewCount >= tier.min)?.points ?? 0;
  }

  if (signals.rating !== null) {
    available += CAPACITY_MAX.rating;
    if (signals.rating >= GOOD_RATING_THRESHOLD) earned += CAPACITY_MAX.rating;
  }

  const booleanSignals: ReadonlyArray<[boolean | null, number]> = [
    [signals.hasOpeningHours, CAPACITY_MAX.openingHours],
    [signals.hasAddress, CAPACITY_MAX.address],
    [signals.hasPhone, CAPACITY_MAX.phone],
    [signals.hasMultipleServices, CAPACITY_MAX.multipleServices],
    [signals.hasMultipleContacts, CAPACITY_MAX.multipleContacts],
    [signals.websiteReachable, CAPACITY_MAX.websiteReachable],
  ];

  for (const [value, max] of booleanSignals) {
    if (value === null) continue;
    available += max;
    if (value) earned += max;
  }

  return normalize(earned, available);
}

// --- Contactability Score ---------------------------------------------------

export type ContactSignal = {
  email_verification_status: EmailVerificationStatus;
  is_decision_maker: boolean;
  hasPhone: boolean;
};

/**
 * Quanto cada estado de e-mail vale. `INVALID`, `BOUNCED`, `SUPPRESSED` e
 * `DISPOSABLE` valem zero: sao enderecos que o sistema tem proibicao de agendar
 * (SPEC 2.0 §10.3), entao nao podem contribuir para a contatabilidade de ninguem.
 */
const EMAIL_STATUS_POINTS: Record<EmailVerificationStatus, number> = {
  VALID: 60,
  ROLE_BASED: 35,
  ACCEPT_ALL: 30,
  RISKY: 0,
  UNKNOWN: 0,
  INVALID: 0,
  DISPOSABLE: 0,
  BOUNCED: 0,
  SUPPRESSED: 0,
};

const CONTACTABILITY_POINTS = {
  decisionMakerReachable: 20,
  phone: 10,
  multipleContacts: 10,
} as const;

export function computeContactabilityScore(contacts: ContactSignal[]): number {
  if (!contacts.length) return 0;

  const bestEmailPoints = Math.max(
    ...contacts.map((contact) => isEmailStatusSendable(contact.email_verification_status)
      ? EMAIL_STATUS_POINTS[contact.email_verification_status] : 0),
  );

  let points = bestEmailPoints;

  const decisionMakerReachable = contacts.some(
    (contact) =>
      contact.is_decision_maker &&
      isEmailStatusSendable(contact.email_verification_status),
  );
  if (decisionMakerReachable) points += CONTACTABILITY_POINTS.decisionMakerReachable;

  if (contacts.some((contact) => contact.hasPhone)) points += CONTACTABILITY_POINTS.phone;
  if (contacts.length > 1) points += CONTACTABILITY_POINTS.multipleContacts;

  return clamp(points);
}

// --- Timing Score -----------------------------------------------------------

/** Gatilhos observaveis publicamente (SPEC 2.0 §14.1). Nenhum deles e inferido. */
export const TIMING_TRIGGERS = [
  'NEW_UNIT',
  'NEW_SERVICE',
  'ACTIVE_CAMPAIGN',
  'RECENT_PUBLIC_CHANGE',
  'RECENT_REVIEW_ACTIVITY',
  'HIRING',
] as const;
export type TimingTrigger = (typeof TIMING_TRIGGERS)[number];

const TIMING_POINTS: Record<TimingTrigger, number> = {
  NEW_UNIT: 30,
  NEW_SERVICE: 25,
  ACTIVE_CAMPAIGN: 20,
  HIRING: 15,
  RECENT_PUBLIC_CHANGE: 15,
  RECENT_REVIEW_ACTIVITY: 10,
};

/**
 * Ausencia de gatilho e 0, e isso nao e punicao: o peso de timing e de apenas 5%
 * justamente porque a maioria dos leads nao tem gatilho observavel nenhum.
 */
export function computeTimingScore(triggers: TimingTrigger[]): number {
  const unique = Array.from(new Set(triggers));
  return clamp(unique.reduce((sum, trigger) => sum + (TIMING_POINTS[trigger] ?? 0), 0));
}

// --- Data Confidence --------------------------------------------------------

export type DataConfidenceInput = {
  /** Campos importantes preenchidos / campos importantes esperados. 0 a 1. */
  coverage: number;
  /** Quao recente e o dado mais velho que sustenta o lead. 0 a 1. */
  freshness: number;
  /** Ausencia de conflito entre fontes. 0 a 1. */
  consistency: number;
  /** Quantas fontes independentes sustentam o lead. */
  sourceCount: number;
};

const CONFIDENCE_WEIGHTS = {
  coverage: 0.4,
  freshness: 0.25,
  consistency: 0.2,
  provenance: 0.15,
} as const;

function ratio(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

/**
 * Mede a qualidade do que sustenta o score — nunca a oportunidade em si. Por isso
 * nao entra na formula comercial (SPEC 2.0 §14.1): ela apenas **limita** o nivel
 * quando o sistema sabe pouco demais para opinar.
 */
export function computeDataConfidence(input: DataConfidenceInput): number {
  // Uma fonte ja e um dado; duas fontes independentes concordando e o teto pratico.
  const provenance = input.sourceCount <= 0 ? 0 : input.sourceCount === 1 ? 0.6 : 1;

  return clamp(
    (ratio(input.coverage) * CONFIDENCE_WEIGHTS.coverage +
      ratio(input.freshness) * CONFIDENCE_WEIGHTS.freshness +
      ratio(input.consistency) * CONFIDENCE_WEIGHTS.consistency +
      provenance * CONFIDENCE_WEIGHTS.provenance) *
      MAX_SUBSCORE,
  );
}

/** Frescor decaindo linearmente ate `maxAgeDays`. Dado mais velho que isso vale 0. */
export function freshnessFromAgeDays(ageDays: number, maxAgeDays = 90): number {
  if (!Number.isFinite(ageDays) || ageDays < 0) return 0;
  if (maxAgeDays <= 0) return 0;
  return ratio(1 - ageDays / maxAgeDays);
}
