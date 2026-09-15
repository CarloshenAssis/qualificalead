/**
 * Vocabulario do dominio comercial da SPEC 2.0.
 *
 * Espelha `database/migrations/0007_spec2_commercial_core.sql`. Este arquivo NAO
 * substitui `types/database.ts`: a 2.0 nao remove nada da 1.2. `companies`,
 * `lead_sources`, `leads` e `briefings` continuam existindo com o mesmo shape — o
 * que a 2.0 acrescenta e a camada comercial (campanha, contato, evidencia, gap,
 * oferta, qualificacao versionada, e-mail, CRM e jobs) construida em cima deles.
 *
 * Regra que atravessa todos os tipos daqui (SPEC 2.0 §3.1/§3.2): dado coletado,
 * observacao, inferencia e decisao humana sao coisas diferentes e nunca colapsam
 * num campo so. Ausencia na fonte e `UNKNOWN`, nunca um fato confirmado.
 */

import type { SourceId } from '@/lib/prospecting/sources/types';

// --- Campanhas (SPEC 2.0 §7) -----------------------------------------------

export const CAMPAIGN_STATUSES = [
  'DRAFT',
  'READY',
  'DISCOVERING',
  'ENRICHING',
  'SCORING',
  'REVIEW_REQUIRED',
  'ACTIVE',
  'PAUSED',
  'COMPLETED',
  'CANCELLED',
  'FAILED',
] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

/** Como a campanha escolhe as fontes de descoberta (SPEC 2.0 §7.2/§8). */
export const CAMPAIGN_SOURCE_MODES = ['FREE', 'BALANCED', 'CUSTOM'] as const;
export type CampaignSourceMode = (typeof CAMPAIGN_SOURCE_MODES)[number];

