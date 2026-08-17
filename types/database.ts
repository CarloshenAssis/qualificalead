/**
 * Tipos do dominio + shape das tabelas (SPEC 17).
 * Espelha `database/migrations/0001_init.sql`, `0002_hardening.sql`, `0003_google_business_quality.sql`
 * e `0004_multi_source.sql`.
 */

import type { SourceId } from '@/lib/prospecting/sources/types';

export const WEBSITE_STATUSES = ['HAS_WEBSITE', 'NO_WEBSITE_DETECTED', 'UNKNOWN'] as const;
export type WebsiteStatus = (typeof WEBSITE_STATUSES)[number];

/** Rotulo de interface para cada estado do website (SPEC 1.1 §17). */
export const WEBSITE_STATUS_LABELS: Record<WebsiteStatus, string> = {
  HAS_WEBSITE: 'Site encontrado',
  NO_WEBSITE_DETECTED: 'Site nao identificado',
  UNKNOWN: 'Nao foi possivel verificar',
};

/**
 * `NOT_APPLICABLE`: a fonte nao fornece dados de perfil comercial do Google (SPEC 1.2
 * §34) — nunca deve ser tratado como `LOW` nem inventar uma heuristica propria para
 * outras fontes (ex.: OSM).
 */
export const GOOGLE_BUSINESS_QUALITIES = ['LOW', 'MEDIUM', 'HIGH', 'NOT_APPLICABLE'] as const;
export type GoogleBusinessQuality = (typeof GOOGLE_BUSINESS_QUALITIES)[number];

export const NEXT_ACTIONS = [
  'CONTACT_NOW',
  'RESEARCH_MORE',
  'LOW_PRIORITY',
  'ALREADY_CONTACTED',
  'DO_NOT_CONTACT',
] as const;
export type NextAction = (typeof NEXT_ACTIONS)[number];

export const NEXT_ACTION_LABELS: Record<NextAction, string> = {
  CONTACT_NOW: 'Contatar agora',
  RESEARCH_MORE: 'Pesquisar mais',
  LOW_PRIORITY: 'Baixa prioridade',
  ALREADY_CONTACTED: 'Ja contatado',
  DO_NOT_CONTACT: 'Nao contatar',
};

export const ENRICHMENT_STATUSES = ['OK', 'FAILED', 'SKIPPED'] as const;
export type EnrichmentStatus = (typeof ENRICHMENT_STATUSES)[number];

export const SEARCH_STATUSES = ['COMPLETED', 'PARTIAL', 'FAILED'] as const;
export type SearchStatus = (typeof SEARCH_STATUSES)[number];

/** Evidencia usada para calcular a confianca de um dado enriquecido (SPEC 1.1 §21/§23). */
export type MatchEvidence = {
  signal: string;
  label: string;
  matched: boolean;
};

export const INSTAGRAM_STATUSES = ['NOT_FOUND', 'PENDING', 'CONFIRMED', 'REJECTED'] as const;
export type InstagramStatus = (typeof INSTAGRAM_STATUSES)[number];

export const OPPORTUNITY_LEVELS = ['BAIXA', 'MEDIA', 'ALTA', 'EXCELENTE'] as const;
export type OpportunityLevel = (typeof OPPORTUNITY_LEVELS)[number];

export const LEAD_STATUSES = [
  'NOVO',
  'QUALIFICADO',
  'CONTATADO',
  'RESPONDEU',
  'INTERESSADO',
  'PROPOSTA',
  'VENDIDO',
  'SEM_INTERESSE',
  'DESCARTADO',
] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const LEAD_PRIORITIES = ['BAIXA', 'MEDIA', 'ALTA'] as const;
export type LeadPriority = (typeof LEAD_PRIORITIES)[number];

export const INTERACTION_TYPES = [
  'WHATSAPP',
  'LIGACAO',
  'EMAIL',
  'REUNIAO',
  'NOTA',
  'MUDANCA_STATUS',
] as const;
export type InteractionType = (typeof INTERACTION_TYPES)[number];

/** Uma linha da justificativa do score (SPEC 16). */
export type ScoreBreakdownItem = {
  code: string;
  label: string;
  points: number;
};

export type Profile = {
  id: string;
  user_id: string;
  name: string | null;
  created_at: string;
  updated_at: string;
};

