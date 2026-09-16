#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLEAN_DB="${DB_NAME:-leadhunter_migration_check}"
UPGRADE_DB="${UPGRADE_DB_NAME:-leadhunter_upgrade_check}"

recreate(){ psql -v ON_ERROR_STOP=1 -q -d postgres -c "drop database if exists $1";psql -v ON_ERROR_STOP=1 -q -d postgres -c "create database $1";psql -v ON_ERROR_STOP=1 -q -d "$1" -f "$ROOT/database/tests/supabase-shim.sql"; }
apply_range(){ local db="$1" first="$2" last="$3" file n;for file in "$ROOT"/database/migrations/*.sql;do n="$(basename "$file" | cut -c1-4)";if ((10#$n >= 10#$first && 10#$n <= 10#$last));then echo "$db: $(basename "$file")";psql -v ON_ERROR_STOP=1 -q -d "$db" -f "$file";fi;done; }

recreate "$CLEAN_DB";apply_range "$CLEAN_DB" 0001 0011
psql -v ON_ERROR_STOP=1 -q -d "$CLEAN_DB" -f "$ROOT/database/tests/migration-assertions.sql"
psql -v ON_ERROR_STOP=1 -q -d "$CLEAN_DB" -f "$ROOT/database/tests/evidence-policy.sql"
psql -v ON_ERROR_STOP=1 -q -d "$CLEAN_DB" -f "$ROOT/database/tests/operational-wiring.sql"
psql -v ON_ERROR_STOP=1 -q -d "$CLEAN_DB" -f "$ROOT/database/tests/rpc-idempotency.sql"
psql -v ON_ERROR_STOP=1 -q -d "$CLEAN_DB" -f "$ROOT/database/tests/rls.sql"

recreate "$UPGRADE_DB";apply_range "$UPGRADE_DB" 0001 0007;apply_range "$UPGRADE_DB" 0008 0011
psql -v ON_ERROR_STOP=1 -q -d "$UPGRADE_DB" -f "$ROOT/database/tests/migration-assertions.sql"
psql -v ON_ERROR_STOP=1 -q -d "$UPGRADE_DB" -f "$ROOT/database/tests/evidence-policy.sql"
psql -v ON_ERROR_STOP=1 -q -d "$UPGRADE_DB" -f "$ROOT/database/tests/operational-wiring.sql"
psql -v ON_ERROR_STOP=1 -q -d "$UPGRADE_DB" -f "$ROOT/database/tests/rpc-idempotency.sql"
psql -v ON_ERROR_STOP=1 -q -d "$UPGRADE_DB" -f "$ROOT/database/tests/rls.sql"
