-- Durable webhook/dataset idempotency for the pilot. Real execution remains gated.
create table if not exists integration_receipts (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade, provider text not null, external_key text not null, payload_hash text not null, received_at timestamptz not null default now(), unique(user_id,provider,external_key));
alter table integration_receipts enable row level security;
drop policy if exists integration_receipts_own on integration_receipts;
create policy integration_receipts_own on integration_receipts using(auth.uid()=user_id) with check(auth.uid()=user_id);
create unique index if not exists campaign_sources_external_run_key on campaign_sources(user_id,source,external_run_id) where external_run_id is not null;
-- Pilot safety is also represented in persisted campaign/message records.
alter table outbound_messages add column if not exists delivery_mode text not null default 'DRY_RUN' check(delivery_mode in ('DRY_RUN','LIVE'));
alter table outbound_messages add column if not exists provider_state text not null default 'NOT_REQUESTED' check(provider_state in ('NOT_REQUESTED','REQUESTING','ACCEPTED','AMBIGUOUS','REJECTED'));
alter table email_senders add column if not exists activation_checklist_completed_at timestamptz;
alter table campaigns drop constraint if exists campaigns_pilot_daily_limit;
alter table campaigns add constraint campaigns_pilot_daily_limit check(daily_send_limit between 0 and 50);
alter table sequence_steps drop constraint if exists sequence_steps_pilot_max_followup;
alter table sequence_steps add constraint sequence_steps_pilot_max_followup check(step_number between 1 and 2);
