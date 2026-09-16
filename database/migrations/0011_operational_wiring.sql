-- Operational wiring for the disabled-by-default Apify/Resend pilot.

-- Campaign collection is distinct from generic discovery and is intentionally explicit.
alter type campaign_status add value if not exists 'COLLECTING' after 'READY';

alter table campaign_sources add column if not exists status text not null default 'RUNNING'
  check (status in ('READY','RUNNING','SUCCEEDED','FAILED','ABORTED','TIMED_OUT'));
alter table campaign_sources add column if not exists amount_minor integer not null default 0 check (amount_minor >= 0);
alter table campaign_sources add column if not exists currency text not null default 'USD' check (currency = 'USD');
alter table campaign_sources add column if not exists import_offset integer not null default 0 check (import_offset >= 0);

alter table campaigns add column if not exists apify_budget_minor integer
  check (apify_budget_minor is null or apify_budget_minor >= 0);
update campaigns set apify_budget_minor = budget_limit_cents where apify_budget_minor is null;

alter table jobs add column if not exists idempotency_key text;
alter table jobs add column if not exists dead_lettered_at timestamptz;
create unique index if not exists jobs_user_idempotency_key
  on jobs(user_id, idempotency_key) where idempotency_key is not null;
create index if not exists jobs_tenant_claim_idx
  on jobs(user_id, status, scheduled_for, priority desc);

-- Strengthen ledgers introduced in 0009/0010. RLS policy commands are separated:
-- ledgers may be observed and appended, never changed in place.
create or replace function reject_append_only_change() returns trigger
language plpgsql as $$ begin raise exception '% is append-only', tg_table_name using errcode='55000'; end $$;

drop policy if exists email_event_effects_own on email_event_effects;
drop policy if exists email_event_effects_select on email_event_effects;
drop policy if exists email_event_effects_insert on email_event_effects;
create policy email_event_effects_select on email_event_effects for select using (auth.uid() = user_id);
create policy email_event_effects_insert on email_event_effects for insert with check (auth.uid() = user_id);
drop trigger if exists email_event_effects_append_only on email_event_effects;
create trigger email_event_effects_append_only before update or delete on email_event_effects
  for each row execute function reject_append_only_change();
create index if not exists email_event_effects_tenant_event_idx
  on email_event_effects(user_id, message_event_id, applied_at);

drop policy if exists integration_receipts_own on integration_receipts;
drop policy if exists integration_receipts_select on integration_receipts;
drop policy if exists integration_receipts_insert on integration_receipts;
create policy integration_receipts_select on integration_receipts for select using (auth.uid() = user_id);
create policy integration_receipts_insert on integration_receipts for insert with check (auth.uid() = user_id);
drop trigger if exists integration_receipts_append_only on integration_receipts;
create trigger integration_receipts_append_only before update or delete on integration_receipts
  for each row execute function reject_append_only_change();
create index if not exists integration_receipts_tenant_received_idx
  on integration_receipts(user_id, provider, received_at desc);

-- Database dedupe is authoritative even with concurrent import workers.
create unique index if not exists lead_sources_tenant_source_external_key
  on lead_sources(user_id, source, source_id) where source_id is not null;
create unique index if not exists contacts_tenant_company_email_key
  on contacts(user_id, company_id, email_normalized) where email_normalized is not null;
create unique index if not exists contacts_tenant_company_email_all
  on contacts(user_id, company_id, email_normalized);
alter table companies add column if not exists operational_dedupe_key text;
create unique index if not exists companies_tenant_operational_dedupe_key
  on companies(user_id, operational_dedupe_key);
alter table company_observations add column if not exists import_key text;
create unique index if not exists company_observations_tenant_import_key
  on company_observations(user_id, import_key);
create unique index if not exists company_observations_import_key
  on company_observations(user_id, company_id, type, source_type, coalesce(source_url,''));

-- A provider id is write-once; an uncertain request must be reconciled by a human/job.
create or replace function enforce_provider_message_write_once() returns trigger language plpgsql as $$
begin
  if old.provider_message_id is not null and new.provider_message_id is distinct from old.provider_message_id then
    raise exception 'provider_message_id is write-once' using errcode='23514';
  end if;
  if old.provider_state = 'AMBIGUOUS' and new.provider_state = 'REQUESTING' then
    raise exception 'ambiguous delivery requires reconciliation' using errcode='23514';
  end if;
  return new;
