-- ---------------------------------------------------------------------------
-- Idempotencia e efeitos das RPCs operacionais (SPEC 2.0, migration 0011).
--
-- Nenhum teste existente chamava receive_apify_webhook, receive_resend_webhook
-- ou start_apify_collection diretamente. Este arquivo fecha essa lacuna:
-- reentrega de webhook nao pode duplicar job/efeito, o guardrail de orcamento
-- em USD tem que bloquear antes de gastar, e o guardrail de estado da
-- campanha tem que impedir uma segunda coleta sobre a mesma campanha.
--
-- Tambem verifica que o unico chamador real destas duas RPCs de webhook --
-- o service_role usado pelas rotas app/api/webhooks/* via createAdminClient()
-- -- de fato tem EXECUTE sobre elas. `revoke all ... from public` sem o grant
-- correspondente deixaria as rotas de webhook retornando "permission denied"
-- em producao mesmo com a migration aplicada com sucesso.
-- ---------------------------------------------------------------------------

begin;

insert into auth.users(id, email) values
  ('55555555-5555-5555-5555-555555555555', 'rpc-a@test.invalid')
on conflict do nothing;

-- --- Privilegio: o unico chamador real (service_role) precisa conseguir executar ---
do $$
begin
  if not has_function_privilege(
    'service_role', 'receive_apify_webhook(text,text,text,text,jsonb)', 'EXECUTE'
  ) then
    raise exception 'service_role sem EXECUTE em receive_apify_webhook — a rota de webhook falharia em producao';
  end if;
  if not has_function_privilege(
    'service_role', 'receive_resend_webhook(text,text,email_event_type,timestamptz,text,jsonb)', 'EXECUTE'
  ) then
    raise exception 'service_role sem EXECUTE em receive_resend_webhook — a rota de webhook falharia em producao';
  end if;
end $$;

do $$
declare
  user_a uuid := '55555555-5555-5555-5555-555555555555';
  campaign_over_budget uuid;
  campaign_ok uuid;
  source_id uuid;
  second_source_id uuid;
  job_count integer;
  audit_count integer;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', user_a, 'role', 'authenticated')::text, true);

  -- --- start_apify_collection: guardrail de orcamento em USD (§8.5) ---
  insert into campaigns(user_id, name, status, apify_budget_minor)
    values(user_a, 'RPC budget campaign', 'READY', 1000) returning id into campaign_over_budget;

  begin
    perform start_apify_collection(campaign_over_budget, 'run-over-budget', null, '{}'::jsonb, 2000);
    raise exception 'start_apify_collection deveria rejeitar valor acima do orcamento';
  exception when others then
    if sqlerrm not like '%budget%' then raise; end if;
  end;

  if exists (select 1 from campaign_sources where external_run_id = 'run-over-budget') then
    raise exception 'chamada rejeitada por orcamento nao deveria ter persistido campaign_sources';
  end if;
  if (select status from campaigns where id = campaign_over_budget) <> 'READY' then
    raise exception 'campanha rejeitada por orcamento nao deveria mudar de estado';
  end if;

  -- --- start_apify_collection: caminho de sucesso, moeda e valor corretos ---
  insert into campaigns(user_id, name, status, apify_budget_minor)
    values(user_a, 'RPC ok campaign', 'READY', 1000) returning id into campaign_ok;

  source_id := start_apify_collection(campaign_ok, 'run-ok-1', 'dataset-pending', '{"query":"clinicas"}'::jsonb, 500);

  if not exists (
    select 1 from campaign_sources
    where id = source_id and external_run_id = 'run-ok-1' and status = 'RUNNING'
      and amount_minor = 500 and currency = 'USD'
  ) then
    raise exception 'campaign_sources nao foi criado com o valor/moeda esperados';
  end if;
  if (select status from campaigns where id = campaign_ok) <> 'COLLECTING' then
    raise exception 'campanha deveria mudar para COLLECTING apos start_apify_collection';
  end if;
  if not exists (
    select 1 from jobs where campaign_id = campaign_ok and type = 'START_APIFY_RUN'
      and status = 'SUCCEEDED' and idempotency_key = 'apify-start:run-ok-1'
  ) then
    raise exception 'job START_APIFY_RUN nao foi registrado';
  end if;
  if not exists (
    select 1 from audit_log where entity_id = campaign_ok and action = 'APIFY_COLLECTION_STARTED'
      and (data->>'amountMinor')::int = 500 and data->>'currency' = 'USD'
  ) then
    raise exception 'audit_log da coleta Apify nao foi registrado em USD';
  end if;

  -- --- start_apify_collection: guardrail de estado (nao pode coletar 2x a mesma campanha) ---
  begin
    perform start_apify_collection(campaign_ok, 'run-ok-2', null, '{}'::jsonb, 100);
    raise exception 'start_apify_collection deveria rejeitar campanha que ja nao esta READY/PAUSED';
  exception when others then
    if sqlerrm not like '%state%' then raise; end if;
  end;

  perform set_config('role', 'postgres', true);

  -- --- receive_apify_webhook: primeira entrega processa; reentrega e idempotente ---
  perform receive_apify_webhook('run-ok-1', 'SUCCEEDED', 'dataset-final', 'hash-1', '{}'::jsonb);

  if (select duplicate from receive_apify_webhook('run-ok-1', 'SUCCEEDED', 'dataset-final', 'hash-1', '{}'::jsonb)) is distinct from true then
    raise exception 'reentrega do mesmo webhook Apify deveria ser marcada duplicate=true';
  end if;

  select count(*) into job_count from jobs
    where campaign_id = campaign_ok and type = 'IMPORT_APIFY_DATASET' and idempotency_key = 'apify-import:run-ok-1';
  if job_count <> 1 then
    raise exception 'reentrega do webhook Apify criou % jobs de importacao, esperado 1', job_count;
  end if;

  if (select external_dataset_id from campaign_sources where id = source_id) <> 'dataset-final' then
    raise exception 'campaign_sources nao refletiu o dataset final apos o webhook';
  end if;

  -- Segunda reentrega com o MESMO hash tambem tem que ficar idempotente (receipt ja existe).
  if (select duplicate from receive_apify_webhook('run-ok-1', 'SUCCEEDED', 'dataset-final', 'hash-1', '{}'::jsonb)) is distinct from true then
    raise exception 'terceira entrega do mesmo evento deveria continuar duplicate=true';
  end if;
end $$;

-- --- receive_resend_webhook: DELIVERED, HARD_BOUNCE, COMPLAINT e idempotencia ---
do $$
declare
  user_a uuid := '55555555-5555-5555-5555-555555555555';
  company_delivered uuid;
  company_bounced uuid;
  company_complaint uuid;
  campaign_a uuid;
  lead_delivered uuid;
  lead_bounced uuid;
  lead_complaint uuid;
  msg_delivered uuid;
  msg_bounced uuid;
  msg_complaint uuid;
  pending_job uuid;
  effect_count integer;
  is_dup boolean;
begin
  insert into campaigns(user_id, name, status) values(user_a, 'RPC resend campaign', 'ACTIVE') returning id into campaign_a;

  -- Caso DELIVERED + idempotencia. Uma empresa por lead: campaign_leads tem unique
  -- (campaign_id, company_id) -- uma empresa aparece uma unica vez por campanha (SPEC 2.0 §21).
  insert into companies(user_id, name) values(user_a, 'RPC resend company (delivered)') returning id into company_delivered;
  insert into campaign_leads(user_id, campaign_id, company_id, stage)
    values(user_a, campaign_a, company_delivered, 'EMAIL_SEQUENCE_ACTIVE') returning id into lead_delivered;
  insert into outbound_messages(user_id, campaign_lead_id, subject, body_text, to_email, status, provider_message_id, idempotency_key)
    values(user_a, lead_delivered, 'Assunto', 'Corpo', 'delivered@test.invalid', 'SENT', 'prov-delivered-1', 'idem-delivered-1')
    returning id into msg_delivered;

  perform receive_resend_webhook('evt-delivered-1', 'prov-delivered-1', 'DELIVERED', now(), 'hash-d1', '{}'::jsonb);
  if (select status from outbound_messages where id = msg_delivered) <> 'DELIVERED' then
    raise exception 'status nao avancou para DELIVERED';
  end if;
  select count(*) into effect_count from email_event_effects ee
    join message_events me on me.id = ee.message_event_id
    where me.message_id = msg_delivered;
  if effect_count <> 1 then
    raise exception 'DELIVERED deveria gerar exatamente 1 efeito, gerou %', effect_count;
  end if;

  select duplicate into is_dup from receive_resend_webhook('evt-delivered-1', 'prov-delivered-1', 'DELIVERED', now(), 'hash-d1', '{}'::jsonb);
  if is_dup is distinct from true then
    raise exception 'reentrega do evento DELIVERED deveria ser duplicate=true';
  end if;
  select count(*) into effect_count from email_event_effects ee
    join message_events me on me.id = ee.message_event_id
    where me.message_id = msg_delivered;
  if effect_count <> 1 then
    raise exception 'reentrega duplicada nao pode reaplicar o efeito (contagem virou %)', effect_count;
  end if;

  -- Caso HARD_BOUNCE: suprime o endereco
  insert into companies(user_id, name) values(user_a, 'RPC resend company (bounced)') returning id into company_bounced;
  insert into campaign_leads(user_id, campaign_id, company_id, stage)
    values(user_a, campaign_a, company_bounced, 'EMAIL_SEQUENCE_ACTIVE') returning id into lead_bounced;
  insert into outbound_messages(user_id, campaign_lead_id, subject, body_text, to_email, status, provider_message_id, idempotency_key)
    values(user_a, lead_bounced, 'Assunto', 'Corpo', 'bounced@test.invalid', 'SENT', 'prov-bounced-1', 'idem-bounced-1')
    returning id into msg_bounced;

  perform receive_resend_webhook('evt-bounced-1', 'prov-bounced-1', 'HARD_BOUNCE', now(), 'hash-b1', '{}'::jsonb);
  if (select status from outbound_messages where id = msg_bounced) <> 'BOUNCED' then
    raise exception 'status nao avancou para BOUNCED';
  end if;
  if not exists (
    select 1 from suppression_entries
    where user_id = user_a and scope = 'EMAIL' and value = 'bounced@test.invalid' and reason = 'HARD_BOUNCE'
  ) then
    raise exception 'HARD_BOUNCE nao suprimiu o endereco';
  end if;

  -- Caso COMPLAINT: suprime, cancela job pendente da sequencia e cria tarefa
  insert into companies(user_id, name) values(user_a, 'RPC resend company (complaint)') returning id into company_complaint;
  insert into campaign_leads(user_id, campaign_id, company_id, stage)
    values(user_a, campaign_a, company_complaint, 'EMAIL_SEQUENCE_ACTIVE') returning id into lead_complaint;
  insert into outbound_messages(user_id, campaign_lead_id, subject, body_text, to_email, status, provider_message_id, idempotency_key)
    values(user_a, lead_complaint, 'Assunto', 'Corpo', 'complaint@test.invalid', 'SENT', 'prov-complaint-1', 'idem-complaint-1')
    returning id into msg_complaint;
  insert into jobs(user_id, type, status, payload)
    values(user_a, 'SEND_EMAIL', 'PENDING', jsonb_build_object('campaignLeadId', lead_complaint::text))
    returning id into pending_job;

  perform receive_resend_webhook('evt-complaint-1', 'prov-complaint-1', 'COMPLAINT', now(), 'hash-c1', '{}'::jsonb);

  if not exists (
    select 1 from suppression_entries
    where user_id = user_a and scope = 'EMAIL' and value = 'complaint@test.invalid' and reason = 'COMPLAINT'
  ) then
    raise exception 'COMPLAINT nao suprimiu o endereco';
  end if;
  if (select status from jobs where id = pending_job) <> 'CANCELLED' then
    raise exception 'COMPLAINT nao cancelou o job pendente da sequencia';
  end if;
  if not exists (
    select 1 from tasks where campaign_lead_id = lead_complaint and type = 'REVIEW_MESSAGE'
  ) then
    raise exception 'COMPLAINT nao criou a tarefa de revisao';
  end if;
end $$;

rollback;

select 'rpc-idempotency ok' as resultado;
