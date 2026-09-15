-- SPEC 2.0 P0/P1 hardening. Incremental: no historical migration or data is rewritten.

-- PostgreSQL SET NULL must only clear the optional member of each tenant-safe key.
do $$
declare
  item text[];
  fixes text[][] := array[
    ['qualification_results','qualification_results_campaign_same_user_fk','campaign_id','campaigns','id','SET NULL'],
    ['campaign_leads','campaign_leads_contact_same_user_fk','contact_id','contacts','id','SET NULL'],
    ['campaign_leads','campaign_leads_qualification_same_user_fk','qualification_id','qualification_results','id','SET NULL'],
    ['sequence_steps','sequence_steps_template_same_user_fk','template_id','email_templates','id','SET NULL'],
    ['campaigns','campaigns_sequence_same_user_fk','sequence_id','sequences','id','SET NULL'],
    ['outbound_messages','outbound_messages_contact_same_user_fk','contact_id','contacts','id','SET NULL'],
    ['outbound_messages','outbound_messages_sender_same_user_fk','sender_id','email_senders','id','SET NULL'],
    ['outbound_messages','outbound_messages_step_same_user_fk','sequence_step_id','sequence_steps','id','SET NULL'],
    ['outbound_messages','outbound_messages_template_same_user_fk','template_id','email_templates','id','SET NULL'],
    ['inbound_messages','inbound_messages_lead_same_user_fk','campaign_lead_id','campaign_leads','id','SET NULL'],
    ['tasks','tasks_contact_same_user_fk','contact_id','contacts','id','SET NULL']
  ];
begin
  foreach item slice 1 in array fixes loop
    execute format('alter table %I drop constraint if exists %I', item[1], item[2]);
    execute format(
      'alter table %I add constraint %I foreign key (%I, user_id) references %I (%I, user_id) on delete set null (%I)',
      item[1], item[2], item[3], item[4], item[5], item[3]
    );
  end loop;
end $$;

-- Complete missing tenant-safe relationships.
do $$
declare
  item text[];
  fixes text[][] := array[
    ['sales_opportunities','sales_opportunities_contact_same_user_fk','contact_id','contacts'],
    ['sales_opportunities','sales_opportunities_campaign_same_user_fk','campaign_id','campaigns'],
    ['inbound_messages','inbound_messages_contact_same_user_fk','contact_id','contacts'],
    ['inbound_messages','inbound_messages_outbound_same_user_fk','outbound_message_id','outbound_messages'],
    ['jobs','jobs_campaign_same_user_fk','campaign_id','campaigns']
  ];
begin
  foreach item slice 1 in array fixes loop
    execute format('alter table %I drop constraint if exists %I', item[1], item[2]);
    execute format(
      'alter table %I add constraint %I foreign key (%I, user_id) references %I (id, user_id) on delete set null (%I)',
      item[1], item[2], item[3], item[4], item[3]
    );
    execute format('create index if not exists %I on %I (%I, user_id)', item[1] || '_' || item[3] || '_fk_idx', item[1], item[3]);
  end loop;
end $$;

-- Qualification history is append-only even for roles which bypass RLS.
create or replace function prevent_qualification_result_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'qualification_results is append-only' using errcode = '55000';
end $$;

drop trigger if exists qualification_results_append_only on qualification_results;
create trigger qualification_results_append_only
  before update or delete on qualification_results
  for each row execute function prevent_qualification_result_mutation();

drop policy if exists qualification_results_update_own on qualification_results;
drop policy if exists qualification_results_delete_own on qualification_results;

