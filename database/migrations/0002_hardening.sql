-- ---------------------------------------------------------------------------
-- LeadHunter — SPEC 1.1 (hardening)
-- Proveniencia, estados adicionais, metricas de pesquisa, integridade no banco
-- e correcao dos avisos do database linter.
-- Execute depois de 0001_init.sql.
-- ---------------------------------------------------------------------------

-- 1. Estados adicionais -----------------------------------------------------

-- "Nao foi possivel verificar" (SPEC 1.1 §17).
alter type website_status add value if not exists 'UNKNOWN';

-- Follow-up entra no historico do CRM (SPEC 1.1 §43).
alter type interaction_type add value if not exists 'FOLLOW_UP';

do $$ begin
  create type google_business_quality as enum ('LOW', 'MEDIUM', 'HIGH');
exception when duplicate_object then null; end $$;

do $$ begin
  create type next_action as enum (
    'CONTACT_NOW', 'RESEARCH_MORE', 'LOW_PRIORITY', 'ALREADY_CONTACTED', 'DO_NOT_CONTACT'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type enrichment_status as enum ('OK', 'FAILED', 'SKIPPED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type search_status as enum ('COMPLETED', 'PARTIAL', 'FAILED');
exception when duplicate_object then null; end $$;

-- 2. Proveniencia e qualificacao em companies -------------------------------

alter table companies
  add column if not exists website_checked_at timestamptz,
  -- proveniencia do Instagram (SPEC 1.1 §16/§21)
  add column if not exists instagram_source text,
  add column if not exists instagram_evidence jsonb not null default '[]'::jsonb,
  add column if not exists instagram_checked_at timestamptz,
  -- dados derivados (SPEC 1.1 §30/§33)
  add column if not exists google_business_quality google_business_quality not null default 'LOW',
  add column if not exists next_action next_action not null default 'RESEARCH_MORE',
  add column if not exists next_action_reason text,
  -- resultado do enriquecimento, para reprocessar so o que falhou (SPEC 1.1 §87)
  add column if not exists enrichment_status enrichment_status not null default 'SKIPPED',
  add column if not exists enrichment_error text;

create index if not exists companies_user_next_action_idx on companies (user_id, next_action);
create index if not exists companies_user_enrichment_idx
  on companies (user_id, enrichment_status)
  where enrichment_status = 'FAILED';

-- 3. Metricas por pesquisa (SPEC 1.1 §46/§84/§85) ---------------------------

alter table prospecting_searches
  add column if not exists segment text,
  add column if not exists status search_status not null default 'COMPLETED',
  add column if not exists new_companies_count integer not null default 0,
  add column if not exists existing_companies_count integer not null default 0,
  add column if not exists high_opportunity_count integer not null default 0,
  add column if not exists excellent_opportunity_count integer not null default 0,
  add column if not exists without_website_count integer not null default 0,
  -- base para um futuro controle de creditos (SPEC 1.1 §83)
  add column if not exists places_requested integer not null default 0,
  add column if not exists places_processed integer not null default 0,
  add column if not exists enrichment_count integer not null default 0,
  add column if not exists enrichment_failed_count integer not null default 0;

-- 4. Integridade reforcada pelo banco (SPEC 1.1 §89) ------------------------
-- Sem isso, um bug na aplicacao poderia ligar o lead de um usuario a empresa
-- de outro. As FKs compostas tornam esse estado impossivel.

create unique index if not exists companies_id_user_key on companies (id, user_id);
create unique index if not exists leads_id_user_key on leads (id, user_id);

do $$ begin
  alter table leads
    add constraint leads_company_same_user_fk
    foreign key (company_id, user_id) references companies (id, user_id) on delete cascade;
exception when duplicate_object then null; end $$;

do $$ begin
  alter table briefings
    add constraint briefings_company_same_user_fk
    foreign key (company_id, user_id) references companies (id, user_id) on delete cascade;
exception when duplicate_object then null; end $$;

do $$ begin
  alter table interactions
    add constraint interactions_lead_same_user_fk
    foreign key (lead_id, user_id) references leads (id, user_id) on delete cascade;
exception when duplicate_object then null; end $$;

do $$ begin
  alter table company_search_hits
    add constraint hits_company_same_user_fk
    foreign key (company_id, user_id) references companies (id, user_id) on delete cascade;
exception when duplicate_object then null; end $$;

-- As FKs de coluna unica ficam redundantes: a composta ja garante a existencia
-- do registro pai. Mante-las criaria dois caminhos entre as mesmas tabelas e o
-- PostgREST recusaria o embed `companies -> leads` como ambiguo (PGRST201).
alter table leads drop constraint if exists leads_company_id_fkey;
alter table briefings drop constraint if exists briefings_company_id_fkey;
alter table interactions drop constraint if exists interactions_lead_id_fkey;
alter table company_search_hits drop constraint if exists company_search_hits_company_id_fkey;

-- 5. Correcao dos avisos do database linter ---------------------------------

-- search_path fixo evita sequestro da funcao por schema malicioso.
create or replace function set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- handle_new_user e SECURITY DEFINER e so deve rodar pelo trigger do auth,
-- nunca ser chamada via /rest/v1/rpc por anon ou authenticated.
revoke all on function handle_new_user() from public, anon, authenticated;
