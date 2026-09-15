-- ---------------------------------------------------------------------------
-- LeadHunter — SPEC 2.0 (nucleo comercial)
-- Campanhas, contatos, evidencia, gaps, ofertas, qualificacao versionada,
-- e-mail, CRM e jobs. Execute depois de 0006_company_email.sql.
--
-- Esta migracao NAO remove nem renomeia nada. `companies`, `lead_sources`,
-- `leads`, `interactions` e `briefings` continuam exatamente como estao: a 2.0
-- constroi a camada comercial em cima deles (SPEC 2.0 §36.1). Empresas e leads
-- existentes continuam visiveis e funcionando sem nenhuma acao do usuario.
--
-- Nao existe nada de WhatsApp aqui — nenhuma tabela, fila, credencial ou evento
-- (SPEC 2.0 §33.5). WhatsApp e manual e vive inteiramente fora do banco.
-- ---------------------------------------------------------------------------

-- 1. Enums --------------------------------------------------------------------

-- Novas fontes da 2.0 (§8.1). ALTER TYPE ... ADD VALUE IF NOT EXISTS e idempotente
-- e nao invalida nenhum valor ja gravado em lead_sources/discovery_cache.
-- Nenhum dos valores novos e usado no restante deste script, de proposito: o
-- PostgreSQL proibe usar um valor de enum na mesma transacao em que ele foi criado.
alter type lead_source_type add value if not exists 'APIFY_GOOGLE_MAPS';
alter type lead_source_type add value if not exists 'APIFY_DATASET';
alter type lead_source_type add value if not exists 'CSV_IMPORT';
alter type lead_source_type add value if not exists 'MANUAL';

