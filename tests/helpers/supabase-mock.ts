import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Mock generico de Supabase, em memoria, com filtragem real (nao respostas enlatadas).
 *
 * Usado pelos testes de FASE 6 (identidade multi-source, cache, persistencia) porque o
 * pipeline agora conversa com varias tabelas (`companies`, `lead_sources`,
 * `lead_duplicate_candidates`, `discovery_cache`) de formas diferentes (select com
 * filtros compostos, insert, update, upsert) — respostas fixas por teste nao davam mais
 * conta de exercitar o comportamento real (ex.: "o candidato so aparece se a cidade bater").
 *
 * RLS nao e testada aqui — RLS e reforcada pelo Postgres, nao pelo cliente. Foi validada
 * manualmente com sessoes `authenticated` reais contra uma copia local do schema
 * (ver o relatorio da FASE 6).
 */

export type Row = Record<string, unknown>;

type Filter = { column: string; op: 'eq' | 'in'; value: unknown };

function applyFilters(rows: Row[], filters: Filter[]): Row[] {
  return rows.filter((row) =>
    filters.every((f) => {
      if (f.op === 'eq') return row[f.column] === f.value;
      return Array.isArray(f.value) && f.value.includes(row[f.column]);
    }),
  );
}

export type RecordedCall = { table: string; op: string; args: unknown };

export function createSupabaseMock(
  seed: Partial<Record<string, Row[]>> = {},
): { client: SupabaseClient; calls: RecordedCall[]; tables: Record<string, Row[]> } {
  const tables: Record<string, Row[]> = {
    companies: [],
    lead_sources: [],
    lead_duplicate_candidates: [],
    discovery_cache: [],
    prospecting_searches: [],
    company_search_hits: [],
    ...Object.fromEntries(Object.entries(seed).map(([table, rows]) => [table, (rows ?? []).map((r) => ({ ...r }))])),
  };

  const calls: RecordedCall[] = [];
  let counter = 0;
  const genId = () => `generated-${++counter}`;

  function selectChain(table: string, columns: string) {
    const filters: Filter[] = [];
    const resolveRows = () => {
      calls.push({ table, op: 'select', args: { columns, filters } });
      return applyFilters(tables[table] ?? [], filters);
    };
    const chain = {
      eq(column: string, value: unknown) {
        filters.push({ column, op: 'eq', value });
        return chain;
      },
      in(column: string, value: unknown[]) {
        filters.push({ column, op: 'in', value });
        return chain;
      },
      maybeSingle: () => Promise.resolve({ data: resolveRows()[0] ?? null, error: null }),
      single: () => {
        const rows = resolveRows();
        return rows.length
          ? Promise.resolve({ data: rows[0], error: null })
          : Promise.resolve({ data: null, error: { code: 'PGRST116', message: 'not found' } });
      },
      then(onResolve: (v: { data: Row[]; error: null }) => unknown, onReject?: (e: unknown) => unknown) {
        return Promise.resolve({ data: resolveRows(), error: null }).then(onResolve, onReject);
      },
    };
    return chain;
  }

  function updateChain(table: string, patch: Row) {
    const filters: Filter[] = [];
    const chain = {
      eq(column: string, value: unknown) {
        filters.push({ column, op: 'eq', value });
        return chain;
      },
      then(onResolve: (v: { data: null; error: null }) => unknown, onReject?: (e: unknown) => unknown) {
        calls.push({ table, op: 'update', args: { patch, filters } });
        const rows = applyFilters(tables[table] ?? [], filters);
        for (const row of rows) Object.assign(row, patch);
        return Promise.resolve({ data: null, error: null }).then(onResolve, onReject);
      },
    };
    return chain;
  }

  function from(table: string) {
    return {
      select(columns: string) {
        return selectChain(table, columns);
      },
      insert(row: Row | Row[]) {
        const rowsIn = Array.isArray(row) ? row : [row];
        calls.push({ table, op: 'insert', args: { rows: rowsIn } });
        const inserted = rowsIn.map((r) => {
          const created = { id: genId(), ...r };
          tables[table].push(created);
          return created;
        });
        const bare = Promise.resolve({ data: null, error: null });
        return {
          select: () => ({
            single: () => Promise.resolve({ data: inserted[0], error: null }),
          }),
          then: (onResolve: (v: unknown) => unknown, onReject?: (e: unknown) => unknown) =>
            bare.then(onResolve, onReject),
        };
      },
      update(patch: Row) {
        return updateChain(table, patch);
      },
      upsert(row: Row | Row[], opts: { onConflict: string }) {
        const rowsIn = Array.isArray(row) ? row : [row];
        calls.push({ table, op: 'upsert', args: { rows: rowsIn, onConflict: opts.onConflict } });
        const conflictCols = opts.onConflict.split(',');
        const result = rowsIn.map((r) => {
          const existing = (tables[table] ?? []).find((existingRow) =>
            conflictCols.every((c) => existingRow[c] === r[c]),
          );
          if (existing) {
            Object.assign(existing, r);
            return existing;
          }
          const created = { id: genId(), ...r };
          tables[table].push(created);
          return created;
        });
        const bare = Promise.resolve({ data: result, error: null });
        return {
          select: () => Promise.resolve({ data: result, error: null }),
          then: (onResolve: (v: unknown) => unknown, onReject?: (e: unknown) => unknown) =>
            bare.then(onResolve, onReject),
        };
      },
    };
  }

  return { client: { from } as unknown as SupabaseClient, calls, tables };
}
