import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProspectingSearchInput } from '@/lib/validation/schemas';
import { runProspecting, buildCompanyRow } from '@/lib/prospecting/run';
import { googlePlacesSource } from '@/lib/prospecting/sources/google';
import { computeOpportunityScore } from '@/lib/scoring/score';
import { SOURCE_CAPABILITIES } from '@/lib/prospecting/sources/types';
import { discoverInstagram } from '@/lib/instagram/discover';
import { createSupabaseMock, type Row } from './helpers/supabase-mock';

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

const BASE_INPUT: ProspectingSearchInput = {
  segment: 'padaria',
  city: 'Sao Jose dos Campos',
  state: 'SP',
  country: 'Brasil',
  limit: 20,
};

async function collectEvents(client: ReturnType<typeof createSupabaseMock>['client'], userId: string, input: ProspectingSearchInput) {
  const events = [];
  for await (const event of runProspecting(client, userId, input)) {
    events.push(event);
  }
  return events;
}

describe('runProspecting — pesquisa OSM (SPEC 1.2 §7/§74)', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('busca no OpenStreetMap, normaliza, pontua e salva com uma linha em lead_sources', async () => {
    mockOsmRoundTrip([overpassElement(1, 'Padaria Central', { phone: '(12) 3921-0000' })]);
    const { client, tables } = createSupabaseMock();

    const events = await collectEvents(client, 'user-1', BASE_INPUT);

    const done = events.find((e) => e.type === 'done');
    expect(done).toBeDefined();
    if (done?.type !== 'done') throw new Error('esperava evento done');
    expect(done.summary.found).toBe(1);
    expect(done.summary.saved).toBe(1);
    expect(done.summary.newCompanies).toBe(1);
    expect(done.summary.status).toBe('COMPLETED');

    expect(tables.companies).toHaveLength(1);
    expect(tables.companies[0].name).toBe('Padaria Central');
    // OSM nao usa google_place_id como identidade (SPEC 1.2 FASE 6).
    expect(tables.companies[0].google_place_id).toBeNull();

    expect(tables.lead_sources).toHaveLength(1);
    expect(tables.lead_sources[0]).toMatchObject({
      source: 'OPENSTREETMAP',
      source_id: 'node/1',
      company_id: tables.companies[0].id,
    });
  });

  it('emite os estagios do pipeline na ordem esperada', async () => {
    mockOsmRoundTrip([overpassElement(1, 'Padaria Central')]);
    const { client } = createSupabaseMock();

    const events = await collectEvents(client, 'user-1', BASE_INPUT);
    const stages = events.filter((e) => e.type === 'stage').map((e) => (e as { stage: string }).stage);

    expect(stages).toEqual(['locating', 'searching', 'processing', 'digital_presence', 'scoring', 'saving', 'done']);
  });

  it('nao chama nenhum endpoint do Google quando o modo e FREE (SPEC 1.2 §74)', async () => {
    const fetchMock = mockOsmRoundTrip([overpassElement(1, 'Padaria Central')]);
    const { client } = createSupabaseMock();

    await collectEvents(client, 'user-1', BASE_INPUT);

    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls.some((url) => url.includes('googleapis.com'))).toBe(false);
  });
});