do $$ begin
  create type campaign_status as enum (
    'DRAFT', 'READY', 'DISCOVERING', 'ENRICHING', 'SCORING',
    'REVIEW_REQUIRED', 'ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED', 'FAILED'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type campaign_source_mode as enum ('FREE', 'BALANCED', 'CUSTOM');
exception when duplicate_object then null; end $$;

do $$ begin
  create type email_verification_status as enum (
    'UNKNOWN', 'VALID', 'RISKY', 'INVALID', 'ROLE_BASED',
    'DISPOSABLE', 'ACCEPT_ALL', 'BOUNCED', 'SUPPRESSED'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type evidence_confidence as enum ('LOW', 'MEDIUM', 'HIGH');
exception when duplicate_object then null; end $$;

do $$ begin
  create type observation_status as enum (
    'OBSERVED', 'INFERRED', 'CONFIRMED', 'REJECTED', 'EXPIRED'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type gap_status as enum (
    'DETECTED', 'NEEDS_REVIEW', 'CONFIRMED', 'REJECTED', 'RESOLVED', 'EXPIRED'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type pipeline_stage as enum (
    'DISCOVERED', 'ENRICHED', 'QUALIFIED', 'REVIEW_PENDING', 'APPROVED_FOR_EMAIL',
    'EMAIL_SEQUENCE_ACTIVE', 'REPLIED', 'POSITIVE_REPLY', 'DISCOVERY',
    'DIAGNOSIS_SENT', 'MEETING', 'PROPOSAL', 'WON', 'LOST',
    'NOT_INTERESTED', 'UNRESPONSIVE', 'DO_NOT_CONTACT'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type message_status as enum (
    'SCHEDULED', 'QUEUED', 'SENT', 'DELIVERED', 'BOUNCED', 'REPLIED', 'CANCELLED', 'FAILED'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type email_event_type as enum (
    'SCHEDULED', 'QUEUED', 'SENT', 'DELIVERED', 'DEFERRED', 'SOFT_BOUNCE',
    'HARD_BOUNCE', 'COMPLAINT', 'OPENED', 'CLICKED', 'REPLIED',
    'UNSUBSCRIBED', 'CANCELLED', 'FAILED'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type reply_classification as enum (
    'POSITIVE', 'QUESTION', 'REFERRAL', 'NOT_NOW', 'NEGATIVE', 'UNSUBSCRIBE',
    'OUT_OF_OFFICE', 'AUTOMATED', 'WRONG_PERSON', 'UNKNOWN'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type suppression_scope as enum ('EMAIL', 'DOMAIN', 'CONTACT', 'COMPANY');
exception when duplicate_object then null; end $$;

do $$ begin
  create type suppression_reason as enum (
    'HARD_BOUNCE', 'REPEATED_SOFT_BOUNCE', 'COMPLAINT', 'UNSUBSCRIBE', 'MANUAL', 'DO_NOT_CONTACT'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type sender_auth_status as enum ('UNKNOWN', 'PASS', 'FAIL');
exception when duplicate_object then null; end $$;

do $$ begin
  create type template_status as enum ('DRAFT', 'APPROVED', 'ARCHIVED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type task_type as enum (
    'REVIEW_LEAD', 'REVIEW_MESSAGE', 'REPLY_EMAIL', 'RESEARCH_CONTACT', 'CREATE_PREVIEW',
    'SEND_DIAGNOSIS', 'SCHEDULE_MEETING', 'PREPARE_PROPOSAL', 'FOLLOW_UP_MANUAL'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type task_status as enum ('OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type job_type as enum (
    'START_APIFY_RUN', 'IMPORT_APIFY_DATASET', 'NORMALIZE_BUSINESS', 'CONSOLIDATE_COMPANY',
    'AUDIT_WEBSITE', 'DETECT_GAPS', 'SCORE_COMPANY', 'VERIFY_EMAIL', 'GENERATE_EMAIL',
    'SCHEDULE_SEQUENCE', 'SEND_EMAIL', 'PROCESS_EMAIL_EVENT', 'CLASSIFY_REPLY',
    'GENERATE_DIAGNOSIS'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type job_status as enum (
    'PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'DEAD_LETTER', 'CANCELLED'
  );
exception when duplicate_object then null; end $$;

-- Gap e oferta ficam como TEXT com CHECK em vez de enum: os catalogos (§12/§13) sao
-- de produto e vao ganhar entradas novas com frequencia. Um CHECK e alteravel numa
-- migracao simples; um enum em coluna de varias tabelas, muito menos.

-- 2. Campanhas (§7) -----------------------------------------------------------

create table if not exists campaigns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  description text,
  segment text,
  city text,
  state text,
  country text,
  neighborhoods text[],
  search_terms text[],
  source_mode campaign_source_mode not null default 'FREE',
  requested_sources lead_source_type[],
  target_gap_types text[],
  target_offer_types text[],
  max_companies integer not null default 250,
  max_website_audits integer not null default 250,
  max_ai_analyses integer not null default 100,
  max_email_contacts integer not null default 100,
  daily_send_limit integer not null default 25,
  -- Dinheiro em centavos: float nunca representa centavo com exatidao.
  budget_limit_cents integer,
  sequence_id uuid,
  status campaign_status not null default 'DRAFT',
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'campaigns_id_user_key') then
    alter table campaigns add constraint campaigns_id_user_key unique (id, user_id);
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'campaigns_limits_positive') then
    alter table campaigns add constraint campaigns_limits_positive check (
      max_companies > 0 and max_website_audits >= 0 and max_ai_analyses >= 0
      and max_email_contacts >= 0 and daily_send_limit >= 0
      and (budget_limit_cents is null or budget_limit_cents >= 0)
    );
  end if;
end $$;

create index if not exists campaigns_user_idx on campaigns (user_id);
create index if not exists campaigns_status_idx on campaigns (user_id, status);

drop trigger if exists campaigns_set_updated_at on campaigns;
create trigger campaigns_set_updated_at
  before update on campaigns
  for each row execute function set_updated_at();

-- Fontes escolhidas por campanha, com o custo/uso que cada uma produziu (§8.5).
create table if not exists campaign_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  campaign_id uuid not null,
  source lead_source_type not null,
  -- Input completo enviado ao Actor/fonte: exigido pela SPEC 2.0 §8.5 para auditoria.
  run_input jsonb not null default '{}'::jsonb,
  external_run_id text,
  external_dataset_id text,
  items_imported integer not null default 0,
  cost_cents integer not null default 0,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'campaign_sources_campaign_same_user_fk') then
    alter table campaign_sources
      add constraint campaign_sources_campaign_same_user_fk
      foreign key (campaign_id, user_id) references campaigns (id, user_id) on delete cascade;
  end if;
end $$;

-- "Nao iniciar dois runs ativos para a mesma campanha" (§8.5) imposto no banco:
-- um run e ativo enquanto nao tem finished_at.
create unique index if not exists campaign_sources_one_active_run
  on campaign_sources (campaign_id, source)
  where finished_at is null;

create index if not exists campaign_sources_user_idx on campaign_sources (user_id);

drop trigger if exists campaign_sources_set_updated_at on campaign_sources;
create trigger campaign_sources_set_updated_at
  before update on campaign_sources
  for each row execute function set_updated_at();

-- 3. Contatos (§10) -----------------------------------------------------------

create table if not exists contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  company_id uuid not null,
  name text,
  role text,
  email text,
  email_normalized text,
  phone text,
  phone_normalized text,
  is_decision_maker boolean not null default false,
  source lead_source_type,
  source_url text,
  confidence evidence_confidence not null default 'LOW',
  email_verification_status email_verification_status not null default 'UNKNOWN',
  email_verification_reason text,
  email_verified_at timestamptz,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'contacts_id_user_key') then
    alter table contacts add constraint contacts_id_user_key unique (id, user_id);
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'contacts_company_same_user_fk') then
    alter table contacts
      add constraint contacts_company_same_user_fk
      foreign key (company_id, user_id) references companies (id, user_id) on delete cascade;
  end if;
end $$;

-- O mesmo endereco nunca vira dois contatos da mesma empresa.
create unique index if not exists contacts_company_email_key
  on contacts (company_id, email_normalized)
  where email_normalized is not null;

-- No maximo um contato primario por empresa.
create unique index if not exists contacts_one_primary_per_company
  on contacts (company_id)
  where is_primary;

create index if not exists contacts_user_idx on contacts (user_id);
create index if not exists contacts_company_idx on contacts (company_id);

drop trigger if exists contacts_set_updated_at on contacts;
create trigger contacts_set_updated_at
  before update on contacts
  for each row execute function set_updated_at();

-- 4. Evidencia e observacoes (§11) --------------------------------------------

create table if not exists company_observations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  company_id uuid not null,
  type text not null,
  -- NULL = "nao consegui olhar". Diferente de false = "olhei e nao existe" (§3.2).
  value boolean,
  source_url text,
  source_type text,
  confidence evidence_confidence not null default 'MEDIUM',
  observed_at timestamptz not null default now(),
  expires_at timestamptz,
  raw_evidence jsonb,
  status observation_status not null default 'OBSERVED',
  created_at timestamptz not null default now()
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'company_observations_id_user_key') then
    alter table company_observations
      add constraint company_observations_id_user_key unique (id, user_id);
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'company_observations_company_same_user_fk') then
    alter table company_observations
      add constraint company_observations_company_same_user_fk
      foreign key (company_id, user_id) references companies (id, user_id) on delete cascade;
  end if;
end $$;

create index if not exists company_observations_user_idx on company_observations (user_id);
create index if not exists company_observations_company_idx
  on company_observations (company_id, type);

-- Proveniencia por campo consolidado (§9.3).
create table if not exists company_field_evidence (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  company_id uuid not null,
  field text not null,
  value text,
  source lead_source_type not null,
  confidence evidence_confidence not null default 'MEDIUM',
  observed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'company_field_evidence_company_same_user_fk') then
    alter table company_field_evidence
      add constraint company_field_evidence_company_same_user_fk
      foreign key (company_id, user_id) references companies (id, user_id) on delete cascade;
  end if;
end $$;

create unique index if not exists company_field_evidence_key
  on company_field_evidence (company_id, field, source);

create index if not exists company_field_evidence_user_idx on company_field_evidence (user_id);

-- 5. Gaps (§12) ---------------------------------------------------------------

create table if not exists company_gaps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  company_id uuid not null,
  gap_type text not null,
  severity smallint not null default 3,
  confidence numeric(3, 2) not null default 0.50,
  -- Ids de company_observations que sustentam o gap. Um gap sem evidencia nao e um
  -- gap (§33.2) — a regra vive na aplicacao porque um array vazio ainda e valido
  -- para gaps internos, que nascem de conversa e nao de auditoria.
  evidence_ids uuid[] not null default '{}',
  recommended_offer text,
  status gap_status not null default 'DETECTED',
  detected_at timestamptz not null default now(),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'company_gaps_severity_range') then
    alter table company_gaps add constraint company_gaps_severity_range
      check (severity between 1 and 5 and confidence between 0 and 1);
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'company_gaps_company_same_user_fk') then
    alter table company_gaps
      add constraint company_gaps_company_same_user_fk
      foreign key (company_id, user_id) references companies (id, user_id) on delete cascade;
  end if;
end $$;

-- Um gap por tipo por empresa: reprocessar atualiza a linha, nao cria outra.
create unique index if not exists company_gaps_company_type_key
  on company_gaps (company_id, gap_type);

create index if not exists company_gaps_user_idx on company_gaps (user_id);

drop trigger if exists company_gaps_set_updated_at on company_gaps;
create trigger company_gaps_set_updated_at
  before update on company_gaps
  for each row execute function set_updated_at();

-- 6. Catalogo de ofertas (§13) ------------------------------------------------
-- O catalogo de codigo (lib/offers/catalog.ts) e o padrao; esta tabela guarda a
-- personalizacao do usuario (preco, prazo, ativo/inativo), que e decisao comercial
-- dele e nao pode ser inventada pelo sistema (§3.3).

create table if not exists offer_catalog (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  offer_type text not null,
  name text not null,
  description text,
  price_min_cents integer,
  price_max_cents integer,
  estimated_days integer,
  compatible_gaps text[] not null default '{}',
  compatible_segments text[] not null default '{}',
  minimum_evidence text[] not null default '{}',
  recommended_cta text,
  demo_type text not null default 'NONE',
  max_preview_hours integer,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'offer_catalog_user_type_key') then
    alter table offer_catalog add constraint offer_catalog_user_type_key unique (user_id, offer_type);
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'offer_catalog_price_order') then
    alter table offer_catalog add constraint offer_catalog_price_order check (
      price_min_cents is null or price_max_cents is null or price_min_cents <= price_max_cents
    );
  end if;
end $$;

create index if not exists offer_catalog_user_idx on offer_catalog (user_id);

drop trigger if exists offer_catalog_set_updated_at on offer_catalog;
create trigger offer_catalog_set_updated_at
  before update on offer_catalog
  for each row execute function set_updated_at();

-- 7. Qualificacao versionada (§14.6) ------------------------------------------
-- Append-only por design: cada requalificacao insere uma linha nova. Mudar peso de
-- score nunca reescreve o passado, e o score antigo (score_version = 1, migrado na
-- secao 14) continua consultavel (§36.3).

create table if not exists qualification_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  company_id uuid not null,
  campaign_id uuid,
  score_version integer not null,
  opportunity_score smallint not null,
  opportunity_level text not null,
  need_score smallint not null default 0,
  commercial_fit_score smallint not null default 0,
  capacity_score smallint not null default 0,
  contactability_score smallint not null default 0,
  timing_score smallint not null default 0,
  data_confidence smallint not null default 0,
  primary_gap text,
  recommended_offer text,
  recommended_action text not null,
  reasons jsonb not null default '[]'::jsonb,
  evidence_ids uuid[] not null default '{}',
  created_at timestamptz not null default now()
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'qualification_results_id_user_key') then
    alter table qualification_results
      add constraint qualification_results_id_user_key unique (id, user_id);
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'qualification_results_ranges') then
    alter table qualification_results add constraint qualification_results_ranges check (
      opportunity_score between 0 and 100
      and need_score between 0 and 100
      and commercial_fit_score between 0 and 100
      and capacity_score between 0 and 100
      and contactability_score between 0 and 100
      and timing_score between 0 and 100
      and data_confidence between 0 and 100
      and score_version > 0
    );
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'qualification_results_company_same_user_fk') then
    alter table qualification_results
      add constraint qualification_results_company_same_user_fk
      foreign key (company_id, user_id) references companies (id, user_id) on delete cascade;
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'qualification_results_campaign_same_user_fk') then
    alter table qualification_results
      add constraint qualification_results_campaign_same_user_fk
      foreign key (campaign_id, user_id) references campaigns (id, user_id) on delete set null;
  end if;
