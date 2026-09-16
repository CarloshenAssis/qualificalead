begin;
insert into auth.users(id,email) values('33333333-3333-3333-3333-333333333333','ops-a@test.invalid'),('44444444-4444-4444-4444-444444444444','ops-b@test.invalid') on conflict do nothing;
insert into integration_receipts(user_id,provider,external_key,payload_hash)
 values('33333333-3333-3333-3333-333333333333','RESEND','evt-test','hash');

do $$
declare
 user_a uuid := '33333333-3333-3333-3333-333333333333';
 user_b uuid := '44444444-4444-4444-4444-444444444444';
 company_a uuid;
 campaign_a uuid;
 lead_a uuid;
 message_a uuid;
 event_a uuid;
begin
 insert into companies(user_id,name) values(user_a,'Tenant-safe event company') returning id into company_a;
 insert into campaigns(user_id,name,status) values(user_a,'Tenant-safe event campaign','PAUSED') returning id into campaign_a;
 insert into campaign_leads(user_id,campaign_id,company_id,stage)
  values(user_a,campaign_a,company_a,'REVIEW_PENDING') returning id into lead_a;
 insert into outbound_messages(user_id,campaign_lead_id,subject,body_text,to_email,idempotency_key)
  values(user_a,lead_a,'Tenant-safe subject','Tenant-safe body','event@test.invalid','tenant-safe-event-test')
  returning id into message_a;
 insert into message_events(user_id,message_id,type,event_key)
  values(user_a,message_a,'DELIVERED','tenant-safe-event') returning id into event_a;

 begin
  insert into email_event_effects(user_id,message_event_id,effect_type,effect_key)
   values(user_b,event_a,'STATUS','wrong-tenant-effect');
  raise exception 'FK deveria rejeitar efeito ligado ao evento de outro tenant';
 exception when foreign_key_violation then null;
 end;

 insert into email_event_effects(user_id,message_event_id,effect_type,effect_key)
  values(user_a,event_a,'STATUS','correct-tenant-effect');

 if not exists (
  select 1 from email_event_effects
  where user_id=user_a and message_event_id=event_a and effect_key='correct-tenant-effect'
 ) then
  raise exception 'efeito tenant-safe correto não foi persistido';
 end if;
end $$;

do $$ begin
 begin
  update integration_receipts set payload_hash='rewritten' where external_key='evt-test';
  raise exception 'UPDATE em ledger deveria falhar';
 exception when sqlstate '55000' then null; end;
 begin
  delete from integration_receipts where external_key='evt-test';
  raise exception 'DELETE em ledger deveria falhar';
 exception when sqlstate '55000' then null; end;
 begin
  insert into integration_receipts(user_id,provider,external_key,payload_hash)
   values('33333333-3333-3333-3333-333333333333','RESEND','evt-test','hash');
  raise exception 'receipt repetido deveria falhar';
 exception when unique_violation then null; end;
end $$;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}',true);
do $$ declare n integer; begin select count(*) into n from integration_receipts where external_key='evt-test';if n<>0 then raise exception 'RLS vazou receipt entre tenants';end if;end $$;
rollback;
