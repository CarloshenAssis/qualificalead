-- ---------------------------------------------------------------------------
-- LeadHunter — SPEC 1.2 FASE 6 (identidade neutra multi-source)
-- Resolve definitivamente: identidade por fonte, dedup cross-source, cache
-- persistente de descoberta, proveniencia, compatibilidade com leads existentes
-- e RLS multi-tenant nas tabelas novas.
-- Execute depois de 0003_google_business_quality.sql.
--
-- Nao remove nem renomeia nada em `companies`. `google_place_id` e `dedup_key`
-- continuam existindo por compatibilidade com a 1.1 — deixam de ser a
-- identidade arquitetural principal, que passa a ser `lead_sources`.
-- ---------------------------------------------------------------------------

-- 1. Enums --------------------------------------------------------------------

do $$ begin
  create type lead_source_type as enum ('OPENSTREETMAP', 'GOOGLE_PLACES', 'FOURSQUARE', 'LEGACY');
exception when duplicate_object then null; end $$;

-- Completude do registro trazido por uma fonte (SPEC 1.2 §14) — nao e score comercial.
do $$ begin
  create type source_quality_level as enum ('LOW', 'MEDIUM', 'HIGH');
exception when duplicate_object then null; end $$;

-- HIGH nao existe aqui de proposito: confianca alta funde automaticamente (vira duas
-- linhas em lead_sources para o mesmo company_id) em vez de virar candidato a revisao.
do $$ begin
  create type duplicate_confidence_level as enum ('LOW', 'MEDIUM');
exception when duplicate_object then null; end $$;

-- 2. lead_sources — identidade neutra por fonte -------------------------------
-- Uma linha por (empresa, fonte, id externo). Uma empresa encontrada em duas fontes
-- tem duas linhas com o mesmo company_id, nunca dois registros de companies.

create table if not exists lead_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  company_id uuid not null,
  source lead_source_type not null,
  -- Id do registro dentro da fonte (place_id do Google, "node/123" do OSM). NULL para
  -- LEGACY sem origem conhecida: nunca usamos um id interno (ex.: company_id) como se
  -- fosse um identificador externo da fonte — se nao ha id externo real, o campo fica
  -- vazio de verdade, nao um substituto sintetico disfarcado de dado externo.
  source_id text,
  source_url text,
  source_quality source_quality_level,
  raw_data jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Um registro externo (source + source_id) pertence a exatamente uma empresa por
-- usuario: impede o mesmo place_id/node do OSM de ficar atribuido a duas empresas.
-- Como consequencia, tambem impede a duplicata literal que a SPEC pede bloquear
-- ("mesmo lead + mesma fonte + mesmo source_id") e permite livremente
-- "lead A + OSM + id X" e "lead A + Google + id Y" (tuplas diferentes).
-- source_id NULL (LEGACY sem origem conhecida) nao e coberto por esta constraint: o
-- padrao SQL trata cada NULL como distinto dos demais, entao duas linhas LEGACY do
-- mesmo usuario nunca conflitam entre si aqui — o que e correto, ja que elas
-- genuinamente nao tem um id externo comparavel. O backfill (secao 5) usa sua propria
-- checagem de idempotencia para esse caso, via NOT EXISTS com IS NOT DISTINCT FROM.
-- ADD CONSTRAINT para UNIQUE cria um indice com o mesmo nome: numa segunda execucao o
-- erro e "relation already exists" (42P07), nao duplicate_object (42710) — checar o
-- catalogo antes evita depender de qual excecao cada tipo de constraint dispara.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'lead_sources_user_source_key') then
    alter table lead_sources
      add constraint lead_sources_user_source_key unique (user_id, source, source_id);
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'lead_sources_company_same_user_fk') then
    alter table lead_sources
      add constraint lead_sources_company_same_user_fk
      foreign key (company_id, user_id) references companies (id, user_id) on delete cascade;
  end if;
end $$;

-- Fecha a lacuna que a unique acima deixa aberta: com source_id NULL, nada impede hoje
-- duas linhas LEGACY para a mesma empresa (NULL nunca conflita com NULL). O backfill e
-- idempotente por causa do NOT EXISTS na secao 5, mas isso so protege ESTE script — nao
-- impede um bug futuro em outro caminho de codigo de inserir uma segunda linha LEGACY
-- para a mesma empresa. Esta e a proteção estrutural, no banco: LEGACY vira, na pratica,
-- "no maximo um registro por empresa", exatamente como Google/OSM/Foursquare sao
-- "no maximo um registro por empresa e por source_id".
create unique index if not exists lead_sources_one_legacy_per_company
  on lead_sources (user_id, company_id)
  where source = 'LEGACY';

create index if not exists lead_sources_user_idx on lead_sources (user_id);
create index if not exists lead_sources_company_idx on lead_sources (company_id);

drop trigger if exists lead_sources_set_updated_at on lead_sources;
create trigger lead_sources_set_updated_at
  before update on lead_sources
  for each row execute function set_updated_at();

-- 3. lead_duplicate_candidates — evidencia preservada, nunca merge automatico -
-- So guarda casos MEDIUM/LOW (nome+endereco ou geo+nome parecido): telefone e site
-- batendo (HIGH) fundem direto via lead_sources, sem passar por aqui. Nunca apaga
-- nem funde dado algum — so registra a suspeita para revisao futura.