end $$;

create index if not exists qualification_results_user_idx on qualification_results (user_id);
create index if not exists qualification_results_company_idx
  on qualification_results (company_id, created_at desc);

-- 8. Leads da campanha (§21) --------------------------------------------------

create table if not exists campaign_leads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  campaign_id uuid not null,
  company_id uuid not null,
  contact_id uuid,
  stage pipeline_stage not null default 'DISCOVERED',
  qualification_id uuid,
  approved_at timestamptz,
  approved_by uuid references auth.users (id) on delete set null,
  rejected_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'campaign_leads_id_user_key') then
    alter table campaign_leads add constraint campaign_leads_id_user_key unique (id, user_id);
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'campaign_leads_campaign_same_user_fk') then
    alter table campaign_leads
      add constraint campaign_leads_campaign_same_user_fk
      foreign key (campaign_id, user_id) references campaigns (id, user_id) on delete cascade;
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'campaign_leads_company_same_user_fk') then
    alter table campaign_leads
      add constraint campaign_leads_company_same_user_fk
      foreign key (company_id, user_id) references companies (id, user_id) on delete cascade;
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'campaign_leads_contact_same_user_fk') then
    alter table campaign_leads
      add constraint campaign_leads_contact_same_user_fk
      foreign key (contact_id, user_id) references contacts (id, user_id) on delete set null;
  end if;
