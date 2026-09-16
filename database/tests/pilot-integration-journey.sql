\set ON_ERROR_STOP on
-- Real-table webhook/idempotency journey. Provider HTTP remains mocked by the TypeScript suite.
insert into auth.users(id,email) values('10000000-0000-0000-0000-000000000001','pilot@test') on conflict do nothing;
insert into campaigns(id,user_id,name,segment,city,max_companies,budget_limit_cents,status)
values('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Pilot','Dentista','Recife',20,500,'PAUSED') on conflict do nothing;
insert into campaign_sources(id,user_id,campaign_id,source,external_run_id,run_state,started_at)
values('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','APIFY_GOOGLE_MAPS','run-ci','RUNNING',now()) on conflict do nothing;
select accept_apify_webhook('run-ci','ACTOR.RUN.SUCCEEDED','hash','dataset-ci');
select accept_apify_webhook('run-ci','ACTOR.RUN.SUCCEEDED','hash','dataset-ci');
do $$ begin
 if (select count(*) from integration_receipts where provider='APIFY' and external_key='run-ci:ACTOR.RUN.SUCCEEDED')<>1 then raise exception 'Apify receipt is not idempotent'; end if;
 if (select count(*) from jobs where campaign_id='20000000-0000-0000-0000-000000000001' and type='IMPORT_APIFY_DATASET')<>1 then raise exception 'Apify job duplicated'; end if;
end $$;
insert into companies(id,user_id,name) values('40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Clinic') on conflict do nothing;
insert into campaign_leads(id,user_id,campaign_id,company_id,stage) values('50000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','APPROVED_FOR_EMAIL') on conflict do nothing;
insert into outbound_messages(id,user_id,campaign_lead_id,subject,body_text,to_email,idempotency_key,status,provider_message_id,delivery_mode,provider_state)
values('60000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','Hello','Identity / unsubscribe','lead:step:contact','pilot-key','SENT','resend-ci','LIVE','ACCEPTED') on conflict do nothing;
select accept_resend_webhook('svix-ci','resend-ci','email.delivered',now(),'{"data":{"email_id":"resend-ci"}}');
select accept_resend_webhook('svix-ci','resend-ci','email.delivered',now(),'{"data":{"email_id":"resend-ci"}}');
do $$ begin
 if (select count(*) from integration_receipts where provider='RESEND' and external_key='svix-ci')<>1 then raise exception 'Resend replay accepted twice'; end if;
 if (select count(*) from message_events where event_key='resend:svix-ci')<>1 then raise exception 'Message event duplicated'; end if;
 if (select count(*) from jobs where type='PROCESS_EMAIL_EVENT' and payload->>'messageEventId' is not null)<>1 then raise exception 'Email event job duplicated'; end if;
end $$;
