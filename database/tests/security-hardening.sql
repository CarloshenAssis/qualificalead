-- ---------------------------------------------------------------------------
-- Endurecimento de privilegios (migration 0012). Cada bloco falha alto
-- (raise exception) para rodar em CI sem depender de um humano lendo output.
-- ---------------------------------------------------------------------------

-- 1. Nenhuma RPC de webhook e executavel por anon/authenticated; service_role sim ---

do $$
begin
  if has_function_privilege('anon', 'receive_apify_webhook(text,text,text,text,jsonb)', 'EXECUTE') then
    raise exception 'anon ainda pode executar receive_apify_webhook';
  end if;
  if has_function_privilege('authenticated', 'receive_apify_webhook(text,text,text,text,jsonb)', 'EXECUTE') then
    raise exception 'authenticated ainda pode executar receive_apify_webhook';
  end if;
  if not has_function_privilege('service_role', 'receive_apify_webhook(text,text,text,text,jsonb)', 'EXECUTE') then
    raise exception 'service_role deveria poder executar receive_apify_webhook';
  end if;

  if has_function_privilege('anon', 'receive_resend_webhook(text,text,email_event_type,timestamptz,text,jsonb)', 'EXECUTE') then
    raise exception 'anon ainda pode executar receive_resend_webhook';
  end if;
  if has_function_privilege('authenticated', 'receive_resend_webhook(text,text,email_event_type,timestamptz,text,jsonb)', 'EXECUTE') then
    raise exception 'authenticated ainda pode executar receive_resend_webhook';
  end if;
  if not has_function_privilege('service_role', 'receive_resend_webhook(text,text,email_event_type,timestamptz,text,jsonb)', 'EXECUTE') then
    raise exception 'service_role deveria poder executar receive_resend_webhook';
  end if;
end $$;

-- 2. start_apify_collection: anon fora, authenticated preservado (chamador real) ----

do $$
begin
  if has_function_privilege('anon', 'start_apify_collection(uuid,text,text,jsonb,integer)', 'EXECUTE') then
    raise exception 'anon ainda pode executar start_apify_collection';
  end if;
  if not has_function_privilege('authenticated', 'start_apify_collection(uuid,text,text,jsonb,integer)', 'EXECUTE') then
    raise exception 'authenticated deveria continuar podendo executar start_apify_collection (app/(app)/campaigns/actions.ts depende disso)';
  end if;
end $$;

-- 3. Nenhuma das tres RPCs operacionais tem grant residual para PUBLIC -------------
-- has_function_privilege(current_user, ...) nao isola PUBLIC especificamente; aqui se
-- olha o ACL bruto da funcao e procura um grantee vazio (0 = PUBLIC no aclexplode).

do $$
declare offending text;
begin
  select string_agg(sig, ', ') into offending
  from (values
    ('receive_apify_webhook(text,text,text,text,jsonb)'),
    ('receive_resend_webhook(text,text,email_event_type,timestamptz,text,jsonb)'),
    ('start_apify_collection(uuid,text,text,jsonb,integer)')
  ) as expected(sig)
  where exists (
    select 1 from pg_proc p, aclexplode(p.proacl) a
    where p.oid = expected.sig::regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE'
  );
  if offending is not null then
    raise exception 'RPC operacional ainda acessivel por PUBLIC: %', offending;
  end if;
end $$;

-- 4. search_path das seis funcoes endurecidas ---------------------------------------

do $$
declare missing text;
begin
  select string_agg(sig, ', ') into missing
  from (values
    ('prevent_qualification_result_mutation()'),
    ('enforce_outbound_message_immutability()'),
    ('enforce_ready_qualification_evidence()'),
    ('qualification_gap_evidence_policy(text)'),
    ('reject_append_only_change()'),
    ('enforce_provider_message_write_once()')
  ) as expected(sig)
  where not exists (
    select 1 from pg_proc p
    where p.oid = expected.sig::regprocedure
      and p.proconfig is not null
      and 'search_path=public, pg_temp' = any(p.proconfig)
  );
  if missing is not null then
    raise exception 'search_path nao endurecido corretamente em: %', missing;
  end if;

  -- Nenhuma delas e SECURITY DEFINER -- confirma o que o advisor jamais afirmou
  -- (o lint dispara para SECURITY INVOKER tambem), para o relatorio nao exagerar a
  -- severidade real.
  if exists (
    select 1 from pg_proc p
    where p.oid = any(array[
      'prevent_qualification_result_mutation()'::regprocedure,
      'enforce_outbound_message_immutability()'::regprocedure,
      'enforce_ready_qualification_evidence()'::regprocedure,
      'qualification_gap_evidence_policy(text)'::regprocedure,
      'reject_append_only_change()'::regprocedure,
      'enforce_provider_message_write_once()'::regprocedure
    ])
    and p.prosecdef
  ) then
    raise exception 'uma das seis funcoes endurecidas e SECURITY DEFINER -- pressuposto do relatorio mudou';
  end if;
end $$;

-- 5. Teste funcional por funcao endurecida: o comportamento nao mudou --------------