end $$;

-- Uma empresa aparece uma unica vez por campanha.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'campaign_leads_campaign_company_key') then
    alter table campaign_leads
      add constraint campaign_leads_campaign_company_key unique (campaign_id, company_id);
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'campaign_leads_qualification_same_user_fk') then
    alter table campaign_leads
      add constraint campaign_leads_qualification_same_user_fk
      foreign key (qualification_id, user_id) references qualification_results (id, user_id) on delete set null;
  end if;
end $$;

create index if not exists campaign_leads_user_idx on campaign_leads (user_id);
create index if not exists campaign_leads_stage_idx on campaign_leads (campaign_id, stage);

drop trigger if exists campaign_leads_set_updated_at on campaign_leads;
create trigger campaign_leads_set_updated_at
  before update on campaign_leads
  for each row execute function set_updated_at();

-- 9. Remetentes, templates e sequencias (§17.2/§18) ---------------------------

create table if not exists email_senders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  address text not null,
  reply_to text,
  domain text not null,
  provider text not null,
  spf_status sender_auth_status not null default 'UNKNOWN',
  dkim_status sender_auth_status not null default 'UNKNOWN',
  dmarc_status sender_auth_status not null default 'UNKNOWN',
  daily_limit integer not null default 25,
  sent_today integer not null default 0,
  reputation_status text,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'email_senders_id_user_key') then
    alter table email_senders add constraint email_senders_id_user_key unique (id, user_id);
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'email_senders_user_address_key') then
    alter table email_senders add constraint email_senders_user_address_key unique (user_id, address);
  end if;
