import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ProspectingSearchInput } from '@/lib/validation/schemas';
import { runProspecting, buildCompanyRow } from '@/lib/prospecting/run';
import { googlePlacesSource } from '@/lib/prospecting/sources/google';
import { computeOpportunityScore } from '@/lib/scoring/score';
import { SOURCE_CAPABILITIES } from '@/lib/prospecting/sources/types';
import { discoverInstagram } from '@/lib/instagram/discover';
import { buildDedupKey } from '@/lib/prospecting/sources/dedupe';

vi.mock('@/lib/instagram/discover', () => ({
  discoverInstagram: vi.fn().mockResolvedValue({
    instagram_url: null,
    instagram_handle: null,
    instagram_confidence: null,
    instagram_status: 'NOT_FOUND',
    instagram_source: null,
    instagram_evidence: [],
    instagram_checked_at: null,
  }),
  NOT_FOUND: {
    instagram_url: null,
    instagram_handle: null,
    instagram_confidence: null,
    instagram_status: 'NOT_FOUND',
    instagram_source: null,
    instagram_evidence: [],
    instagram_checked_at: null,
  },
}));

beforeEach(() => {
  vi.mocked(discoverInstagram).mockClear();
});

const NOMINATIM_RESPONSE = [
  {
    display_name: 'Sao Jose dos Campos, SP',
    lat: '-23.1791',
    lon: '-45.8872',
    boundingbox: ['-23.3', '-23.0', '-46.0', '-45.7'],
  },
];