begin;
insert into auth.users(id, email) values ('66666666-6666-6666-6666-666666666666', 'hardening-a@test.invalid') on conflict do nothing;

do $$
declare
  user_a uuid := '66666666-6666-6666-6666-666666666666';
  company_a uuid;
  qual_a uuid;
  campaign_a uuid;
  lead_a uuid;
  msg_a uuid;
begin
  insert into companies(user_id, name) values(user_a, 'Hardening test company') returning id into company_a;

  -- prevent_qualification_result_mutation: append-only continua bloqueando UPDATE/DELETE.
  insert into qualification_results(
    user_id, company_id, score_version, opportunity_score, opportunity_level, recommended_action
  ) values(user_a, company_a, 1, 10, 'BAIXA', 'LOW_PRIORITY') returning id into qual_a;
  begin
    update qualification_results set opportunity_score = 99 where id = qual_a;
    raise exception 'prevent_qualification_result_mutation deveria ter bloqueado o UPDATE';
  exception when sqlstate '55000' then null;
  end;

  -- enforce_ready_qualification_evidence (versao 0009, clausulas conjuntivas): ainda
  -- rejeita READY_FOR_EMAIL v2 sem evidencia -- mesmo comportamento de antes do 0012.
  begin
    insert into qualification_results(
      user_id, company_id, score_version, opportunity_score, opportunity_level,
      recommended_action, primary_gap, evidence_ids
    ) values(user_a, company_a, 2, 90, 'ALTA', 'READY_FOR_EMAIL', 'NO_WEBSITE', '{}');
    raise exception 'enforce_ready_qualification_evidence deveria ter rejeitado READY_FOR_EMAIL sem evidencia';
  exception when sqlstate '23514' then null;
  end;

  -- enforce_outbound_message_immutability: transicao valida ainda permitida; alterar
  -- conteudo depois de SENT ainda bloqueado.
  insert into campaigns(user_id, name, status) values(user_a, 'Hardening campaign', 'ACTIVE') returning id into campaign_a;
  insert into campaign_leads(user_id, campaign_id, company_id, stage)
    values(user_a, campaign_a, company_a, 'EMAIL_SEQUENCE_ACTIVE') returning id into lead_a;
  insert into outbound_messages(user_id, campaign_lead_id, subject, body_text, to_email, status, idempotency_key)
    values(user_a, lead_a, 'Assunto', 'Corpo', 'hardening@test.invalid', 'SENT', 'idem-hardening-1')
    returning id into msg_a;
  update outbound_messages set status = 'DELIVERED' where id = msg_a;
  if (select status from outbound_messages where id = msg_a) <> 'DELIVERED' then
    raise exception 'transicao valida SENT->DELIVERED deveria ter sido permitida';
  end if;
  begin
    update outbound_messages set subject = 'Assunto alterado' where id = msg_a;
    raise exception 'enforce_outbound_message_immutability deveria ter bloqueado alteracao de subject pos-envio';
  exception when sqlstate '55000' then null;
  end;

  -- enforce_provider_message_write_once: a checagem de provider_message_id (linha 1
  -- da funcao) e redundante com enforce_outbound_message_immutability (0008), que
  -- dispara primeiro por ordem alfabetica de trigger e sempre intercepta antes com
  -- errcode 55000 -- por isso o teste de write-once ja esta coberto acima e nao pode
  -- ser reobservado aqui isoladamente. O que so esta funcao garante e a segunda
  -- checagem, unica ao 0011: um estado AMBIGUOUS nao pode ir direto para REQUESTING
  -- sem reconciliacao humana/job (§17.4 do PILOT-OPERATIONS.md).
  update outbound_messages set provider_state = 'AMBIGUOUS' where id = msg_a;
  begin
    update outbound_messages set provider_state = 'REQUESTING' where id = msg_a;
    raise exception 'enforce_provider_message_write_once deveria ter bloqueado AMBIGUOUS->REQUESTING';
  exception when sqlstate '23514' then null;
  end;
end $$;

-- qualification_gap_evidence_policy: mesma forma/relacao declarada de antes.
do $$
begin
  if (select count(*) from qualification_gap_evidence_policy('NO_WEBSITE')) <> 1
    or exists(
      (select * from qualification_gap_evidence_policy('NO_WEBSITE'))
      except (values ('WEBSITE_REACHABLE'::text, false))
    ) then
    raise exception 'qualification_gap_evidence_policy mudou de comportamento para NO_WEBSITE';
  end if;
end $$;

-- reject_append_only_change: integration_receipts/email_event_effects continuam
-- append-only (a mesma funcao serve as duas tabelas via 0011).
do $$
declare
  user_a uuid := '66666666-6666-6666-6666-666666666666';
begin
  insert into integration_receipts(user_id, provider, external_key, payload_hash)
    values(user_a, 'RESEND', 'hardening-receipt-1', 'hash');
  begin
    update integration_receipts set payload_hash = 'rewritten' where external_key = 'hardening-receipt-1';
    raise exception 'reject_append_only_change deveria ter bloqueado o UPDATE em integration_receipts';
  exception when sqlstate '55000' then null;
  end;
