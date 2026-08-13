/**
 * Tipos do dominio + shape das tabelas (SPEC 17).
 * Espelha `database/migrations/0001_init.sql`.
 */

export const WEBSITE_STATUSES = ['HAS_WEBSITE', 'NO_WEBSITE_DETECTED'] as const;
export type WebsiteStatus = (typeof WEBSITE_STATUSES)[number];

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
  opportunity_score: number;
  opportunity_level: OpportunityLevel;
  score_breakdown: ScoreBreakdownItem[];
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
  city: string | null;
  state: string | null;
  country: string | null;
  radius: number | null;
  filters: Record<string, unknown> | null;
  results_count: number;
  qualified_count: number;
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
