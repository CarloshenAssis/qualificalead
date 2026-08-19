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

type Filter = {
  column: string;
  op: 'eq' | 'in' | 'gt' | 'gte' | 'ilike' | 'is_null' | 'not_null' | 'contains';
  value: unknown;
};

/** `%termo%` (ilike do PostgREST) — sempre case-insensitive. */
function ilikeMatch(cellValue: unknown, pattern: string): boolean {
  if (typeof cellValue !== 'string') return false;
  const needle = pattern.replace(/^%/, '').replace(/%$/, '').toLowerCase();
  return cellValue.toLowerCase().includes(needle);
}

function applyFilters(rows: Row[], filters: Filter[]): Row[] {
  return rows.filter((row) =>
    filters.every((f) => {
      const cell = row[f.column];
      switch (f.op) {
        case 'eq':
          return cell === f.value;
        case 'in':
          return Array.isArray(f.value) && f.value.includes(cell);
        case 'gt':
          return typeof cell === 'number' && cell > (f.value as number);
        case 'gte':
          return typeof cell === 'number' && cell >= (f.value as number);
        case 'ilike':
          return ilikeMatch(cell, f.value as string);
        case 'is_null':
          return cell === null || cell === undefined;
        case 'not_null':
          return cell !== null && cell !== undefined;
        case 'contains':
          return Array.isArray(cell) && (f.value as unknown[]).every((v) => cell.includes(v));
      }
    }),
  );
}

type OrderSpec = { column: string; ascending: boolean };

function applyOrder(rows: Row[], orders: OrderSpec[]): Row[] {
  if (!orders.length) return rows;
  return [...rows].sort((a, b) => {
    for (const { column, ascending } of orders) {
      const av = a[column];
      const bv = b[column];
      // nullsFirst: false (unico modo usado hoje) — nulos sempre por ultimo, independente da direcao.
      if ((av === null || av === undefined) && (bv === null || bv === undefined)) continue;
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      if (av === bv) continue;
      const cmp = av < bv ? -1 : 1;
      return ascending ? cmp : -cmp;
    }
    return 0;
  });
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

  function selectChain(table: string, columns: string, withCount: boolean) {
    const filters: Filter[] = [];
    const orders: OrderSpec[] = [];
    let range: { from: number; to: number } | null = null;
    let limitTo: number | null = null;

    const resolveAll = () => {
      calls.push({ table, op: 'select', args: { columns, filters } });
      return applyOrder(applyFilters(tables[table] ?? [], filters), orders);
    };
    const resolveRows = () => {
      const all = resolveAll();
      const paged = range ? all.slice(range.from, range.to + 1) : limitTo !== null ? all.slice(0, limitTo) : all;
      return { rows: paged, count: withCount ? all.length : null };
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
      gt(column: string, value: unknown) {
        filters.push({ column, op: 'gt', value });
        return chain;
      },
      gte(column: string, value: unknown) {
        filters.push({ column, op: 'gte', value });
        return chain;
      },
      ilike(column: string, value: string) {
        filters.push({ column, op: 'ilike', value });
        return chain;
      },
      contains(column: string, value: unknown[]) {
        filters.push({ column, op: 'contains', value });
        return chain;
      },
      is(column: string, value: null) {
        filters.push({ column, op: value === null ? 'is_null' : 'eq', value });
        return chain;
      },
      not(column: string, _operator: string, value: unknown) {
        filters.push({ column, op: value === null ? 'not_null' : 'eq', value });
        return chain;
      },
      order(column: string, opts?: { ascending?: boolean }) {
        orders.push({ column, ascending: opts?.ascending ?? true });
        return chain;
      },
      range(from: number, to: number) {
        range = { from, to };
        return chain;
      },
      limit(n: number) {
        limitTo = n;
        return chain;
      },
      maybeSingle: () => Promise.resolve({ data: resolveRows().rows[0] ?? null, error: null }),
      single: () => {
        const { rows } = resolveRows();
        return rows.length
          ? Promise.resolve({ data: rows[0], error: null })
          : Promise.resolve({ data: null, error: { code: 'PGRST116', message: 'not found' } });
      },
      then(
        onResolve: (v: { data: Row[]; error: null; count: number | null }) => unknown,
        onReject?: (e: unknown) => unknown,
      ) {
        const { rows, count } = resolveRows();
        return Promise.resolve({ data: rows, error: null, count }).then(onResolve, onReject);
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
      select(columns: string, opts?: { count?: 'exact' }) {
        return selectChain(table, columns, opts?.count === 'exact');
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