-- Preserve the exact payload and references once a provider may have accepted it.
create or replace function enforce_outbound_message_immutability()
returns trigger language plpgsql as $$
begin
  if old.status in ('SENT','DELIVERED','BOUNCED','REPLIED') and
     (new.to_email, new.subject, new.body_text, new.body_html,
      new.contact_id, new.template_id, new.sequence_step_id, new.campaign_lead_id,
      new.sender_id, new.template_version, new.idempotency_key)
       is distinct from
     (old.to_email, old.subject, old.body_text, old.body_html,
      old.contact_id, old.template_id, old.sequence_step_id, old.campaign_lead_id,
      old.sender_id, old.template_version, old.idempotency_key) then
    raise exception 'sent outbound message content is immutable' using errcode = '55000';
  end if;

  if old.provider_message_id is not null and new.provider_message_id is distinct from old.provider_message_id then
    raise exception 'provider message id is write-once' using errcode = '55000';
  end if;

  if new.status is distinct from old.status and not (
    (old.status = 'SCHEDULED' and new.status in ('QUEUED','SENT','CANCELLED','FAILED')) or
    (old.status = 'QUEUED' and new.status in ('SENT','CANCELLED','FAILED')) or
    (old.status = 'SENT' and new.status in ('DELIVERED','BOUNCED','REPLIED')) or
    (old.status = 'DELIVERED' and new.status in ('BOUNCED','REPLIED')) or
    (old.status = 'BOUNCED' and new.status = 'REPLIED')
  ) then
    raise exception 'invalid outbound message status transition: % -> %', old.status, new.status using errcode = '23514';
  end if;
  return new;
end $$;

drop trigger if exists outbound_messages_immutable_after_send on outbound_messages;
create trigger outbound_messages_immutable_after_send
  before update on outbound_messages
  for each row execute function enforce_outbound_message_immutability();

-- READY_FOR_EMAIL is a persisted decision, so enforce evidence independently of TypeScript.
create or replace function enforce_ready_qualification_evidence()
returns trigger language plpgsql as $$
declare required_types text[];
begin
  if new.score_version <> 2 or new.recommended_action <> 'READY_FOR_EMAIL' then return new; end if;
  required_types := case new.primary_gap
    when 'NO_WEBSITE' then array['WEBSITE_REACHABLE']
    when 'WEAK_WEBSITE' then array['WEBSITE_REACHABLE']
    when 'NO_CONVERSION_PAGE' then array['WEBSITE_REACHABLE','HAS_CTA']
    when 'NO_LEAD_CAPTURE' then array['WEBSITE_REACHABLE','HAS_FORM']
    when 'NO_SCHEDULING' then array['WEBSITE_REACHABLE','HAS_SCHEDULING']
    when 'POOR_SERVICE_PRESENTATION' then array['WEBSITE_REACHABLE','HAS_SERVICE_PAGES']
    when 'WEAK_CTA' then array['WEBSITE_REACHABLE','HAS_CTA']
    when 'NO_FAQ' then array['WEBSITE_REACHABLE','HAS_FAQ']
    when 'NO_QUOTE_FLOW' then array['WEBSITE_REACHABLE','HAS_QUOTE_FLOW']
    when 'OUTDATED_INFORMATION' then array['INFORMATION_OUTDATED']
    else array[]::text[] end;
  if new.primary_gap is null or cardinality(new.evidence_ids) = 0 or not exists (
    select 1 from company_observations o
    where o.id = any(new.evidence_ids) and o.user_id = new.user_id and o.company_id = new.company_id
      and o.status in ('OBSERVED','CONFIRMED') and (o.expires_at is null or o.expires_at > new.created_at)
      and o.type = any(required_types) and o.source_url is not null
      and o.value is not null
      and ((new.primary_gap = 'OUTDATED_INFORMATION' and o.value) or
           (new.primary_gap = 'WEAK_WEBSITE' and o.value) or
           (new.primary_gap not in ('OUTDATED_INFORMATION','WEAK_WEBSITE') and not o.value))
  ) then
    raise exception 'READY_FOR_EMAIL requires active compatible same-tenant company evidence' using errcode = '23514';
  end if;
  return new;
end $$;

drop trigger if exists qualification_results_require_evidence on qualification_results;
create trigger qualification_results_require_evidence
  before insert on qualification_results
  for each row execute function enforce_ready_qualification_evidence();
