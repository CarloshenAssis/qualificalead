-- ---------------------------------------------------------------------------
-- Teste de isolamento entre usuarios (SPEC 1.1 §58)
--
-- Reproduz exatamente o que o PostgREST faz: assume o papel `authenticated` e
-- define `request.jwt.claims`, que e de onde `auth.uid()` le o id do usuario.
--
-- Rode no SQL Editor do Supabase. O resultado e uma tabela com PASS/FAIL.
-- Ao final, os dados de teste sao removidos.
-- ---------------------------------------------------------------------------

-- 1. Dois usuarios de teste ---------------------------------------------------

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
   'authenticated', 'authenticated', 'usuario.a@leadhunter.test',
   crypt('senha-teste-a', gen_salt('bf')), now(), now(), now(),
   '{"provider":"email","providers":["email"]}', '{"name":"Usuario A"}'),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222',
   'authenticated', 'authenticated', 'usuario.b@leadhunter.test',
   crypt('senha-teste-b', gen_salt('bf')), now(), now(), now(),
   '{"provider":"email","providers":["email"]}', '{"name":"Usuario B"}')
on conflict (id) do nothing;

-- 2. Execucao -----------------------------------------------------------------

create temp table if not exists rls_report (passo text, esperado text, obtido text);
grant all on table rls_report to authenticated;
truncate rls_report;

do $$
declare
  a uuid := '11111111-1111-1111-1111-111111111111';
  b uuid := '22222222-2222-2222-2222-222222222222';
  v int;
  v_company_a uuid;
  v_lead_a uuid;
begin
  delete from companies where google_place_id in ('RLS_TEST_A', 'RLS_TEST_B', 'RLS_TEST_FORJADA');
  delete from prospecting_searches where query = 'rls-test';

  perform set_config('role', 'authenticated', true);

  -- Usuario A cria dados em todas as tabelas
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  insert into companies (user_id, google_place_id, name) values (a, 'RLS_TEST_A', 'Empresa A')
    returning id into v_company_a;
  insert into leads (user_id, company_id) values (a, v_company_a) returning id into v_lead_a;
  insert into interactions (user_id, lead_id, type, description) values (a, v_lead_a, 'NOTA', 'nota do A');
  insert into briefings (user_id, company_id, generated_briefing) values (a, v_company_a, 'briefing do A');
  insert into prospecting_searches (user_id, query) values (a, 'rls-test');

  -- Usuario B
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  insert into companies (user_id, google_place_id, name) values (b, 'RLS_TEST_B', 'Empresa B');

  select count(*) into v from companies where user_id = a;
  insert into rls_report values ('B le companies de A', '0', v::text);
  select count(*) into v from leads where user_id = a;
  insert into rls_report values ('B le leads de A', '0', v::text);
  select count(*) into v from interactions where user_id = a;
  insert into rls_report values ('B le interactions de A', '0', v::text);
  select count(*) into v from briefings where user_id = a;
  insert into rls_report values ('B le briefings de A', '0', v::text);
  select count(*) into v from prospecting_searches where user_id = a;
  insert into rls_report values ('B le prospecting_searches de A', '0', v::text);
  select count(*) into v from profiles where user_id = a;
  insert into rls_report values ('B le profiles de A', '0', v::text);

  update companies set name = 'sequestrada' where id = v_company_a;
  get diagnostics v = row_count;
  insert into rls_report values ('B altera company de A', '0', v::text);

  delete from companies where id = v_company_a;
  get diagnostics v = row_count;
  insert into rls_report values ('B apaga company de A', '0', v::text);

  begin
    insert into companies (user_id, google_place_id, name) values (a, 'RLS_TEST_FORJADA', 'forjada');
    insert into rls_report values ('B insere company em nome de A', 'bloqueado', 'PERMITIDO');
  exception when others then
    insert into rls_report values ('B insere company em nome de A', 'bloqueado', 'bloqueado');
  end;

  -- Integridade reforcada pelo banco (SPEC 1.1 §89): lead de B apontando para empresa de A
  begin
    insert into leads (user_id, company_id) values (b, v_company_a);
    insert into rls_report values ('lead de B aponta para company de A', 'bloqueado', 'PERMITIDO');
  exception when others then
    insert into rls_report values ('lead de B aponta para company de A', 'bloqueado', 'bloqueado');
  end;

  -- A continua com os proprios dados
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  select count(*) into v from companies where google_place_id = 'RLS_TEST_A';
  insert into rls_report values ('Empresa A intacta para A', '1', v::text);
  select count(*) into v from profiles where user_id = a;
  insert into rls_report values ('A enxerga o proprio profile', '1', v::text);

  perform set_config('role', 'postgres', true);
end $$;

select passo, esperado, obtido,
       case when obtido = esperado then 'PASS' else 'FAIL' end as resultado
from rls_report;

-- 3. Limpeza ------------------------------------------------------------------

delete from auth.users
where id in ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222');
