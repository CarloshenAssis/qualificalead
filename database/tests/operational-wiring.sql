begin;
insert into auth.users(id,email) values('33333333-3333-3333-3333-333333333333','ops-a@test.invalid'),('44444444-4444-4444-4444-444444444444','ops-b@test.invalid') on conflict do nothing;
insert into integration_receipts(user_id,provider,external_key,payload_hash)
 values('33333333-3333-3333-3333-333333333333','RESEND','evt-test','hash');

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