end $$;
drop trigger if exists outbound_provider_write_once on outbound_messages;
create trigger outbound_provider_write_once before update on outbound_messages
  for each row execute function enforce_provider_message_write_once();

-- Authenticated Apify webhook: tenant is resolved exclusively from the stored run.
create or replace function receive_apify_webhook(
  p_run_id text, p_status text, p_dataset_id text, p_payload_hash text, p_payload jsonb
) returns table(duplicate boolean, job_id uuid, user_id uuid)
language plpgsql security definer set search_path=public,pg_temp as $$
declare src campaign_sources%rowtype; receipt_id uuid; created_job uuid;
begin
  if p_status not in ('SUCCEEDED','FAILED','ABORTED','TIMED_OUT') then raise exception 'unsupported Apify status'; end if;
  select * into src from campaign_sources where external_run_id=p_run_id for update;
  if not found then raise exception 'unknown Apify run'; end if;
  insert into integration_receipts(user_id,provider,external_key,payload_hash)
    values(src.user_id,'APIFY',p_run_id||':'||p_status,p_payload_hash)
    on conflict(user_id,provider,external_key) do nothing returning id into receipt_id;
  if receipt_id is null then return query select true, null::uuid, src.user_id; return; end if;
  update campaign_sources set status=p_status, external_dataset_id=coalesce(p_dataset_id,external_dataset_id),
    finished_at=case when p_status='SUCCEEDED' then null else now() end where id=src.id;
  if p_status='SUCCEEDED' then
    insert into jobs(user_id,campaign_id,type,status,payload,idempotency_key)
      values(src.user_id,src.campaign_id,'IMPORT_APIFY_DATASET','PENDING',
        jsonb_build_object('campaignSourceId',src.id,'runId',p_run_id,'datasetId',p_dataset_id),
        'apify-import:'||p_run_id)
      on conflict(user_id,idempotency_key) where idempotency_key is not null do update set updated_at=now()
      returning id into created_job;
  else
    update campaign_sources set finished_at=now() where id=src.id;
    update campaigns set status='FAILED' where id=src.campaign_id and user_id=src.user_id;
  end if;
  return query select false,created_job,src.user_id;
end $$;
revoke all on function receive_apify_webhook(text,text,text,text,jsonb) from public;