create table if not exists lead_duplicate_candidates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  company_id uuid not null,
  candidate_company_id uuid not null,
  confidence duplicate_confidence_level not null,
  signals jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'duplicate_candidates_not_self') then
    alter table lead_duplicate_candidates
      add constraint duplicate_candidates_not_self check (company_id <> candidate_company_id);
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'duplicate_candidates_pair_key') then
    alter table lead_duplicate_candidates
      add constraint duplicate_candidates_pair_key unique (company_id, candidate_company_id);
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'duplicate_candidates_company_same_user_fk') then
    alter table lead_duplicate_candidates
      add constraint duplicate_candidates_company_same_user_fk
      foreign key (company_id, user_id) references companies (id, user_id) on delete cascade;
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'duplicate_candidates_candidate_same_user_fk') then
    alter table lead_duplicate_candidates
      add constraint duplicate_candidates_candidate_same_user_fk
      foreign key (candidate_company_id, user_id) references companies (id, user_id) on delete cascade;
  end if;
end $$;

create index if not exists duplicate_candidates_user_idx on lead_duplicate_candidates (user_id);

-- 4. discovery_cache — cache persistente de busca (SPEC 1.2 §25/§43) ---------
-- Precisa ser persistente: a Vercel nao mantem memoria entre invocacoes, entao um
-- cache em memoria seria, na pratica, sempre vazio (SPEC 1.2 proibe usar so isso).
-- Por usuario, seguindo o mesmo isolamento de tenant de toda tabela nova — dado
-- publico da fonte nao justifica abrir excecao no RLS.

create table if not exists discovery_cache (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  source lead_source_type not null,
  -- Hash materializado de {source, query, city, state, country, latitude, longitude,
  -- radius, limit} — a chave logica completa (SPEC 1.2 §25), sem guardar um valor por
  -- parametro.
  cache_key text not null,
  params jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'discovery_cache_user_key') then
    alter table discovery_cache
      add constraint discovery_cache_user_key unique (user_id, cache_key);
  end if;
end $$;

create index if not exists discovery_cache_expires_idx on discovery_cache (expires_at);

drop trigger if exists discovery_cache_set_updated_at on discovery_cache;
create trigger discovery_cache_set_updated_at
  before update on discovery_cache
  for each row execute function set_updated_at();

-- 5. Backfill — leads existentes continuam funcionando ------------------------
-- Toda empresa ja salva ganha uma linha em lead_sources, sem inferir origem que nao
-- foi registrada:
--   - se source_data.source/source_id existir (leads criados desde a FASE 4, incluindo
--     OpenStreetMap), usa exatamente o que foi gravado;
--   - senao, se houver google_place_id (todo lead da 1.1), vira GOOGLE_PLACES
--     preservando o place_id original;
--   - senao, vira LEGACY com source_id NULL — nao ha id externo real para preservar,
--     a origem nao pode ser adivinhada, e um id interno (company_id) nunca deve se
--     passar por um identificador externo da fonte.
--
-- Idempotencia: NOT EXISTS com IS NOT DISTINCT FROM em vez de ON CONFLICT, porque
-- source_id pode ser NULL (LEGACY) e a constraint unique (secao 2) nao cobre esse caso
-- — dois NULLs nunca "conflitam" entre si no SQL padrao, entao ON CONFLICT DO NOTHING
-- sozinho inseriria uma linha LEGACY nova a cada execucao. Esta checagem compara
-- explicitamente a linha que SERIA inserida contra o que ja existe, tratando NULL
-- corretamente, e por isso e segura para rodar mais de uma vez.

with resolved as (
  select
    c.id as company_id,
    c.user_id,
    case
      when c.source_data ? 'source'
        and c.source_data ->> 'source' in ('OPENSTREETMAP', 'GOOGLE_PLACES', 'FOURSQUARE', 'LEGACY')
        then (c.source_data ->> 'source')::lead_source_type
      when c.google_place_id is not null then 'GOOGLE_PLACES'::lead_source_type
      else 'LEGACY'::lead_source_type
    end as source,
    nullif(coalesce(nullif(c.source_data ->> 'source_id', ''), c.google_place_id), '') as source_id,
    c.google_maps_url as source_url,
    coalesce(c.source_data, '{}'::jsonb) as raw_data,
    coalesce(c.created_at, now()) as first_seen_at,
    coalesce(c.last_checked_at, c.updated_at, c.created_at, now()) as last_seen_at
  from companies c
)
insert into lead_sources (
  user_id, company_id, source, source_id, source_url, source_quality, raw_data,
  first_seen_at, last_seen_at
)
select
  r.user_id, r.company_id, r.source, r.source_id, r.source_url,
  null::source_quality_level, r.raw_data, r.first_seen_at, r.last_seen_at
from resolved r
where not exists (
  select 1 from lead_sources ls
  where ls.company_id = r.company_id
    and ls.source = r.source
    and ls.source_id is not distinct from r.source_id
);

-- 6. Row Level Security ---------------------------------------------------------
-- Mesmo padrao de 0001/0002: cada usuario enxerga e altera apenas os proprios
-- registros. Dado publico de fonte (nome de empresa, endereco) nao justifica abrir
-- excecao — a tabela e privada por usuario como qualquer outra.

alter table lead_sources enable row level security;
alter table lead_duplicate_candidates enable row level security;
alter table discovery_cache enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['lead_sources', 'lead_duplicate_candidates', 'discovery_cache']
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
