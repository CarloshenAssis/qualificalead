-- Security hardening. Incremental: 0001-0011 stay untouched, already applied to production.
--
-- Two independent fixes, both flagged by the Supabase security advisor after 0011:
--
-- 1. RPC privileges. `revoke all ... from public` in 0011 did not close the gap it
--    looked like it closed. Supabase's own project bootstrap grants EXECUTE on every
--    new public-schema function to anon/authenticated/service_role directly, via
--    ALTER DEFAULT PRIVILEGES -- a separate grant from PUBLIC's. Revoking PUBLIC's
--    grant never touches that. The advisor confirms this precisely: after 0011,
--    `public_grant_exists` is false for both webhook RPCs, but anon and authenticated
--    can still call them. This migration revokes the role-specific grants directly.
--
-- 2. Mutable search_path on six SECURITY INVOKER trigger/helper functions (confirmed
--    via pg_proc.prosecdef = false for all six -- none of them are SECURITY DEFINER,
--    so this is not a privilege-escalation path the way it would be for a definer
--    function, but it is still the linter's standing recommendation and costs nothing
--    to close). Fixed with ALTER FUNCTION ... SET search_path, which changes no
--    function body -- behavior is unchanged, only name resolution during execution is
--    pinned. pg_catalog is never listed, so it stays implicitly first per Postgres's
--    own rule, ahead of any schema a caller could otherwise influence.

-- 1. RPC privileges -----------------------------------------------------------------

-- receive_apify_webhook / receive_resend_webhook: SECURITY DEFINER, called exclusively
-- by the webhook routes via createAdminClient() (service_role) -- confirmed by reading
-- app/api/webhooks/apify/route.ts and app/api/webhooks/email/route.ts. No other call
-- site exists in the codebase. Callable directly through PostgREST by anon or
-- authenticated is not "the route already checks a signature" being insufficient --
-- it is a second, independent way to reach a SECURITY DEFINER function that the route
-- was supposed to be the only door to.

revoke execute on function receive_apify_webhook(text,text,text,text,jsonb) from public;
revoke execute on function receive_apify_webhook(text,text,text,text,jsonb) from anon;
revoke execute on function receive_apify_webhook(text,text,text,text,jsonb) from authenticated;
grant execute on function receive_apify_webhook(text,text,text,text,jsonb) to service_role;

revoke execute on function receive_resend_webhook(text,text,email_event_type,timestamptz,text,jsonb) from public;
revoke execute on function receive_resend_webhook(text,text,email_event_type,timestamptz,text,jsonb) from anon;
revoke execute on function receive_resend_webhook(text,text,email_event_type,timestamptz,text,jsonb) from authenticated;
grant execute on function receive_resend_webhook(text,text,email_event_type,timestamptz,text,jsonb) to service_role;

-- start_apify_collection: SECURITY INVOKER, and its only real call site is
-- app/(app)/campaigns/actions.ts, using createClient() -- the user's own session,
-- role authenticated, relying on auth.uid() plus RLS to scope to the caller's own
-- campaign. That is a legitimate, necessary use of `authenticated`: revoking it would
-- break campaign collection for every real user. anon has no legitimate reason to
-- call it (auth.uid() would resolve to null, so every call would fail with "campaign
-- not found" anyway, but least privilege says it should not be offered the attempt).
-- service_role is left untouched: nothing in the codebase calls it that way, and
-- revoking a grant nothing depends on is not part of this fix.

revoke execute on function start_apify_collection(uuid,text,text,jsonb,integer) from public;
revoke execute on function start_apify_collection(uuid,text,text,jsonb,integer) from anon;
grant execute on function start_apify_collection(uuid,text,text,jsonb,integer) to authenticated;

-- 2. search_path on the six flagged SECURITY INVOKER functions -----------------------
-- ALTER FUNCTION ... SET search_path never touches the function body: the fix is
-- exactly as safe as it looks, and there is nothing to regress.

alter function prevent_qualification_result_mutation() set search_path = public, pg_temp;
alter function enforce_outbound_message_immutability() set search_path = public, pg_temp;
alter function enforce_ready_qualification_evidence() set search_path = public, pg_temp;
alter function qualification_gap_evidence_policy(text) set search_path = public, pg_temp;
alter function reject_append_only_change() set search_path = public, pg_temp;
alter function enforce_provider_message_write_once() set search_path = public, pg_temp;
