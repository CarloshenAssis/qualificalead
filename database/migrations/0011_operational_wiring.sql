-- Operational wiring hardening. Append-only receipts/effects remain immutable even for RLS-bypass roles.
create or replace function prevent_pilot_ledger_mutation() returns trigger language plpgsql as $$
begin raise exception '% is append-only', tg_table_name using errcode='55000'; end $$;

do $$ declare t text; begin
  foreach t in array array['email_event_effects','integration_receipts'] loop
    execute format('drop policy if exists %I on %I', t || '_own', t);
    execute format('drop policy if exists %I on %I', t || '_select_own', t);
    execute format('drop policy if exists %I on %I', t || '_insert_own', t);
    execute format('drop policy if exists %I on %I', t || '_update_own', t);
    execute format('drop policy if exists %I on %I', t || '_delete_own', t);
    execute format('create policy %I on %I for select to authenticated using (user_id=(select auth.uid()))',t||'_select_own',t);
    execute format('create policy %I on %I for insert to authenticated with check (user_id=(select auth.uid()))',t||'_insert_own',t);
    execute format('drop trigger if exists %I on %I',t||'_append_only',t);
    execute format('create trigger %I before update or delete on %I for each row execute function prevent_pilot_ledger_mutation()',t||'_append_only',t);
  end loop;
end $$;

grant select, insert on email_event_effects, integration_receipts to authenticated;

create unique index if not exists campaign_sources_global_run_key on campaign_sources(source,external_run_id) where external_run_id is not null;

create or replace function accept_apify_webhook(p_run_id text,p_event_type text,p_payload_hash text,p_dataset_id text default null) returns jsonb language plpgsql security definer set search_path=public as $$
declare s campaign_sources%rowtype; receipt_id uuid; job_id uuid;
begin
 if p_event_type not in ('ACTOR.RUN.SUCCEEDED','ACTOR.RUN.FAILED','ACTOR.RUN.ABORTED','ACTOR.RUN.TIMED_OUT') then raise exception 'unknown event'; end if;
 select * into strict s from campaign_sources where external_run_id=p_run_id for update;
 insert into integration_receipts(user_id,provider,external_key,payload_hash) values(s.user_id,'APIFY',p_run_id||':'||p_event_type,p_payload_hash) on conflict do nothing returning id into receipt_id;
 if receipt_id is null then return jsonb_build_object('duplicate',true); end if;
 update campaign_sources set external_dataset_id=coalesce(p_dataset_id,external_dataset_id),finished_at=case when p_event_type<>'ACTOR.RUN.SUCCEEDED' then now() else finished_at end where id=s.id;
 insert into jobs(user_id,campaign_id,type,status,payload) values(s.user_id,s.campaign_id,case when p_event_type='ACTOR.RUN.SUCCEEDED' then 'IMPORT_APIFY_DATASET'::job_type else 'START_APIFY_RUN'::job_type,'PENDING',jsonb_build_object('campaignSourceId',s.id,'eventType',p_event_type)) returning id into job_id;
 return jsonb_build_object('duplicate',false,'jobId',job_id);
exception when no_data_found then raise exception 'run not found'; end $$;

create or replace function accept_resend_webhook(p_svix_id text,p_provider_message_id text,p_event_type text,p_occurred_at timestamptz,p_payload jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare m outbound_messages%rowtype; receipt_id uuid; event_id uuid; job_id uuid; mapped email_event_type;
begin
 select * into strict m from outbound_messages where provider_message_id=p_provider_message_id for update;
 insert into integration_receipts(user_id,provider,external_key,payload_hash) values(m.user_id,'RESEND',p_svix_id,encode(digest(p_payload::text,'sha256'),'hex')) on conflict do nothing returning id into receipt_id;
 if receipt_id is null then return jsonb_build_object('duplicate',true); end if;
 mapped:=case p_event_type when 'email.sent' then 'SENT' when 'email.delivered' then 'DELIVERED' when 'email.delivery_delayed' then 'DEFERRED' when 'email.bounced' then case when p_payload#>>'{data,bounce,type}'='soft' then 'SOFT_BOUNCE' else 'HARD_BOUNCE' end when 'email.complained' then 'COMPLAINT' when 'email.failed' then 'FAILED' when 'email.suppressed' then 'HARD_BOUNCE' when 'email.opened' then 'OPENED' when 'email.clicked' then 'CLICKED' when 'email.received' then 'REPLIED' end;
 insert into message_events(user_id,message_id,type,provider,provider_event_id,event_key,payload,occurred_at) values(m.user_id,m.id,mapped,'resend',p_svix_id,'resend:'||p_svix_id,p_payload,p_occurred_at) returning id into event_id;
 insert into jobs(user_id,campaign_id,type,status,payload) select m.user_id,cl.campaign_id,'PROCESS_EMAIL_EVENT','PENDING',jsonb_build_object('messageEventId',event_id) from campaign_leads cl where cl.id=m.campaign_lead_id returning id into job_id;
 return jsonb_build_object('duplicate',false,'jobId',job_id);
exception when no_data_found then raise exception 'message not found'; end $$;
revoke all on function accept_apify_webhook(text,text,text,text) from public;
revoke all on function accept_resend_webhook(text,text,text,timestamptz,jsonb) from public;
alter table campaign_sources add column if not exists run_state text not null default 'READY' check(run_state in ('READY','RUNNING','SUCCEEDED','FAILED','ABORTED','TIMED_OUT'));
alter table campaign_sources add column if not exists amount_minor integer not null default 0 check(amount_minor>=0);
alter table campaign_sources add column if not exists currency text not null default 'USD' check(currency='USD');
alter table campaigns add column if not exists budget_currency text not null default 'USD' check(budget_currency='USD');
create unique index if not exists contacts_pilot_email_key on contacts(user_id,company_id,email_normalized) where email_normalized is not null;
create unique index if not exists observations_pilot_source_key on company_observations(user_id,company_id,type,coalesce(source_url,''));
