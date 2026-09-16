#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; CLEAN="${CLEAN_DB:-qualificalead_clean}"; INCR="${INCREMENTAL_DB:-qualificalead_incremental}"
for db in "$CLEAN" "$INCR"; do dropdb --if-exists "$db"; createdb "$db"; psql -v ON_ERROR_STOP=1 -q -d "$db" -f "$ROOT/database/tests/supabase-shim.sql"; done
for m in "$ROOT"/database/migrations/*.sql; do psql -v ON_ERROR_STOP=1 -q -d "$CLEAN" -f "$m"; done
for m in "$ROOT"/database/migrations/000{1..7}_*.sql; do psql -v ON_ERROR_STOP=1 -q -d "$INCR" -f "$m"; done
for m in "$ROOT"/database/migrations/00{08,09,10,11}_*.sql; do psql -v ON_ERROR_STOP=1 -q -d "$INCR" -f "$m"; done
for db in "$CLEAN" "$INCR"; do psql -v ON_ERROR_STOP=1 -q -d "$db" -f "$ROOT/database/tests/migration-assertions.sql"; psql -v ON_ERROR_STOP=1 -q -d "$db" -f "$ROOT/database/tests/pilot-behavior.sql"; psql -v ON_ERROR_STOP=1 -q -d "$db" -f "$ROOT/database/tests/pilot-integration-journey.sql"; done