export type Campaign = {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  segment: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  neighborhoods: string[] | null;
  search_terms: string[] | null;
  source_mode: CampaignSourceMode;
  requested_sources: SourceId[] | null;
  target_gap_types: GapType[] | null;
  target_offer_types: OfferType[] | null;
  max_companies: number;
  max_website_audits: number;
  max_ai_analyses: number;
  max_email_contacts: number;
  daily_send_limit: number;
  /** Teto de custo da campanha em centavos — evita depender de float para dinheiro. */
  budget_limit_cents: number | null;
  sequence_id: string | null;
  status: CampaignStatus;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

// --- Contatos (SPEC 2.0 §10) ------------------------------------------------

export const EMAIL_VERIFICATION_STATUSES = [
  'UNKNOWN',
  'VALID',
  'RISKY',
  'INVALID',
  'ROLE_BASED',
  'DISPOSABLE',
  'ACCEPT_ALL',
  'BOUNCED',
  'SUPPRESSED',
] as const;
export type EmailVerificationStatus = (typeof EMAIL_VERIFICATION_STATUSES)[number];

export const CONTACT_CONFIDENCES = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type ContactConfidence = (typeof CONTACT_CONFIDENCES)[number];

export type Contact = {
  id: string;
  user_id: string;
  company_id: string;
  name: string | null;
  role: string | null;
  email: string | null;
  email_normalized: string | null;
  phone: string | null;
  phone_normalized: string | null;
  is_decision_maker: boolean;
  source: SourceId | null;
  source_url: string | null;
  confidence: ContactConfidence;
  email_verification_status: EmailVerificationStatus;
  email_verification_reason: string | null;
  email_verified_at: string | null;
  is_primary: boolean;
  created_at: string;
  updated_at: string;
};

// --- Observacoes e evidencia (SPEC 2.0 §11) ---------------------------------

export const OBSERVATION_STATUSES = [
  'OBSERVED',
  'INFERRED',
  'CONFIRMED',
  'REJECTED',
  'EXPIRED',
] as const;
export type ObservationStatus = (typeof OBSERVATION_STATUSES)[number];

export const EVIDENCE_CONFIDENCES = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type EvidenceConfidence = (typeof EVIDENCE_CONFIDENCES)[number];

/**
 * Sinais que a auditoria de presenca digital sabe observar (SPEC 2.0 §11.2).
 * Cada um responde a uma pergunta verificavel numa pagina publica — nunca uma
 * opiniao. O prefixo diz o que foi olhado, nao o que se concluiu.
 */
export const OBSERVATION_TYPES = [
  'WEBSITE_REACHABLE',
  'WEBSITE_HTTPS',
  'WEBSITE_REDIRECTS_OK',
  'HAS_TITLE',
  'HAS_META_DESCRIPTION',
  'HAS_RESPONSIVE_VIEWPORT',
  'HAS_PHONE',
  'HAS_EMAIL',
  'HAS_WHATSAPP',
  'HAS_FORM',
  'HAS_CTA',
  'HAS_SERVICE_PAGES',
  'HAS_FAQ',
  'HAS_TESTIMONIALS',
  'HAS_SCHEDULING',
  'HAS_ADDRESS',
  'HAS_MAP',
  'HAS_SOCIAL_LINKS',
  'HAS_QUOTE_FLOW',
  'INFORMATION_OUTDATED',
] as const;
export type ObservationType = (typeof OBSERVATION_TYPES)[number];

export type CompanyObservation = {
  id: string;
  user_id: string;
  company_id: string;
  type: ObservationType;
  /**
   * `null` quando a auditoria nao conseguiu decidir. Isso e diferente de `false`:
   * `false` e "olhei e nao existe", `null` e "nao consegui olhar" (SPEC 2.0 §3.2).
   */
  value: boolean | null;
  source_url: string | null;
  source_type: string | null;
  confidence: EvidenceConfidence;
  observed_at: string;
  expires_at: string | null;
  raw_evidence: Record<string, unknown> | null;
  status: ObservationStatus;
  created_at: string;
};

/** Proveniencia por campo consolidado da empresa (SPEC 2.0 §9.3). */
export type CompanyFieldEvidence = {
  id: string;
  user_id: string;
  company_id: string;
  field: string;
  value: string | null;
  source: SourceId;
  confidence: EvidenceConfidence;
  observed_at: string;
  created_at: string;
};

// --- Gaps (SPEC 2.0 §12) ----------------------------------------------------

/** Gaps observaveis por auditoria externa de paginas publicas (SPEC 2.0 §12.1). */
export const EXTERNAL_GAP_TYPES = [
  'NO_WEBSITE',
  'WEBSITE_UNKNOWN',
  'WEAK_WEBSITE',
  'NO_CONVERSION_PAGE',
  'NO_LEAD_CAPTURE',
  'NO_SCHEDULING',
  'POOR_SERVICE_PRESENTATION',
  'WEAK_CTA',
  'NO_FAQ',
  'WEAK_SOCIAL_DESTINATION',
  'NO_QUOTE_FLOW',
  'OUTDATED_INFORMATION',
] as const;
export type ExternalGapType = (typeof EXTERNAL_GAP_TYPES)[number];

/**
 * Gaps internos (SPEC 2.0 §12.2): nunca podem ser afirmados por auditoria externa.
 * Dependem de conversa, formulario respondido ou diagnostico operacional.
 */
export const INTERNAL_GAP_TYPES = [
  'MANUAL_FOLLOW_UP',
  'MANUAL_PROPOSALS',
  'REPETITIVE_SERVICE_MESSAGES',
  'DISCONNECTED_WORKFLOW',
] as const;
export type InternalGapType = (typeof INTERNAL_GAP_TYPES)[number];

export const GAP_TYPES = [...EXTERNAL_GAP_TYPES, ...INTERNAL_GAP_TYPES] as const;
export type GapType = (typeof GAP_TYPES)[number];

export const GAP_STATUSES = [
  'DETECTED',
  'NEEDS_REVIEW',
  'CONFIRMED',
  'REJECTED',
  'RESOLVED',
  'EXPIRED',
] as const;
export type GapStatus = (typeof GAP_STATUSES)[number];

export type CompanyGap = {
  id: string;
  user_id: string;
  company_id: string;
  gap_type: GapType;
  /** 1 a 5. Intensidade do gap, nao probabilidade de venda. */
  severity: number;
  /** 0 a 1. */
  confidence: number;
  evidence_ids: string[];
  recommended_offer: OfferType | null;
  status: GapStatus;
  detected_at: string;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
};

// --- Ofertas (SPEC 2.0 §13) -------------------------------------------------

export const OFFER_TYPES = [
  'INSTITUTIONAL_WEBSITE',
  'WEBSITE_REDESIGN',
  'LANDING_PAGE',
  'BIO_PAGE',
  'SERVICE_CATALOG',
  'QUALIFICATION_FORM',
  'QUOTE_FORM',
  'SCHEDULING_PAGE',
  'FAQ_PAGE',
  'MINI_CRM',
  'PROPOSAL_GENERATOR',
  'CUSTOM_AUTOMATION',
] as const;
export type OfferType = (typeof OFFER_TYPES)[number];

export const DEMO_TYPES = ['NONE', 'TEXT_DIAGNOSIS', 'LIGHT_PREVIEW', 'PROTOTYPE'] as const;
export type DemoType = (typeof DEMO_TYPES)[number];

// --- Qualificacao (SPEC 2.0 §14) --------------------------------------------

export const OPPORTUNITY_LEVELS_V2 = ['LOW', 'MEDIUM', 'HIGH', 'EXCELLENT'] as const;
export type OpportunityLevelV2 = (typeof OPPORTUNITY_LEVELS_V2)[number];

export const RECOMMENDED_ACTIONS = [
  'READY_FOR_EMAIL',
  'REVIEW_FOR_EMAIL',
  'RESEARCH_MORE',
  'LOW_PRIORITY',
  'DO_NOT_CONTACT',
] as const;
export type RecommendedAction = (typeof RECOMMENDED_ACTIONS)[number];

/** Uma linha auditavel da justificativa do score (SPEC 2.0 §14.5). */
export type QualificationReason = {
  code: string;
  label: string;
  /** Contribuicao em pontos do score final, quando aplicavel. */
  points?: number;
};

export type QualificationResult = {
  id: string;
  user_id: string;
  company_id: string;
  campaign_id: string | null;
  /** SPEC 2.0 §14.6: mudanca de peso nunca reescreve historico em silencio. */
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
  created_at: string;
};

// --- Pipeline e CRM (SPEC 2.0 §21) ------------------------------------------

export const PIPELINE_STAGES = [
  'DISCOVERED',
  'ENRICHED',
  'QUALIFIED',
  'REVIEW_PENDING',
  'APPROVED_FOR_EMAIL',
  'EMAIL_SEQUENCE_ACTIVE',
  'REPLIED',
  'POSITIVE_REPLY',
  'DISCOVERY',
  'DIAGNOSIS_SENT',
  'MEETING',
  'PROPOSAL',
  'WON',
  'LOST',
  'NOT_INTERESTED',
  'UNRESPONSIVE',
  'DO_NOT_CONTACT',
] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export type CampaignLead = {
  id: string;
  user_id: string;
  campaign_id: string;
  company_id: string;
  contact_id: string | null;
  stage: PipelineStage;
  qualification_id: string | null;
  approved_at: string | null;
  approved_by: string | null;
  rejected_reason: string | null;
  created_at: string;
  updated_at: string;
};

export const TASK_TYPES = [
  'REVIEW_LEAD',
  'REVIEW_MESSAGE',
  'REPLY_EMAIL',
  'RESEARCH_CONTACT',
  'CREATE_PREVIEW',
  'SEND_DIAGNOSIS',
  'SCHEDULE_MEETING',
  'PREPARE_PROPOSAL',
  'FOLLOW_UP_MANUAL',
] as const;
export type TaskType = (typeof TASK_TYPES)[number];

export const TASK_STATUSES = ['OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export type SalesOpportunity = {
  id: string;
  user_id: string;
  company_id: string;
  contact_id: string | null;
  campaign_id: string | null;
  owner_id: string | null;
  status: PipelineStage;
  offer_type: OfferType | null;
  estimated_value_cents: number | null;
  proposed_value_cents: number | null;
  won_value_cents: number | null;
  probability: number | null;
  next_action: string | null;
  next_action_at: string | null;
  loss_reason: string | null;
  won_at: string | null;
  lost_at: string | null;
  created_at: string;
  updated_at: string;
};

// --- E-mail (SPEC 2.0 §17/§18/§19) ------------------------------------------

export const MESSAGE_STATUSES = [
  'SCHEDULED',
  'QUEUED',
  'SENT',
  'DELIVERED',
  'BOUNCED',
  'REPLIED',
  'CANCELLED',
  'FAILED',
] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

export const EMAIL_EVENT_TYPES = [
  'SCHEDULED',
  'QUEUED',
  'SENT',
  'DELIVERED',
  'DEFERRED',
  'SOFT_BOUNCE',
  'HARD_BOUNCE',
  'COMPLAINT',
  'OPENED',
  'CLICKED',
  'REPLIED',
  'UNSUBSCRIBED',
  'CANCELLED',
  'FAILED',
] as const;
export type EmailEventType = (typeof EMAIL_EVENT_TYPES)[number];

export const REPLY_CLASSIFICATIONS = [
  'POSITIVE',
  'QUESTION',
  'REFERRAL',
  'NOT_NOW',
  'NEGATIVE',
  'UNSUBSCRIBE',
  'OUT_OF_OFFICE',
  'AUTOMATED',
  'WRONG_PERSON',
  'UNKNOWN',
] as const;
export type ReplyClassification = (typeof REPLY_CLASSIFICATIONS)[number];

export const SUPPRESSION_SCOPES = ['EMAIL', 'DOMAIN', 'CONTACT', 'COMPANY'] as const;
export type SuppressionScope = (typeof SUPPRESSION_SCOPES)[number];

export const SUPPRESSION_REASONS = [
  'HARD_BOUNCE',
  'REPEATED_SOFT_BOUNCE',
  'COMPLAINT',
  'UNSUBSCRIBE',
  'MANUAL',
  'DO_NOT_CONTACT',
] as const;
export type SuppressionReason = (typeof SUPPRESSION_REASONS)[number];

export type SuppressionEntry = {
  id: string;
  user_id: string;
  scope: SuppressionScope;
  /** E-mail normalizado, dominio, contact_id ou company_id conforme o escopo. */
  value: string;
  reason: SuppressionReason;
  origin: string | null;
  created_at: string;
};

export const SENDER_AUTH_STATUSES = ['UNKNOWN', 'PASS', 'FAIL'] as const;
export type SenderAuthStatus = (typeof SENDER_AUTH_STATUSES)[number];

export type EmailSender = {
  id: string;
  user_id: string;
  name: string;
  address: string;
  reply_to: string | null;
  domain: string;
  provider: string;
  spf_status: SenderAuthStatus;
  dkim_status: SenderAuthStatus;
  dmarc_status: SenderAuthStatus;
  daily_limit: number;
  sent_today: number;
  reputation_status: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export const TEMPLATE_STATUSES = ['DRAFT', 'APPROVED', 'ARCHIVED'] as const;
export type TemplateStatus = (typeof TEMPLATE_STATUSES)[number];

export type EmailTemplate = {
  id: string;
  user_id: string;
  name: string;
  subject_template: string;
  body_text_template: string;
  body_html_template: string | null;
  gap_types: GapType[] | null;
  offer_types: OfferType[] | null;
  required_variables: string[];
  status: TemplateStatus;
  version: number;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
};

// --- Jobs (SPEC 2.0 §24) ----------------------------------------------------

export const JOB_TYPES = [
  'START_APIFY_RUN',
  'IMPORT_APIFY_DATASET',
  'NORMALIZE_BUSINESS',
  'CONSOLIDATE_COMPANY',
  'AUDIT_WEBSITE',
  'DETECT_GAPS',
  'SCORE_COMPANY',
  'VERIFY_EMAIL',
  'GENERATE_EMAIL',
  'SCHEDULE_SEQUENCE',
  'SEND_EMAIL',
  'PROCESS_EMAIL_EVENT',
  'CLASSIFY_REPLY',
  'GENERATE_DIAGNOSIS',
] as const;
export type JobType = (typeof JOB_TYPES)[number];

export const JOB_STATUSES = [
  'PENDING',
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
  'DEAD_LETTER',
  'CANCELLED',
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export type Job = {
  id: string;
  user_id: string;
  campaign_id: string | null;
  type: JobType;
  status: JobStatus;
  priority: number;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
  scheduled_for: string;
  started_at: string | null;
  finished_at: string | null;
  locked_by: string | null;
  locked_until: string | null;
  error: string | null;
  progress: number;
  created_at: string;
  updated_at: string;
};