-- Receipt/event insertion is one transaction. Application workers apply the recorded event's
-- domain effects using effect keys, also in a transaction/RPC.
create or replace function receive_resend_webhook(
  p_provider_event_id text, p_provider_message_id text, p_event_type email_event_type,
  p_occurred_at timestamptz, p_payload_hash text, p_payload jsonb
) returns table(duplicate boolean, message_event_id uuid, user_id uuid)
language plpgsql security definer set search_path=public,pg_temp as $$
declare msg outbound_messages%rowtype; receipt_id uuid; event_id uuid;
begin
  select * into msg from outbound_messages where provider_message_id=p_provider_message_id for update;
  if not found then raise exception 'unknown provider message'; end if;
  insert into integration_receipts(user_id,provider,external_key,payload_hash)
    values(msg.user_id,'RESEND',p_provider_event_id,p_payload_hash)
    on conflict(user_id,provider,external_key) do nothing returning id into receipt_id;
  if receipt_id is null then
    select id into event_id from message_events where user_id=msg.user_id and event_key='resend:'||p_provider_event_id;
    return query select true,event_id,msg.user_id; return;
  end if;
  insert into message_events(user_id,message_id,type,provider,provider_event_id,event_key,payload,occurred_at)
    values(msg.user_id,msg.id,p_event_type,'RESEND',p_provider_event_id,'resend:'||p_provider_event_id,p_payload,p_occurred_at)
    returning id into event_id;
  if p_event_type = 'DELIVERED' and msg.status in ('SENT','QUEUED','SCHEDULED') then
    update outbound_messages set status='DELIVERED' where id=msg.id;
    insert into email_event_effects(user_id,message_event_id,effect_type,effect_key)
      values(msg.user_id,event_id,'STATUS','resend:'||p_provider_event_id||':STATUS');
  elsif p_event_type = 'HARD_BOUNCE' then
    update outbound_messages set status='BOUNCED' where id=msg.id and status <> 'REPLIED';
    insert into email_event_effects(user_id,message_event_id,effect_type,effect_key)
      values(msg.user_id,event_id,'STATUS','resend:'||p_provider_event_id||':STATUS'),
            (msg.user_id,event_id,'SUPPRESSION','resend:'||p_provider_event_id||':SUPPRESSION');
    insert into suppression_entries(user_id,scope,value,reason,origin)
      values(msg.user_id,'EMAIL',lower(msg.to_email),'HARD_BOUNCE','RESEND')
      on conflict(user_id,scope,value) do nothing;
  elsif p_event_type = 'COMPLAINT' then
    insert into email_event_effects(user_id,message_event_id,effect_type,effect_key)
      values(msg.user_id,event_id,'SUPPRESSION','resend:'||p_provider_event_id||':SUPPRESSION'),
            (msg.user_id,event_id,'CANCEL_SEQUENCE','resend:'||p_provider_event_id||':CANCEL_SEQUENCE'),
            (msg.user_id,event_id,'TASK','resend:'||p_provider_event_id||':TASK');
    insert into suppression_entries(user_id,scope,value,reason,origin)
      values(msg.user_id,'EMAIL',lower(msg.to_email),'COMPLAINT','RESEND')
      on conflict(user_id,scope,value) do nothing;
    update jobs set status='CANCELLED',finished_at=now()
      where user_id=msg.user_id and type in ('SEND_EMAIL','SCHEDULE_SEQUENCE')
        and status='PENDING' and payload->>'campaignLeadId'=msg.campaign_lead_id::text;
    insert into tasks(user_id,type,title,campaign_lead_id,contact_id)
      values(msg.user_id,'REVIEW_MESSAGE','Revisar reclamação de e-mail',msg.campaign_lead_id,msg.contact_id);
  end if;
  return query select false,event_id,msg.user_id;
end $$;
revoke all on function receive_resend_webhook(text,text,email_event_type,timestamptz,text,jsonb) from public;

-- Persists all effects of a successfully started provider run atomically.
create or replace function start_apify_collection(
  p_campaign_id uuid, p_run_id text, p_dataset_id text, p_input jsonb, p_amount_minor integer
) returns uuid language plpgsql security invoker set search_path=public,pg_temp as $$
declare c campaigns%rowtype; source_id uuid;
begin
  select * into c from campaigns where id=p_campaign_id and user_id=auth.uid() for update;
  if not found then raise exception 'campaign not found'; end if;
  if c.status not in ('READY','PAUSED') then raise exception 'campaign state does not allow collection'; end if;
  if p_amount_minor < 0 or (c.apify_budget_minor is not null and p_amount_minor > c.apify_budget_minor) then
    raise exception 'Apify USD budget exceeded';
  end if;
  insert into campaign_sources(user_id,campaign_id,source,run_input,external_run_id,
    external_dataset_id,started_at,status,amount_minor,currency)
    values(c.user_id,c.id,'APIFY_GOOGLE_MAPS',p_input,p_run_id,p_dataset_id,now(),'RUNNING',p_amount_minor,'USD')
    returning id into source_id;
  insert into jobs(user_id,campaign_id,type,status,payload,idempotency_key)
    values(c.user_id,c.id,'START_APIFY_RUN','SUCCEEDED',jsonb_build_object('campaignSourceId',source_id,'runId',p_run_id),
      'apify-start:'||p_run_id);
  insert into audit_log(user_id,action,entity_type,entity_id,actor_id,data)
    values(c.user_id,'APIFY_COLLECTION_STARTED','campaign',c.id,auth.uid(),
      jsonb_build_object('runId',p_run_id,'currency','USD','amountMinor',p_amount_minor));
  update campaigns set status='COLLECTING',started_at=coalesce(started_at,now()) where id=c.id;
  return source_id;
end $$;