function overpassElement(id: number, name: string, extraTags: Record<string, string> = {}) {
  return {
    type: 'node',
    id,
    lat: -23.2,
    lon: -45.9,
    tags: { name, shop: 'bakery', ...extraTags },
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Nominatim primeiro, Overpass em seguida — a mesma ordem que openStreetMapSource.search() chama. */
function mockOsmRoundTrip(elements: unknown[]) {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(jsonResponse(NOMINATIM_RESPONSE))
    .mockResolvedValueOnce(jsonResponse({ elements }));
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

type MockResponse<T> = { data: T | null; error: { code?: string; message?: string } | null };
type RecordedCall = { table: string; op: string; args: unknown };

function createSupabaseStub(
  config: {
    existingByPlaceId?: unknown[];
    existingByDedupKey?: unknown[];
    upsertGoogleResult?: MockResponse<unknown[]>;
    upsertOtherResult?: MockResponse<unknown[]>;
  } = {},
) {
  const calls: RecordedCall[] = [];

  function companiesTable() {
    return {
      select() {
        return {
          eq() {
            return {
              in(column: string, values: string[]) {
                calls.push({ table: 'companies', op: 'select.in', args: { column, values } });
                const data =
                  column === 'google_place_id'
                    ? (config.existingByPlaceId ?? [])
                    : (config.existingByDedupKey ?? []);
                return Promise.resolve({ data, error: null });
              },
            };
          },
        };
      },
      upsert(rows: Array<Record<string, unknown>>, opts: { onConflict: string }) {
        calls.push({ table: 'companies', op: 'upsert', args: { onConflict: opts.onConflict, rows } });
        return {
          select() {
            const isGoogle = opts.onConflict.includes('google_place_id');
            const configured = isGoogle ? config.upsertGoogleResult : config.upsertOtherResult;
            const data =
              configured?.data ??
              rows.map((row, i) => ({
                id: `${isGoogle ? 'g' : 'o'}-${i}`,
                opportunity_level: row.opportunity_level,
                website_status: row.website_status,
              }));
            return Promise.resolve(configured ?? { data, error: null });
          },
        };
      },
    };
  }

  function searchesTable() {
    return {
      insert(row: Record<string, unknown>) {
        calls.push({ table: 'prospecting_searches', op: 'insert', args: row });
        return {
          select() {
            return { single: () => Promise.resolve({ data: { id: 'search-1' }, error: null }) };
          },
        };
      },
    };
  }

  function hitsTable() {
    return {
      upsert(rows: unknown[]) {
        calls.push({ table: 'company_search_hits', op: 'upsert', args: rows });
        return Promise.resolve({ data: null, error: null });
      },
    };
  }

  const from = vi.fn((table: string) => {
    if (table === 'companies') return companiesTable();
    if (table === 'prospecting_searches') return searchesTable();
    if (table === 'company_search_hits') return hitsTable();
    throw new Error(`tabela nao mockada: ${table}`);
  });

  return { client: { from } as unknown as SupabaseClient, calls };
}

const BASE_INPUT: ProspectingSearchInput = {
  segment: 'padaria',
  city: 'Sao Jose dos Campos',
  state: 'SP',
  country: 'Brasil',
  limit: 20,
};

async function collectEvents(
  supabase: SupabaseClient,
  userId: string,
  input: ProspectingSearchInput,
) {
  const events = [];
  for await (const event of runProspecting(supabase, userId, input)) {
    events.push(event);
  }
  return events;
}

describe('runProspecting — pesquisa OSM (SPEC 1.2 §7/§74)', () => {
  const originalFetch = global.fetch;
  const originalEnabled = process.env.GOOGLE_PLACES_ENABLED;

  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.GOOGLE_PLACES_ENABLED = originalEnabled;
    vi.restoreAllMocks();
  });

  it('busca no OpenStreetMap, normaliza, pontua e salva via dedup_key', async () => {
    mockOsmRoundTrip([overpassElement(1, 'Padaria Central', { phone: '(12) 3921-0000' })]);
    const { client, calls } = createSupabaseStub();

    const events = await collectEvents(client, 'user-1', BASE_INPUT);

    const done = events.find((e) => e.type === 'done');
    expect(done).toBeDefined();
    if (done?.type !== 'done') throw new Error('esperava evento done');
    expect(done.summary.found).toBe(1);
    expect(done.summary.saved).toBe(1);
    expect(done.summary.status).toBe('COMPLETED');

    const upsertCall = calls.find((c) => c.op === 'upsert');
    expect(upsertCall).toBeDefined();
    const args = upsertCall!.args as { onConflict: string; rows: Array<Record<string, unknown>> };
    // OSM nao tem google_place_id: a identidade de persistencia e o dedup_key (SPEC 1.2 §22).
    expect(args.onConflict).toBe('user_id,dedup_key');
    expect(args.rows[0].google_place_id).toBeNull();
    expect(args.rows[0].name).toBe('Padaria Central');
  });

  it('emite os estagios do pipeline na ordem esperada', async () => {
    mockOsmRoundTrip([overpassElement(1, 'Padaria Central')]);
    const { client } = createSupabaseStub();

    const events = await collectEvents(client, 'user-1', BASE_INPUT);
    const stages = events.filter((e) => e.type === 'stage').map((e) => (e as { stage: string }).stage);

    expect(stages).toEqual(['locating', 'searching', 'processing', 'digital_presence', 'scoring', 'saving', 'done']);
  });

  it('nao chama nenhum endpoint do Google quando o modo e FREE (SPEC 1.2 §74)', async () => {
    const fetchMock = mockOsmRoundTrip([overpassElement(1, 'Padaria Central')]);
    const { client } = createSupabaseStub();

    await collectEvents(client, 'user-1', BASE_INPUT);

    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls.some((url) => url.includes('googleapis.com'))).toBe(false);
  });
});

describe('runProspecting — fonte Google desativada / ausencia de chamada Google (SPEC 1.2 §22/§74)', () => {
  const originalFetch = global.fetch;
  const originalEnabled = process.env.GOOGLE_PLACES_ENABLED;

  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.GOOGLE_PLACES_ENABLED = originalEnabled;
    vi.restoreAllMocks();
  });

  it('mesmo com GOOGLE_PLACES_ENABLED=true, o modo FREE nunca invoca a fonte do Google', async () => {
    process.env.GOOGLE_PLACES_ENABLED = 'true';
    const searchSpy = vi.spyOn(googlePlacesSource, 'search');
    const fetchMock = mockOsmRoundTrip([overpassElement(1, 'Padaria Central')]);
    const { client, calls } = createSupabaseStub();

    await collectEvents(client, 'user-1', BASE_INPUT);

    expect(searchSpy).not.toHaveBeenCalled();
    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls.some((url) => url.includes('googleapis.com'))).toBe(false);
    // Sem lead do Google, o upsert com onConflict de google_place_id nunca acontece.
    const googleUpsert = calls.find(
      (c) => c.op === 'upsert' && (c.args as { onConflict: string }).onConflict === 'user_id,google_place_id',
    );
    expect(googleUpsert).toBeUndefined();
  });
});