end $$;

-- 6. Chamada valida por service_role continua idempotente e tenant-safe apos o 0012 -

do $$
declare
  user_a uuid := '66666666-6666-6666-6666-666666666666';
  user_b uuid := '77777777-7777-7777-7777-777777777777';
  company_a uuid;
  campaign_a uuid;
  lead_a uuid;
  msg_a uuid;
  event_a uuid;
  is_dup boolean;
  effect_count integer;
begin
  insert into auth.users(id, email) values(user_b, 'hardening-b@test.invalid') on conflict do nothing;
  insert into companies(user_id, name) values(user_a, 'Hardening resend company') returning id into company_a;
  insert into campaigns(user_id, name, status) values(user_a, 'Hardening resend campaign', 'ACTIVE') returning id into campaign_a;
  insert into campaign_leads(user_id, campaign_id, company_id, stage)
    values(user_a, campaign_a, company_a, 'EMAIL_SEQUENCE_ACTIVE') returning id into lead_a;
  insert into outbound_messages(user_id, campaign_lead_id, subject, body_text, to_email, status, provider_message_id, idempotency_key)
    values(user_a, lead_a, 'Assunto', 'Corpo', 'hardening-resend@test.invalid', 'SENT', 'prov-hardening-resend-1', 'idem-hardening-resend-1')
    returning id into msg_a;

  -- service_role e quem realmente chama isto em produção; aqui a sessao de teste roda
  -- como postgres, que tem os mesmos privilegios efetivos para esta chamada.
  perform receive_resend_webhook('evt-hardening-1', 'prov-hardening-resend-1', 'DELIVERED', now(), 'hash-h1', '{}'::jsonb);
  select duplicate into is_dup from receive_resend_webhook('evt-hardening-1', 'prov-hardening-resend-1', 'DELIVERED', now(), 'hash-h1', '{}'::jsonb);
  if is_dup is distinct from true then
    raise exception 'reentrega pos-0012 deveria continuar duplicate=true';
  end if;

  select id into event_a from message_events where message_id = msg_a;
  select count(*) into effect_count from email_event_effects where message_event_id = event_a;
  if effect_count <> 1 then
    raise exception 'reentrega pos-0012 nao pode duplicar efeito (contagem %)', effect_count;
  end if;

  -- Tenant-safe: o efeito pertence ao tenant certo, e a FK composta ainda rejeita
  -- um efeito gravado para o tenant errado sobre o mesmo evento.
  if not exists (select 1 from email_event_effects where message_event_id = event_a and user_id = user_a) then
    raise exception 'efeito nao ficou associado ao tenant correto';
  end if;
  begin
    insert into email_event_effects(user_id, message_event_id, effect_type, effect_key)
      values(user_b, event_a, 'STATUS', 'hardening-wrong-tenant');
    raise exception 'FK deveria rejeitar efeito de outro tenant sobre o mesmo evento';
  exception when foreign_key_violation then null;
  end;
end $$;

rollback;

-- 7. Dados legados: nenhuma empresa ainda-so-v1 avancou no pipeline sem qualificacao v2
--
-- Confirma o estado real, nao inventa uma nova constraint. O sinal certo e "tem v1 e
-- NUNCA recebeu v2" -- nao apenas "tem v1": uma empresa legada que passar por
-- enriquecimento e ganhar uma linha v2 de verdade (o caminho correto, futuro) vai
-- continuar tendo a v1 antiga por auditoria (§36.3, "o score antigo permanece
-- consultavel") e isso NAO pode disparar esta verificacao -- so o atalho (v1 sem
-- jamais ter passado por v2) e que conta como violacao.

do $$
declare
  legacy_only_with_leads integer;
  legacy_only_with_outbound integer;
begin
  select count(*) into legacy_only_with_leads
  from campaign_leads cl
  join companies c on c.id = cl.company_id
  where exists (select 1 from qualification_results q where q.company_id = c.id and q.score_version = 1)
    and not exists (select 1 from qualification_results q where q.company_id = c.id and q.score_version = 2);
  if legacy_only_with_leads <> 0 then
    raise exception 'empresa ainda-so-v1 (nunca requalificada) ja tem campaign_leads (%), pulou enriquecimento/qualificacao v2/aprovacao', legacy_only_with_leads;
  end if;

  select count(*) into legacy_only_with_outbound
  from outbound_messages om
  join campaign_leads cl on cl.id = om.campaign_lead_id
  join companies c on c.id = cl.company_id
  where exists (select 1 from qualification_results q where q.company_id = c.id and q.score_version = 1)
    and not exists (select 1 from qualification_results q where q.company_id = c.id and q.score_version = 2);
  if legacy_only_with_outbound <> 0 then
    raise exception 'empresa ainda-so-v1 (nunca requalificada) ja tem outbound_messages (%), pulou enriquecimento/qualificacao v2/aprovacao', legacy_only_with_outbound;
  end if;
end $$;

select 'security-hardening ok' as resultado;