export type Company = {
  id: string;
  user_id: string;
  google_place_id: string | null;
  name: string;
  category: string | null;
  categories: string[] | null;
  description: string | null;
  phone: string | null;
  phone_international: string | null;
  whatsapp: string | null;
  website: string | null;
  website_status: WebsiteStatus;
  google_maps_url: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
  rating: number | null;
  review_count: number | null;
  opening_hours: string[] | null;
  business_status: string | null;
  instagram_url: string | null;
  instagram_handle: string | null;
  instagram_confidence: number | null;
  instagram_status: InstagramStatus;
  instagram_source: string | null;
  instagram_evidence: MatchEvidence[];
  instagram_checked_at: string | null;
  website_checked_at: string | null;
  opportunity_score: number;
  opportunity_level: OpportunityLevel;
  score_breakdown: ScoreBreakdownItem[];
  google_business_quality: GoogleBusinessQuality;
  next_action: NextAction;
  next_action_reason: string | null;
  enrichment_status: EnrichmentStatus;
  enrichment_error: string | null;
  source_data: Record<string, unknown> | null;
  dedup_key: string | null;
  created_at: string;
  updated_at: string;
  last_checked_at: string | null;
};

/** Campos gravados na prospeccao — o banco gera id/created_at/updated_at. */
export type CompanyUpsert = Omit<Company, 'id' | 'created_at' | 'updated_at'>;

export type ProspectingSearch = {
  id: string;
  user_id: string;
  query: string;
  segment: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  radius: number | null;
  filters: Record<string, unknown> | null;
  status: SearchStatus;
  results_count: number;
  qualified_count: number;
  new_companies_count: number;
  existing_companies_count: number;
  high_opportunity_count: number;
  excellent_opportunity_count: number;
  without_website_count: number;
  /** Base para um futuro controle de creditos (SPEC 1.1 §83). */
  places_requested: number;
  places_processed: number;
  enrichment_count: number;
  enrichment_failed_count: number;
  created_at: string;
};

export type Lead = {
  id: string;
  user_id: string;
  company_id: string;
  status: LeadStatus;
  priority: LeadPriority;
  notes: string | null;
  created_at: string;
  updated_at: string;
  last_contacted_at: string | null;
  next_follow_up_at: string | null;
};

export type Interaction = {
  id: string;
  user_id: string;
  lead_id: string;
  type: InteractionType;
  description: string | null;
  created_at: string;
};

/** Dados preenchidos a mao pelo usuario (SPEC 26) — sempre separados dos coletados. */
export type BriefingManualData = {
  logo_url?: string;
  colors?: string;
  description?: string;
  services?: string;
  products?: string;
  differentials?: string;
  photos?: string;
  menu?: string;
  prices?: string;
  institutional?: string;
  links?: string;
  notes?: string;
};

export type Briefing = {
  id: string;
  user_id: string;
  company_id: string;
  manual_data: BriefingManualData;
  generated_briefing: string | null;
  generated_lovable_prompt: string | null;
  created_at: string;
  updated_at: string;
};

export type CompanyWithLead = Company & {
  leads: Pick<Lead, 'id' | 'status' | 'priority'>[] | null;
};

// --- Multi-source (SPEC 1.2 FASE 6) -----------------------------------------

/** Completude do registro trazido por uma fonte — nao e score comercial (SPEC 1.2 §14). */
export const SOURCE_QUALITY_LEVELS = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type SourceQualityLevel = (typeof SOURCE_QUALITY_LEVELS)[number];

/**
 * `HIGH` nunca aparece aqui: confianca alta funde automaticamente (vira duas linhas em
 * `lead_sources` apontando pro mesmo `company_id`, sem necessidade de revisao). Esta
 * tabela guarda apenas os casos incertos, para revisao humana futura.
 */
export const DUPLICATE_CONFIDENCE_LEVELS = ['LOW', 'MEDIUM'] as const;
export type DuplicateConfidenceLevel = (typeof DUPLICATE_CONFIDENCE_LEVELS)[number];

/**
 * Uma linha por (empresa, fonte, id externo) — a identidade neutra que substitui
 * `google_place_id` como fonte de verdade (SPEC 1.2 FASE 6). Uma empresa encontrada em
 * duas fontes tem duas linhas com o mesmo `company_id`.
 */
export type LeadSource = {
  id: string;
  user_id: string;
  company_id: string;
  source: SourceId;
  /** `null` apenas para `LEGACY` sem origem conhecida — nunca um id interno disfarcado. */
  source_id: string | null;
  source_url: string | null;
  source_quality: SourceQualityLevel | null;
  raw_data: Record<string, unknown>;
  first_seen_at: string;
  last_seen_at: string;
  created_at: string;
  updated_at: string;
};

export type LeadSourceUpsert = Omit<LeadSource, 'id' | 'created_at' | 'updated_at'>;

/** Evidencia de possivel duplicidade cross-source que nao foi fundida automaticamente. */
export type LeadDuplicateCandidate = {
  id: string;
  user_id: string;
  company_id: string;
  candidate_company_id: string;
  confidence: DuplicateConfidenceLevel;
  signals: string[];
  created_at: string;
};

/** Cache persistente de descoberta (SPEC 1.2 §25/§43) — sobrevive entre invocacoes na Vercel. */
export type DiscoveryCacheRow = {
  id: string;
  user_id: string;
  source: SourceId;
  cache_key: string;
  params: Record<string, unknown>;
  result: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  expires_at: string;
};