describe('runProspecting — fonte Google desativada / ausencia de chamada Google (SPEC 1.2 §22/§74, FASE 5)', () => {
  const originalFetch = global.fetch;
  const originalEnabled = process.env.GOOGLE_PLACES_ENABLED;
  const originalKey = process.env.GOOGLE_MAPS_API_KEY;

  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.GOOGLE_PLACES_ENABLED = originalEnabled;
    process.env.GOOGLE_MAPS_API_KEY = originalKey;
    vi.restoreAllMocks();
  });

  it('mesmo com GOOGLE_PLACES_ENABLED=true, o modo FREE nunca invoca a fonte do Google', async () => {
    process.env.GOOGLE_PLACES_ENABLED = 'true';
    const searchSpy = vi.spyOn(googlePlacesSource, 'search');
    const fetchMock = mockOsmRoundTrip([overpassElement(1, 'Padaria Central')]);
    const { client, tables } = createSupabaseMock();

    await collectEvents(client, 'user-1', BASE_INPUT);

    expect(searchSpy).not.toHaveBeenCalled();
    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls.some((url) => url.includes('googleapis.com'))).toBe(false);
    expect(tables.lead_sources.every((r) => r.source !== 'GOOGLE_PLACES')).toBe(true);
  });

  it('GOOGLE_MAPS_API_KEY presente sem GOOGLE_PLACES_ENABLED continua sem nenhuma chamada Google', async () => {
    delete process.env.GOOGLE_PLACES_ENABLED;
    process.env.GOOGLE_MAPS_API_KEY = 'a-real-looking-key';
    const searchSpy = vi.spyOn(googlePlacesSource, 'search');
    const fetchMock = mockOsmRoundTrip([overpassElement(1, 'Padaria Central')]);
    const { client } = createSupabaseMock();

    await collectEvents(client, 'user-1', BASE_INPUT);

    expect(searchSpy).not.toHaveBeenCalled();
    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls.some((url) => url.includes('googleapis.com'))).toBe(false);
  });

  it('OSM falhando nao dispara fallback automatico para o Google (SPEC 1.2 regra 6)', async () => {
    process.env.GOOGLE_PLACES_ENABLED = 'true';
    process.env.GOOGLE_MAPS_API_KEY = 'a-real-looking-key';
    const searchSpy = vi.spyOn(googlePlacesSource, 'search');
    // Nominatim falha logo na primeira chamada: OSM e a unica fonte selecionada e ela cai por inteiro.
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 503 }));
    global.fetch = fetchMock as unknown as typeof fetch;
    const { client } = createSupabaseMock();

    const events = await collectEvents(client, 'user-1', BASE_INPUT);

    expect(searchSpy).not.toHaveBeenCalled();
    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls.some((url) => url.includes('googleapis.com'))).toBe(false);
    // A falha e reportada com honestidade, nao escondida atras de um fallback silencioso.
    expect(events.some((e) => e.type === 'error')).toBe(true);
    expect(events.some((e) => e.type === 'done')).toBe(false);
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
    const { client, tables } = createSupabaseMock();

    const events = await collectEvents(client, 'user-1', BASE_INPUT);
    const done = events.find((e) => e.type === 'done');
    if (done?.type !== 'done') throw new Error('esperava evento done');

    expect(done.summary.found).toBe(1);
    expect(tables.companies).toHaveLength(1);
    expect(tables.lead_sources).toHaveLength(1);
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
    const { client, tables } = createSupabaseMock();

    await collectEvents(client, 'user-1', BASE_INPUT);

    const row = tables.companies[0];
    const sourceData = row.source_data as { source: string; source_id: string; source_coverage: { level: string } };

    expect(sourceData.source).toBe('OPENSTREETMAP');
    expect(sourceData.source_id).toBe('node/1');
    expect(sourceData.source_coverage.level).toBe('MEDIUM');
    // Cobertura MEDIUM nunca deixa o lead chegar a EXCELENTE (guarda contra inflacao).
    expect(row.opportunity_level).not.toBe('EXCELENTE');
  });

  it('rating/reviews ausentes no OSM nao aparecem no breakdown nem penalizam o score', async () => {
    mockOsmRoundTrip([overpassElement(1, 'Padaria Central', { phone: '(12) 3921-0000' })]);
    const { client, tables } = createSupabaseMock();

    await collectEvents(client, 'user-1', BASE_INPUT);

    const breakdown = tables.companies[0].score_breakdown as Array<{ code: string }>;

    expect(breakdown.some((b) => b.code === 'HIGH_RATING')).toBe(false);
    expect(breakdown.some((b) => b.code === 'REVIEW_COUNT')).toBe(false);
    expect(breakdown.some((b) => b.code === 'NO_WEBSITE')).toBe(true);
  });

  it('OSM nunca vira LOW em google_business_quality (ajuste da FASE 4, SPEC 1.2 §34)', async () => {
    mockOsmRoundTrip([overpassElement(1, 'Padaria Central', { phone: '(12) 3921-0000' })]);
    const { client, tables } = createSupabaseMock();

    await collectEvents(client, 'user-1', BASE_INPUT);

    const row = tables.companies[0];
    expect(row.google_business_quality).toBe('NOT_APPLICABLE');
    // Este lead cai em LOW_PRIORITY porque o score (35) fica abaixo do limiar de baixa
    // prioridade — nao porque quality e NOT_APPLICABLE. O isolamento exato desse efeito
    // (mesma acao com HIGH e com NOT_APPLICABLE, mesmo score) esta em tests/qualification.test.ts.
    expect(row.opportunity_score as number).toBeLessThan(40);
    expect(row.next_action).toBe('LOW_PRIORITY');
  });
});

describe('runProspecting — empresa OSM ja conhecida (match exato via lead_sources)', () => {
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

    const existingCompany: Row = {
      id: 'existing-1',
      user_id: 'user-1',
      city: 'Sao Jose dos Campos',
      name: 'Padaria Central',
      phone: '(12) 3921-0000',
      whatsapp: '5512392100000',
      website: null,
      address: null,
      latitude: -23.2,
      longitude: -45.9,
      instagram_url: 'https://instagram.com/padariacentral',
      instagram_handle: 'padariacentral',
      instagram_confidence: 100,
      instagram_status: 'CONFIRMED',
      instagram_source: 'manual',
      instagram_evidence: [],
      instagram_checked_at: new Date().toISOString(),
      last_checked_at: new Date().toISOString(),
    };
    const { client, tables } = createSupabaseMock({
      companies: [existingCompany],
      lead_sources: [
        { id: 'ls-1', user_id: 'user-1', company_id: 'existing-1', source: 'OPENSTREETMAP', source_id: 'node/1' },
      ],
    });

    const events = await collectEvents(client, 'user-1', BASE_INPUT);
    const done = events.find((e) => e.type === 'done');
    if (done?.type !== 'done') throw new Error('esperava evento done');

    expect(done.summary.alreadyKnown).toBe(1);
    expect(done.summary.newCompanies).toBe(0);
    expect(vi.mocked(discoverInstagram)).not.toHaveBeenCalled();

    expect(tables.companies).toHaveLength(1);
    expect(tables.companies[0].instagram_status).toBe('CONFIRMED');
    expect(tables.companies[0].instagram_url).toBe('https://instagram.com/padariacentral');
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
      rawMetadata: null,
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
