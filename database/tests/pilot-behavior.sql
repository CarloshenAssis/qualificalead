\set ON_ERROR_STOP on
insert into auth.users(id,email) values ('00000000-0000-0000-0000-000000000001','one@test'),('00000000-0000-0000-0000-000000000002','two@test') on conflict do nothing;
insert into integration_receipts(user_id,provider,external_key,payload_hash) values ('00000000-0000-0000-0000-000000000001','test','same','hash');
do $$ begin begin insert into integration_receipts(user_id,provider,external_key,payload_hash) values ('00000000-0000-0000-0000-000000000001','test','same','hash'); raise exception 'duplicate accepted'; exception when unique_violation then null; end; end $$;
do $$ begin begin update integration_receipts set payload_hash='changed' where external_key='same'; raise exception 'update accepted'; exception when sqlstate '55000' then null; end; end $$;
do $$ begin begin delete from integration_receipts where external_key='same'; raise exception 'delete accepted'; exception when sqlstate '55000' then null; end; end $$;
set role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
do $$ begin if exists(select 1 from integration_receipts where external_key='same') then raise exception 'RLS tenant leak'; end if; end $$;
reset role;