end $$;

drop trigger if exists email_senders_set_updated_at on email_senders;
create trigger email_senders_set_updated_at
  before update on email_senders
  for each row execute function set_updated_at();

create table if not exists email_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  subject_template text not null,
  body_text_template text not null,
  body_html_template text,
  gap_types text[],
  offer_types text[],
  required_variables text[] not null default '{}',
  status template_status not null default 'DRAFT',
  version integer not null default 1,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'email_templates_id_user_key') then
    alter table email_templates add constraint email_templates_id_user_key unique (id, user_id);
  end if;
end $$;

create index if not exists email_templates_user_idx on email_templates (user_id);

drop trigger if exists email_templates_set_updated_at on email_templates;
create trigger email_templates_set_updated_at
  before update on email_templates
  for each row execute function set_updated_at();

create table if not exists sequences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'sequences_id_user_key') then
    alter table sequences add constraint sequences_id_user_key unique (id, user_id);
  end if;
end $$;

drop trigger if exists sequences_set_updated_at on sequences;
create trigger sequences_set_updated_at
  before update on sequences
  for each row execute function set_updated_at();

create table if not exists sequence_steps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  sequence_id uuid not null,
  step_number smallint not null,
  delay_days integer not null default 0,
  template_id uuid,
  -- Variante do teste A/B (§18.4). NULL = passo sem variante.
  variant text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'sequence_steps_id_user_key') then
    alter table sequence_steps add constraint sequence_steps_id_user_key unique (id, user_id);
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'sequence_steps_sequence_same_user_fk') then
    alter table sequence_steps
      add constraint sequence_steps_sequence_same_user_fk
      foreign key (sequence_id, user_id) references sequences (id, user_id) on delete cascade;
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'sequence_steps_template_same_user_fk') then
    alter table sequence_steps
      add constraint sequence_steps_template_same_user_fk
      foreign key (template_id, user_id) references email_templates (id, user_id) on delete set null;
  end if;
end $$;

-- "No maximo tres mensagens por sequencia" na primeira versao (§18.2).
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'sequence_steps_max_three') then
    alter table sequence_steps add constraint sequence_steps_max_three
      check (step_number between 1 and 3);
  end if;
end $$;

create unique index if not exists sequence_steps_order_key
  on sequence_steps (sequence_id, step_number, (coalesce(variant, '')));

drop trigger if exists sequence_steps_set_updated_at on sequence_steps;
create trigger sequence_steps_set_updated_at
  before update on sequence_steps
  for each row execute function set_updated_at();

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'campaigns_sequence_same_user_fk') then
    alter table campaigns
      add constraint campaigns_sequence_same_user_fk
      foreign key (sequence_id, user_id) references sequences (id, user_id) on delete set null;
  end if;
end $$;

-- 10. Mensagens e eventos (§17/§19) -------------------------------------------

