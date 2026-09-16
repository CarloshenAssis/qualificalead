-- ---------------------------------------------------------------------------
-- Minimo do Supabase necessario para aplicar as migracoes num PostgreSQL local.
--
-- Existe para satisfazer o criterio da SPEC 2.0 §32.4 ("migracoes aplicam em banco
-- vazio e banco atualizado") sem depender de um projeto Supabase real. NAO faz
-- parte do schema da aplicacao e nunca deve ser executado em producao: o Supabase
-- ja fornece tudo isto.
-- ---------------------------------------------------------------------------

create extension if not exists pgcrypto;

create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  instance_id uuid,
  aud text,
  role text,
  encrypted_password text,
  email_confirmed_at timestamptz,
  updated_at timestamptz default now(),
  raw_app_meta_data jsonb default '{}'::jsonb,
  raw_user_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- No Supabase, auth.uid() le o id do usuario de request.jwt.claims. A versao local
-- le a mesma configuracao, para que as policies sejam exercitadas como em producao.
create or replace function auth.uid() returns uuid
language sql stable
as $$
  select nullif(
    coalesce(
      current_setting('request.jwt.claim.sub', true),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    ),
    ''
  )::uuid
$$;

do $$ begin
  create role authenticated;
exception when duplicate_object then null; end $$;

do $$ begin
  create role anon;
exception when duplicate_object then null; end $$;

grant usage on schema public to authenticated, anon;
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
