import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openStreetMapSource } from '@/lib/prospecting/sources/overpass';

const CITY = {
  display_name: 'Sao Jose dos Campos, SP',
  lat: '-23.1791',
  lon: '-45.8872',
  boundingbox: ['-23.3', '-23.0', '-46.0', '-45.7'],
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function element(id: number, name: string) {
  return { type: 'node', id, lat: -23.2, lon: -45.9, tags: { name, amenity: 'restaurant' } };
}

/** Nominatim responde a primeira chamada; Overpass, a segunda. */
function mockRoundTrip(elements: unknown[]) {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(jsonResponse([CITY]))
    .mockResolvedValueOnce(jsonResponse({ elements }));
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

describe('openStreetMapSource', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('e uma fonte gratuita e habilitada por padrao (SPEC 1.2 §7/§74)', () => {
    expect(openStreetMapSource.id).toBe('OPENSTREETMAP');
    expect(openStreetMapSource.type).toBe('FREE');
    expect(openStreetMapSource.enabled).toBe(true);
  });

  it('geocodifica a cidade e devolve empresas normalizadas', async () => {
    const fetchMock = mockRoundTrip([element(1, 'Cantina A'), element(2, 'Cantina B')]);

    const result = await openStreetMapSource.search({
      query: 'restaurantes',
      city: 'Sao Jose dos Campos',
      state: 'SP',
      limit: 10,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.source).toBe('OPENSTREETMAP');
    expect(result.businesses.map((b) => b.name)).toEqual(['Cantina A', 'Cantina B']);
    expect(result.metrics.requested).toBe(10);
    expect(result.metrics.returned).toBe(2);
    expect(result.metrics.cacheHit).toBe(false);
    expect(result.warnings).toEqual([]);
  });

  it('remove duplicatas do mesmo objeto OSM e respeita o limite', async () => {
    mockRoundTrip([element(1, 'Cantina A'), element(1, 'Cantina A'), element(2, 'Cantina B')]);

    const result = await openStreetMapSource.search({
      query: 'restaurantes',
      city: 'Sao Jose dos Campos',
      limit: 1,
    });

    expect(result.businesses).toHaveLength(1);
    expect(result.totalFound).toBe(2);
  });

  it('avisa o usuario quando cai na busca por nome (SPEC 1.2 §12)', async () => {
    mockRoundTrip([]);

    const result = await openStreetMapSource.search({
      query: 'consultoria de blockchain',
      city: 'Sao Jose dos Campos',
    });

    expect(result.businesses).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('busca foi feita por nome');
  });

  it('com coordenadas e raio explicitos nao chama o geocoder', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ elements: [element(1, 'Cantina')] }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await openStreetMapSource.search({
      query: 'restaurantes',
      city: 'Sao Jose dos Campos',
      latitude: -23.2,
      longitude: -45.9,
      radiusMeters: 5_000,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.businesses).toHaveLength(1);
  });
});