describe('runProspecting — deduplicacao (SPEC 1.2 §18/§22)', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('dois elementos OSM que colidem no dedup_key viram uma unica linha persistida', async () => {
    mockOsmRoundTrip([
      overpassElement(1, 'Padaria Central', { phone: '(12) 3921-0000', 'addr:street': 'Rua A' }),
      overpassElement(2, 'Padaria Central', { phone: '(12) 3921-0000', 'addr:street': 'Rua A' }),
    ]);
    const { client, calls } = createSupabaseStub();

    const events = await collectEvents(client, 'user-1', BASE_INPUT);
    const done = events.find((e) => e.type === 'done');
    if (done?.type !== 'done') throw new Error('esperava evento done');

    expect(done.summary.found).toBe(1);
    const upsertCall = calls.find((c) => c.op === 'upsert');
    const args = upsertCall!.args as { rows: unknown[] };
    expect(args.rows).toHaveLength(1);
  });
});

describe('runProspecting — score relativo a fonte e source_coverage (SPEC 1.2 §34/§35)', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('leads do OSM carregam source_data com source, source_id e source_coverage MEDIUM', async () => {
    mockOsmRoundTrip([overpassElement(1, 'Padaria Central', { phone: '(12) 3921-0000' })]);
    const { client, calls } = createSupabaseStub();

    await collectEvents(client, 'user-1', BASE_INPUT);

    const upsertCall = calls.find((c) => c.op === 'upsert');
    const args = upsertCall!.args as { rows: Array<Record<string, unknown>> };
    const row = args.rows[0];
    const sourceData = row.source_data as { source: string; source_id: string; source_coverage: { level: string } };

    expect(sourceData.source).toBe('OPENSTREETMAP');
    expect(sourceData.source_id).toBe('node/1');
    expect(sourceData.source_coverage.level).toBe('MEDIUM');
    // Cobertura MEDIUM nunca deixa o lead chegar a EXCELENTE (guarda contra inflacao).
    expect(row.opportunity_level).not.toBe('EXCELENTE');
  });

  it('rating/reviews ausentes no OSM nao aparecem no breakdown nem penalizam o score', async () => {
    mockOsmRoundTrip([overpassElement(1, 'Padaria Central', { phone: '(12) 3921-0000' })]);
    const { client, calls } = createSupabaseStub();

    await collectEvents(client, 'user-1', BASE_INPUT);

    const upsertCall = calls.find((c) => c.op === 'upsert');
    const row = (upsertCall!.args as { rows: Array<Record<string, unknown>> }).rows[0];
    const breakdown = row.score_breakdown as Array<{ code: string }>;

    expect(breakdown.some((b) => b.code === 'HIGH_RATING')).toBe(false);
    expect(breakdown.some((b) => b.code === 'REVIEW_COUNT')).toBe(false);
    expect(breakdown.some((b) => b.code === 'NO_WEBSITE')).toBe(true);
  });

  it('OSM nunca vira LOW em google_business_quality (ajuste da FASE 4, SPEC 1.2 §34)', async () => {
    mockOsmRoundTrip([overpassElement(1, 'Padaria Central', { phone: '(12) 3921-0000' })]);
    const { client, calls } = createSupabaseStub();

    await collectEvents(client, 'user-1', BASE_INPUT);

    const upsertCall = calls.find((c) => c.op === 'upsert');
    const row = (upsertCall!.args as { rows: Array<Record<string, unknown>> }).rows[0];

    expect(row.google_business_quality).toBe('NOT_APPLICABLE');
    // Este lead cai em LOW_PRIORITY porque o score (35) fica abaixo do limiar de baixa
    // prioridade — nao porque quality e NOT_APPLICABLE. O isolamento exato desse efeito
    // (mesma acao com HIGH e com NOT_APPLICABLE, mesmo score) esta em tests/qualification.test.ts.
    expect(row.opportunity_score).toBeLessThan(40);
    expect(row.next_action).toBe('LOW_PRIORITY');
  });
});