create table if not exists outbound_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  campaign_lead_id uuid not null,
  sequence_step_id uuid,
  contact_id uuid,
  sender_id uuid,
  template_id uuid,
  template_version integer,
  -- Conteudo exatamente como saiu. Imutavel por politica (§25.4): o historico precisa
  -- preservar o que a pessoa recebeu, nao o template de hoje.
  subject text not null,
  body_text text not null,
  body_html text,
  to_email text not null,
  status message_status not null default 'SCHEDULED',
  -- campaign_lead_id + sequence_step_id + contact_id (§17.4). A unique abaixo e o que
  -- transforma um retry em conflito, em vez de num segundo e-mail na caixa da pessoa.
  idempotency_key text not null,
  provider_message_id text,
  scheduled_for timestamptz,
  sent_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'outbound_messages_id_user_key') then
    alter table outbound_messages
      add constraint outbound_messages_id_user_key unique (id, user_id);
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'outbound_messages_idempotency_key') then
    alter table outbound_messages
      add constraint outbound_messages_idempotency_key unique (user_id, idempotency_key);
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'outbound_messages_lead_same_user_fk') then
    alter table outbound_messages
      add constraint outbound_messages_lead_same_user_fk
      foreign key (campaign_lead_id, user_id) references campaign_leads (id, user_id) on delete cascade;
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'outbound_messages_contact_same_user_fk') then
    alter table outbound_messages
      add constraint outbound_messages_contact_same_user_fk
      foreign key (contact_id, user_id) references contacts (id, user_id) on delete set null;
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'outbound_messages_sender_same_user_fk') then
    alter table outbound_messages
      add constraint outbound_messages_sender_same_user_fk
      foreign key (sender_id, user_id) references email_senders (id, user_id) on delete set null;
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'outbound_messages_step_same_user_fk') then
    alter table outbound_messages
      add constraint outbound_messages_step_same_user_fk
      foreign key (sequence_step_id, user_id) references sequence_steps (id, user_id) on delete set null;
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'outbound_messages_template_same_user_fk') then
    alter table outbound_messages
      add constraint outbound_messages_template_same_user_fk
      foreign key (template_id, user_id) references email_templates (id, user_id) on delete set null;
  end if;
end $$;

create index if not exists outbound_messages_user_idx on outbound_messages (user_id);
create index if not exists outbound_messages_status_idx on outbound_messages (status, scheduled_for);

drop trigger if exists outbound_messages_set_updated_at on outbound_messages;
create trigger outbound_messages_set_updated_at
  before update on outbound_messages
  for each row execute function set_updated_at();

create table if not exists message_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  message_id uuid not null,
  type email_event_type not null,
  provider text,
  provider_event_id text,
  -- Chave de deduplicacao do webhook (§26.5): o mesmo evento reentregue conflita.
  event_key text not null,
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'message_events_key_unique') then
    alter table message_events add constraint message_events_key_unique unique (user_id, event_key);
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'message_events_message_same_user_fk') then
    alter table message_events
      add constraint message_events_message_same_user_fk
      foreign key (message_id, user_id) references outbound_messages (id, user_id) on delete cascade;
  end if;
end $$;

create index if not exists message_events_user_idx on message_events (user_id);
create index if not exists message_events_message_idx on message_events (message_id, occurred_at);

create table if not exists inbound_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  campaign_lead_id uuid,
  contact_id uuid,
  outbound_message_id uuid,
  from_email text not null,
  subject text,
  body_text text,
  headers jsonb not null default '{}'::jsonb,
  classification reply_classification not null default 'UNKNOWN',
  classification_signals jsonb not null default '[]'::jsonb,
  -- Classificacao sugerida pelo sistema so vira verdade depois da revisao (§20.4).
  reviewed_at timestamptz,
  provider_message_id text,
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'inbound_messages_provider_key') then
    alter table inbound_messages
      add constraint inbound_messages_provider_key unique (user_id, provider_message_id);
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'inbound_messages_lead_same_user_fk') then
    alter table inbound_messages
      add constraint inbound_messages_lead_same_user_fk
      foreign key (campaign_lead_id, user_id) references campaign_leads (id, user_id) on delete set null;
  end if;
end $$;

create index if not exists inbound_messages_user_idx on inbound_messages (user_id, received_at desc);

-- 11. Supressao (§29.2) -------------------------------------------------------
-- "Supressao sempre prevalece sobre campanhas e automacoes." Nao ha coluna para
-- desativar uma entrada: remover uma supressao e deletar a linha, um ato explicito
-- e auditavel (§29.4), nunca uma flag que alguem esquece ligada.

create table if not exists suppression_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  scope suppression_scope not null,
  value text not null,
  reason suppression_reason not null,
  origin text,
  created_at timestamptz not null default now()
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'suppression_entries_key') then
    alter table suppression_entries
      add constraint suppression_entries_key unique (user_id, scope, value);
  end if;
end $$;

