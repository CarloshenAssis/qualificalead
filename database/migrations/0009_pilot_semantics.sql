-- Pilot hardening: conjunctive evidence semantics and persistent side-effect idempotency.

create or replace function qualification_gap_evidence_policy(gap text)
returns table(observation_type text, expected_value boolean)
language sql immutable parallel safe as $$
  select * from (values
    ('NO_WEBSITE','WEBSITE_REACHABLE',false),
    ('NO_CONVERSION_PAGE','WEBSITE_REACHABLE',true), ('NO_CONVERSION_PAGE','HAS_CTA',false),
    ('NO_LEAD_CAPTURE','WEBSITE_REACHABLE',true), ('NO_LEAD_CAPTURE','HAS_FORM',false),
    ('NO_SCHEDULING','WEBSITE_REACHABLE',true), ('NO_SCHEDULING','HAS_SCHEDULING',false),
    ('POOR_SERVICE_PRESENTATION','WEBSITE_REACHABLE',true), ('POOR_SERVICE_PRESENTATION','HAS_SERVICE_PAGES',false),
    ('WEAK_CTA','WEBSITE_REACHABLE',true), ('WEAK_CTA','HAS_CTA',false),
    ('NO_FAQ','WEBSITE_REACHABLE',true), ('NO_FAQ','HAS_FAQ',false),
    ('NO_QUOTE_FLOW','WEBSITE_REACHABLE',true), ('NO_QUOTE_FLOW','HAS_QUOTE_FLOW',false),
    ('OUTDATED_INFORMATION','INFORMATION_OUTDATED',true)
  ) p(gap_type, observation_type, expected_value) where p.gap_type = gap
$$;

create or replace function enforce_ready_qualification_evidence()
returns trigger language plpgsql as $$
declare required_count integer; matching_count integer;
begin
  if new.score_version <> 2 or new.recommended_action <> 'READY_FOR_EMAIL' then return new; end if;
  select count(*) into required_count from qualification_gap_evidence_policy(new.primary_gap);
  if required_count = 0 then
    raise exception 'READY_FOR_EMAIL gap requires human review' using errcode = '23514';
  end if;
  select count(distinct p.observation_type) into matching_count
  from qualification_gap_evidence_policy(new.primary_gap) p
  where exists (select 1 from company_observations o
    where o.id = any(new.evidence_ids) and o.user_id = new.user_id and o.company_id = new.company_id
      and o.status in ('OBSERVED','CONFIRMED') and (o.expires_at is null or o.expires_at > new.created_at)
      and o.source_url is not null and o.type = p.observation_type and o.value = p.expected_value);
  if matching_count <> required_count then
    raise exception 'READY_FOR_EMAIL requires all semantic evidence clauses' using errcode = '23514';
  end if;
  return new;
end $$;

-- Durable ledger: audit events and effects are separate, so an incompatible event
-- remains visible without accidentally replaying suppression/tasks/pipeline work.
create table if not exists email_event_effects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  message_event_id uuid not null,
  effect_type text not null check (effect_type in ('STATUS','SUPPRESSION','CANCEL_SEQUENCE','ALERT','TASK','PIPELINE')),
  effect_key text not null,
  applied_at timestamptz not null default now(),
  unique (user_id, effect_key),
  foreign key (message_event_id, user_id) references message_events(id, user_id) on delete cascade
);
alter table email_event_effects enable row level security;
drop policy if exists email_event_effects_own on email_event_effects;
create policy email_event_effects_own on email_event_effects using (auth.uid() = user_id) with check (auth.uid() = user_id);
