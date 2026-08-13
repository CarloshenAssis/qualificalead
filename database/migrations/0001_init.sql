-- ---------------------------------------------------------------------------
-- LeadHunter — schema inicial (SPEC 17, 18, 33)
-- Multi-tenant desde o inicio: toda tabela carrega user_id e RLS obrigatoria.
-- Execute no SQL Editor do Supabase.
-- ---------------------------------------------------------------------------

create extension if not exists "pgcrypto";

-- Enums ---------------------------------------------------------------------

do $$ begin
  create type website_status as enum ('HAS_WEBSITE', 'NO_WEBSITE_DETECTED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type instagram_status as enum ('NOT_FOUND', 'PENDING', 'CONFIRMED', 'REJECTED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type opportunity_level as enum ('BAIXA', 'MEDIA', 'ALTA', 'EXCELENTE');
exception when duplicate_object then null; end $$;

do $$ begin
  create type lead_status as enum (
    'NOVO', 'QUALIFICADO', 'CONTATADO', 'RESPONDEU', 'INTERESSADO',
    'PROPOSTA', 'VENDIDO', 'SEM_INTERESSE', 'DESCARTADO'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type lead_priority as enum ('BAIXA', 'MEDIA', 'ALTA');
exception when duplicate_object then null; end $$;

do $$ begin
  create type interaction_type as enum (
    'WHATSAPP', 'LIGACAO', 'EMAIL', 'REUNIAO', 'NOTA', 'MUDANCA_STATUS'
  );
exception when duplicate_object then null; end $$;

-- updated_at ----------------------------------------------------------------

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- profiles ------------------------------------------------------------------

create table if not exists profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists profiles_set_updated_at on profiles;
create trigger profiles_set_updated_at
  before update on profiles
  for each row execute function set_updated_at();

-- Cria o profile automaticamente quando um usuario se cadastra.
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id, name)
  values (new.id, nullif(new.raw_user_meta_data ->> 'name', ''))
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- companies -----------------------------------------------------------------

create table if not exists companies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  google_place_id text,
  name text not null,
  category text,
  categories text[],
  description text,
  phone text,
  phone_international text,
  whatsapp text,
  website text,
  website_status website_status not null default 'NO_WEBSITE_DETECTED',
  google_maps_url text,
  address text,
  city text,
  state text,
  country text,
  latitude double precision,
  longitude double precision,
  rating numeric(2, 1),
  review_count integer,
  opening_hours text[],
  business_status text,
  instagram_url text,
  instagram_handle text,
  instagram_confidence integer check (instagram_confidence between 0 and 100),
  instagram_status instagram_status not null default 'NOT_FOUND',
  opportunity_score integer not null default 0 check (opportunity_score between 0 and 100),
  opportunity_level opportunity_level not null default 'BAIXA',
  score_breakdown jsonb not null default '[]'::jsonb,
  source_data jsonb,
  -- chave de fallback quando nao ha place_id confiavel (SPEC 18)
  dedup_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_checked_at timestamptz
);

-- Deduplicacao por usuario (SPEC 18).
-- NULLs sao distintos em indices unicos, entao empresas cadastradas sem place_id
-- nao conflitam entre si e o ON CONFLICT continua inferivel pelo PostgREST.
create unique index if not exists companies_user_place_id_key
  on companies (user_id, google_place_id);

create unique index if not exists companies_user_dedup_key
  on companies (user_id, dedup_key)
  where google_place_id is null and dedup_key is not null;

create index if not exists companies_user_score_idx on companies (user_id, opportunity_score desc);
create index if not exists companies_user_city_idx on companies (user_id, city);

drop trigger if exists companies_set_updated_at on companies;
create trigger companies_set_updated_at
  before update on companies
  for each row execute function set_updated_at();

-- prospecting_searches ------------------------------------------------------

create table if not exists prospecting_searches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  query text not null,
  city text,
  state text,
  country text,
  radius integer,
  filters jsonb,
  results_count integer not null default 0,
  qualified_count integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists prospecting_searches_user_idx
  on prospecting_searches (user_id, created_at desc);

-- Historico: em qual pesquisa cada empresa apareceu (SPEC 19).
create table if not exists company_search_hits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  company_id uuid not null references companies (id) on delete cascade,
  search_id uuid not null references prospecting_searches (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (company_id, search_id)
);

create index if not exists company_search_hits_company_idx on company_search_hits (company_id);

-- leads ---------------------------------------------------------------------

create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  company_id uuid not null references companies (id) on delete cascade,
  status lead_status not null default 'NOVO',
  priority lead_priority not null default 'MEDIA',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_contacted_at timestamptz,
  next_follow_up_at timestamptz,
  unique (user_id, company_id)
);

create index if not exists leads_user_status_idx on leads (user_id, status);

drop trigger if exists leads_set_updated_at on leads;
create trigger leads_set_updated_at
  before update on leads
  for each row execute function set_updated_at();

-- interactions --------------------------------------------------------------

create table if not exists interactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  lead_id uuid not null references leads (id) on delete cascade,
  type interaction_type not null,
  description text,
  created_at timestamptz not null default now()
);

create index if not exists interactions_lead_idx on interactions (lead_id, created_at desc);

-- briefings -----------------------------------------------------------------

create table if not exists briefings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  company_id uuid not null references companies (id) on delete cascade,
  manual_data jsonb not null default '{}'::jsonb,
  generated_briefing text,
  generated_lovable_prompt text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, company_id)
);

drop trigger if exists briefings_set_updated_at on briefings;
create trigger briefings_set_updated_at
  before update on briefings
  for each row execute function set_updated_at();

-- Row Level Security --------------------------------------------------------
-- Regra unica: cada usuario enxerga e altera apenas os proprios registros.

alter table profiles enable row level security;
alter table companies enable row level security;
alter table prospecting_searches enable row level security;
alter table company_search_hits enable row level security;
alter table leads enable row level security;
alter table interactions enable row level security;
alter table briefings enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'companies', 'prospecting_searches', 'company_search_hits',
    'leads', 'interactions', 'briefings'
  ]
  loop
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