describe('runProspecting — empresa OSM ja conhecida (busca por dedup_key)', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('decisao humana (CONFIRMED) e preservada e o Instagram nao e reconsultado', async () => {
    mockOsmRoundTrip([overpassElement(1, 'Padaria Central', { phone: '(12) 3921-0000' })]);
    const key = buildDedupKey({
      name: 'Padaria Central',
      phone: '(12) 3921-0000',
      address: null,
      latitude: -23.2,
      longitude: -45.9,
    });
    const { client, calls } = createSupabaseStub({
      existingByDedupKey: [
        {
          id: 'existing-1',
          google_place_id: null,
          dedup_key: key,
          instagram_url: 'https://instagram.com/padariacentral',
          instagram_handle: 'padariacentral',
          instagram_confidence: 100,
          instagram_status: 'CONFIRMED',
          instagram_source: 'manual',
          instagram_evidence: [],
          instagram_checked_at: new Date().toISOString(),
          last_checked_at: new Date().toISOString(),
        },
      ],
    });

    const events = await collectEvents(client, 'user-1', BASE_INPUT);
    const done = events.find((e) => e.type === 'done');
    if (done?.type !== 'done') throw new Error('esperava evento done');

    expect(done.summary.alreadyKnown).toBe(1);
    expect(done.summary.newCompanies).toBe(0);
    expect(vi.mocked(discoverInstagram)).not.toHaveBeenCalled();

    const upsertCall = calls.find((c) => c.op === 'upsert');
    const row = (upsertCall!.args as { rows: Array<Record<string, unknown>> }).rows[0];
    expect(row.instagram_status).toBe('CONFIRMED');
    expect(row.instagram_url).toBe('https://instagram.com/padariacentral');
  });
});

describe('buildCompanyRow — regressao do score do Google (SPEC 1.2 §35)', () => {
  it('produz o mesmo score/nivel que a 1.1 para uma fonte de capacidade plena', () => {
    const business = {
      source: 'GOOGLE_PLACES' as const,
      sourceId: 'ChIJ123',
      name: 'Cantina da Nona',
      category: 'Restaurante',
      categories: ['restaurant'],
      description: 'Restaurante italiano',
      phone: '(12) 99999-0000',
      phoneInternational: '+55 12 99999-0000',
      website: null,
      websiteStatus: 'NO_WEBSITE_DETECTED' as const,
      sourceUrl: 'https://maps.google.com/?cid=1',
      address: 'Rua A, 100',
      city: 'Sao Jose dos Campos',
      state: 'SP',
      country: 'BR',
      latitude: -23.17,
      longitude: -45.88,
      rating: 4.8,
      reviewCount: 183,
      openingHours: ['segunda: 09:00-18:00'],
      businessStatus: 'OPERATIONAL',
    };

    const outcome = {
      instagram: {
        instagram_url: 'https://instagram.com/empresa',
        instagram_handle: 'empresa',
        instagram_confidence: 95,
        instagram_status: 'PENDING' as const,
        instagram_source: 'official_site',
        instagram_evidence: [],
        instagram_checked_at: new Date().toISOString(),
      },
      status: 'OK' as const,
      error: null,
      fromCache: false,
    };

    const row = buildCompanyRow('user-1', business, outcome);

    const expectedScore = computeOpportunityScore(
      {
        website_status: business.websiteStatus,
        rating: business.rating,
        review_count: business.reviewCount,
        phone: business.phone,
        instagram_url: outcome.instagram.instagram_url,
        instagram_confidence: outcome.instagram.instagram_confidence,
        instagram_status: outcome.instagram.instagram_status,
        business_status: business.businessStatus,
        address: business.address,
        category: business.category,
        opening_hours: business.openingHours,
        description: business.description,
        google_maps_url: business.sourceUrl,
      },
      SOURCE_CAPABILITIES.GOOGLE_PLACES,
    );

    expect(row.opportunity_score).toBe(expectedScore.score);
    expect(row.opportunity_score).toBe(97);
    expect(row.opportunity_level).toBe('EXCELENTE');
    expect(row.google_place_id).toBe('ChIJ123');
  });
});