create index if not exists suppression_entries_user_idx on suppression_entries (user_id, scope);

-- 12. Oportunidades e tarefas (§21.3/§21.4) -----------------------------------

create table if not exists sales_opportunities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  company_id uuid not null,
  contact_id uuid,
  campaign_id uuid,
  owner_id uuid references auth.users (id) on delete set null,
  status pipeline_stage not null default 'POSITIVE_REPLY',
  offer_type text,
  estimated_value_cents integer,
  proposed_value_cents integer,
  won_value_cents integer,
  probability smallint,
  next_action text,
  next_action_at timestamptz,
  loss_reason text,
  won_at timestamptz,
  lost_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'sales_opportunities_id_user_key') then
    alter table sales_opportunities
      add constraint sales_opportunities_id_user_key unique (id, user_id);
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'sales_opportunities_probability_range') then
    alter table sales_opportunities add constraint sales_opportunities_probability_range
      check (probability is null or probability between 0 and 100);
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'sales_opportunities_company_same_user_fk') then
    alter table sales_opportunities
      add constraint sales_opportunities_company_same_user_fk
      foreign key (company_id, user_id) references companies (id, user_id) on delete cascade;
  end if;
end $$;

create index if not exists sales_opportunities_user_idx on sales_opportunities (user_id, status);

drop trigger if exists sales_opportunities_set_updated_at on sales_opportunities;
create trigger sales_opportunities_set_updated_at
  before update on sales_opportunities
  for each row execute function set_updated_at();

create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  type task_type not null,
  status task_status not null default 'OPEN',
  title text not null,
  description text,
  company_id uuid,
  campaign_lead_id uuid,
  contact_id uuid,
  opportunity_id uuid,
  due_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'tasks_company_same_user_fk') then
    alter table tasks
      add constraint tasks_company_same_user_fk
      foreign key (company_id, user_id) references companies (id, user_id) on delete cascade;
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'tasks_lead_same_user_fk') then
    alter table tasks
      add constraint tasks_lead_same_user_fk
      foreign key (campaign_lead_id, user_id) references campaign_leads (id, user_id) on delete cascade;
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'tasks_contact_same_user_fk') then
    alter table tasks
      add constraint tasks_contact_same_user_fk
      foreign key (contact_id, user_id) references contacts (id, user_id) on delete set null;
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'tasks_opportunity_same_user_fk') then
    alter table tasks
      add constraint tasks_opportunity_same_user_fk
      foreign key (opportunity_id, user_id) references sales_opportunities (id, user_id) on delete cascade;
  end if;
end $$;

create index if not exists tasks_user_open_idx on tasks (user_id, status, due_at);

drop trigger if exists tasks_set_updated_at on tasks;
create trigger tasks_set_updated_at
  before update on tasks
  for each row execute function set_updated_at();

-- 13. Jobs (§24) --------------------------------------------------------------

create table if not exists jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  campaign_id uuid,
  type job_type not null,
  status job_status not null default 'PENDING',
  priority smallint not null default 0,
  payload jsonb not null default '{}'::jsonb,
  attempts integer not null default 0,
  max_attempts integer not null default 3,
  scheduled_for timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  locked_by text,
  -- Lock com expiracao (§24.4): um worker morto em serverless libera o job sozinho.
  locked_until timestamptz,
  error text,
  progress smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'jobs_progress_range') then
    alter table jobs add constraint jobs_progress_range
      check (progress between 0 and 100 and attempts >= 0 and max_attempts > 0);
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'jobs_id_user_key') then
    alter table jobs add constraint jobs_id_user_key unique (id, user_id);
  end if;
end $$;

create index if not exists jobs_claim_idx on jobs (status, scheduled_for, priority desc);
create index if not exists jobs_user_idx on jobs (user_id, status);

drop trigger if exists jobs_set_updated_at on jobs;
create trigger jobs_set_updated_at
  before update on jobs
  for each row execute function set_updated_at();

create table if not exists job_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  job_id uuid not null,
  type text not null,
  message text,
  data jsonb,
  created_at timestamptz not null default now()
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'job_events_job_same_user_fk') then
    alter table job_events
      add constraint job_events_job_same_user_fk
      foreign key (job_id, user_id) references jobs (id, user_id) on delete cascade;
  end if;
end $$;

create index if not exists job_events_job_idx on job_events (job_id, created_at);

-- 14. Auditoria (§29.4) -------------------------------------------------------
-- Append-only: quem aprovou, quando, qual mensagem, qual template, qual evidencia.
-- Nao tem updated_at nem trigger de update de proposito — um log que pode ser
-- editado nao e um log.

