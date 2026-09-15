# SPEC 2.0 hardening decisions

The incremental `0008_spec2_hardening.sql` preserves all existing rows and the v1
backfill. It repairs optional composite foreign keys without clearing `user_id`,
adds the missing tenant-safe relationships, makes qualification history append-only,
and protects sent-message payloads with database triggers.

Automatic e-mail decisions use a positive allowlist (`VALID`, `ROLE_BASED`, and
`ACCEPT_ALL`); all other and future verification states fail closed. Only pipeline
stages `APPROVED_FOR_EMAIL` and `EMAIL_SEQUENCE_ACTIVE` may send.

`READY_FOR_EMAIL` requires a confirmed primary gap and an active, compatible
observation belonging to the same tenant and company. `NO_WEBSITE` specifically
requires an explicit negative `WEBSITE_REACHABLE` observation with source and time;
a missing record or a null result is not evidence. Both domain code and persistence
enforce this invariant.

Legacy score v1 vocabulary remains unchanged and is represented separately from
v2. Callers must explicitly reject or convert v1 before using v2-only behavior.
Provider events use explicit state transitions; incompatible late events remain
suitable for event-log audit but cannot regress materialized delivery state.

No external provider, route, screen, or automated WhatsApp behavior is introduced.
