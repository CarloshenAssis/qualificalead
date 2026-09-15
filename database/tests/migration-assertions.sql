-- ---------------------------------------------------------------------------
-- Verificacoes estruturais depois de aplicar todas as migracoes.
-- Falha alto (raise exception) em vez de imprimir um relatorio: isto roda em CI.
-- ---------------------------------------------------------------------------

do $$
declare
  missing text;
  expected_tables text[] := array[
    -- 1.x, preservadas pela 2.0 (SPEC 2.0 §36.1).
    'profiles', 'companies', 'prospecting_searches', 'leads', 'interactions',
    'briefings', 'lead_sources', 'lead_duplicate_candidates', 'discovery_cache',
    -- 2.0 (§25.2).
    'campaigns', 'campaign_sources', 'campaign_leads', 'contacts',
    'company_field_evidence', 'company_observations', 'company_gaps', 'offer_catalog',
    'qualification_results', 'email_senders', 'email_templates', 'sequences',
    'sequence_steps', 'outbound_messages', 'inbound_messages', 'message_events',
    'suppression_entries', 'sales_opportunities', 'tasks', 'jobs', 'job_events',
    'audit_log'
  ];
begin
  select string_agg(t, ', ') into missing
  from unnest(expected_tables) t
  where not exists (
    select 1 from pg_tables where schemaname = 'public' and tablename = t
  );

  if missing is not null then
    raise exception 'Tabelas ausentes: %', missing;
  end if;

  -- RLS ligada em toda tabela de usuario (SPEC 2.0 §25.3).
  select string_agg(c.relname, ', ') into missing
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and c.relname = any (expected_tables)
    and not c.relrowsecurity;

  if missing is not null then
    raise exception 'Tabelas sem RLS: %', missing;
  end if;
end $$;

-- Imutabilidade: nem auditoria nem evento de entrega pode ser reescrito (§25.4).
do $$
declare
  offending text;
begin
  select string_agg(format('%s.%s', tablename, policyname), ', ') into offending
  from pg_policies
  where schemaname = 'public'
    and tablename in ('message_events', 'audit_log', 'qualification_results')
    and cmd in ('UPDATE', 'DELETE');

  if offending is not null then
    raise exception 'Policies de escrita em tabela imutavel: %', offending;
  end if;
end $$;

-- Optional tenant-safe FKs clear only their optional id (user_id must survive).
do $$
declare missing text;
begin
  select string_agg(expected.name, ', ') into missing
  from (values
    ('qualification_results_campaign_same_user_fk'), ('campaign_leads_contact_same_user_fk'),
    ('campaign_leads_qualification_same_user_fk'), ('sequence_steps_template_same_user_fk'),
    ('campaigns_sequence_same_user_fk'), ('outbound_messages_contact_same_user_fk'),
    ('outbound_messages_sender_same_user_fk'), ('outbound_messages_step_same_user_fk'),
    ('outbound_messages_template_same_user_fk'), ('inbound_messages_lead_same_user_fk'),
    ('tasks_contact_same_user_fk'), ('sales_opportunities_contact_same_user_fk'),
    ('sales_opportunities_campaign_same_user_fk'), ('inbound_messages_contact_same_user_fk'),
    ('inbound_messages_outbound_same_user_fk'), ('jobs_campaign_same_user_fk')
  ) expected(name)
  where not exists (
    select 1 from pg_constraint c
    where c.conname = expected.name and c.contype = 'f' and c.confdeltype = 'n'
      and c.confdelsetcols is not null and cardinality(c.confdelsetcols) = 1
  );
  if missing is not null then raise exception 'FKs SET NULL inseguras/ausentes: %', missing; end if;
end $$;

-- Database triggers, rather than application convention, enforce audit invariants.
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'qualification_results_append_only' and not tgisinternal) then
    raise exception 'trigger append-only de qualification_results ausente';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'outbound_messages_immutable_after_send' and not tgisinternal) then
    raise exception 'trigger de imutabilidade de outbound_messages ausente';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'qualification_results_require_evidence' and not tgisinternal) then
    raise exception 'trigger de evidencia READY_FOR_EMAIL ausente';
  end if;
end $$;

-- A migracao do score antigo roda uma vez so, por mais vezes que o script rode.
do $$
declare
  duplicated integer;
begin
  select count(*) into duplicated
  from (
    select company_id from qualification_results
    where score_version = 1
    group by company_id having count(*) > 1
  ) d;

  if duplicated > 0 then
    raise exception 'Backfill de score_version=1 nao e idempotente (% empresas duplicadas)', duplicated;
  end if;
end $$;

-- A unique de idempotencia precisa existir: e ela que impede um retry de virar um
-- segundo e-mail na caixa da pessoa (SPEC 2.0 §17.4).
do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'outbound_messages_idempotency_key'
  ) then
    raise exception 'Constraint de idempotencia de outbound_messages ausente';
  end if;
end $$;

-- Nenhum vestigio de WhatsApp no schema (SPEC 2.0 §33.5).
do $$
declare
  offending text;
begin
  select string_agg(format('%s.%s', table_name, column_name), ', ') into offending
  from information_schema.columns
  where table_schema = 'public'
    and (column_name ilike '%whatsapp%' and table_name <> 'companies');

  if offending is not null then
    raise exception 'Schema de WhatsApp encontrado: %', offending;
  end if;

  if exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname ilike '%whatsapp%'
  ) then
    raise exception 'Tipo de WhatsApp encontrado no schema';
  end if;
end $$;

select 'migracoes ok' as resultado;
