#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Aplica todas as migracoes num PostgreSQL local, duas vezes (SPEC 2.0 §32.4):
#
#   1. banco vazio      — a instalacao de alguem comecando hoje;
#   2. banco atualizado — a segunda execucao precisa ser um no-op, porque na
#      pratica migracoes sao reexecutadas (deploy repetido, recuperacao de erro).
#
# Uso: PGHOST=... PGPORT=... PGUSER=... ./scripts/verify-migrations.sh
# ---------------------------------------------------------------------------
set -euo pipefail

DB_NAME="${DB_NAME:-leadhunter_migration_check}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

psql -v ON_ERROR_STOP=1 -q -d postgres -c "drop database if exists ${DB_NAME}"
psql -v ON_ERROR_STOP=1 -q -d postgres -c "create database ${DB_NAME}"

apply_all() {
  local label="$1"
  echo "--- ${label} ---"
  psql -v ON_ERROR_STOP=1 -q -d "${DB_NAME}" -f "${ROOT}/database/tests/supabase-shim.sql"
  for migration in "${ROOT}"/database/migrations/*.sql; do
    echo "    $(basename "${migration}")"
    psql -v ON_ERROR_STOP=1 -q -d "${DB_NAME}" -f "${migration}"
  done
}

apply_all "banco vazio"
apply_all "banco atualizado (reexecucao)"

echo "--- verificacao ---"
psql -v ON_ERROR_STOP=1 -q -d "${DB_NAME}" -f "${ROOT}/database/tests/migration-assertions.sql"