create table if not exists audit_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  actor_id uuid references auth.users (id) on delete set null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_log_user_idx on audit_log (user_id, created_at desc);
create index if not exists audit_log_entity_idx on audit_log (entity_type, entity_id);

-- 15. RLS ---------------------------------------------------------------------
-- Mesmo padrao das tabelas da 1.2: isolamento por user_id, sem excecao para
-- nenhuma tabela nova (SPEC 2.0 §25.3).

do $$
declare
  t text;
  tables text[] := array[
    'campaigns', 'campaign_sources', 'contacts', 'company_observations',
    'company_field_evidence', 'company_gaps', 'offer_catalog', 'qualification_results',
    'campaign_leads', 'email_senders', 'email_templates', 'sequences', 'sequence_steps',
    'outbound_messages', 'message_events', 'inbound_messages', 'suppression_entries',
    'sales_opportunities', 'tasks', 'jobs', 'job_events', 'audit_log'
  ];
begin
  foreach t in array tables
  loop
    execute format('alter table %I enable row level security', t);

    execute format('drop policy if exists %I on %I', t || '_select_own', t);
    execute format('drop policy if exists %I on %I', t || '_insert_own', t);
    execute format('drop policy if exists %I on %I', t || '_update_own', t);
    execute format('drop policy if exists %I on %I', t || '_delete_own', t);

    execute format(
      'create policy %I on %I for select to authenticated using (user_id = (select auth.uid()))',
      t || '_select_own', t);
    execute format(
      'create policy %I on %I for insert to authenticated with check (user_id = (select auth.uid()))',
      t || '_insert_own', t);
    execute format(
      'create policy %I on %I for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))',
      t || '_update_own', t);
    execute format(
      'create policy %I on %I for delete to authenticated using (user_id = (select auth.uid()))',
      t || '_delete_own', t);
  end loop;
end $$;

-- message_events e audit_log nao recebem policy de UPDATE nem de DELETE: eventos de
-- entrega e registro de auditoria sao imutaveis (§25.4). Eles sao criados uma vez e
-- lidos para sempre — corrigir um evento de bounce reescrevendo a linha apagaria a
-- propria evidencia que justifica a supressao.
do $$
declare
  t text;
begin
  foreach t in array array['message_events', 'audit_log']
  loop
    execute format('drop policy if exists %I on %I', t || '_update_own', t);
    execute format('drop policy if exists %I on %I', t || '_delete_own', t);
  end loop;
end $$;

-- 16. Migracao do score atual (§36.2) -----------------------------------------
-- O score da 1.x vira historico com score_version = 1, sem reinterpretacao: os
-- subscores da 2.0 nao existiam quando ele foi calculado, entao ficam em 0 em vez
-- de receber um valor inventado retroativamente (§36.3: "nenhuma migracao inventa
-- gap"). O nivel antigo (BAIXA/MEDIA/ALTA/EXCELENTE) e preservado como texto, tal
-- como foi gravado — traduzi-lo para LOW/MEDIUM/HIGH/EXCELLENT daria a impressao
-- falsa de que as faixas sao as mesmas, e elas nao sao (1.x usa 40 para MEDIA, a
-- 2.0 usa 50).
--
-- Idempotente: so insere para empresas que ainda nao tem linha de versao 1.

insert into qualification_results (
  user_id, company_id, score_version, opportunity_score, opportunity_level,
  recommended_action, reasons, created_at
)
select
  c.user_id,
  c.id,
  1,
  least(greatest(c.opportunity_score, 0), 100),
  c.opportunity_level::text,
  c.next_action::text,
  coalesce(c.score_breakdown, '[]'::jsonb),
  coalesce(c.last_checked_at, c.created_at)
from companies c
where not exists (
  select 1 from qualification_results q
  where q.company_id = c.id and q.score_version = 1
);

-- Contatos a partir do email ja capturado em companies (0006). Sem inventar nome,
-- cargo ou decisor: so o endereco que a fonte de fato entregou, com verificacao
-- ainda UNKNOWN — coletar nao e verificar (§3.1).
insert into contacts (
  user_id, company_id, email, email_normalized, phone, source, confidence,
  email_verification_status, is_primary
)
select
  c.user_id,
  c.id,
  c.email,
  lower(trim(c.email)),
  c.phone,
  'LEGACY',
  'LOW',
  'UNKNOWN',
  true
from companies c
where c.email is not null
  and trim(c.email) <> ''
  and not exists (
    select 1 from contacts ct
    where ct.company_id = c.id and ct.email_normalized = lower(trim(c.email))
  );
