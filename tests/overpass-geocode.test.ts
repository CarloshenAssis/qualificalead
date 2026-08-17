import { afterEach, describe, expect, it, vi } from 'vitest';
import { GeocodeError, geocodeCity } from '@/lib/overpass/geocode';

const CITY = {
  display_name: 'Sao Jose dos Campos, Sao Paulo, Brasil',
  lat: '-23.1791',
  lon: '-45.8872',
  boundingbox: ['-23.3', '-23.0', '-46.0', '-45.7'],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('geocodeCity', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('monta a consulta com cidade, estado e pais e pede a cidade, nao a rua', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([CITY]));
    global.fetch = fetchMock as unknown as typeof fetch;

    const city = await geocodeCity({ city: 'Sao Jose dos Campos', state: 'SP' });

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.searchParams.get('q')).toBe('Sao Jose dos Campos, SP, Brasil');
    expect(url.searchParams.get('format')).toBe('json');
    expect(url.searchParams.get('featuretype')).toBe('settlement');
    // O Nominatim exige identificacao do cliente.
    expect((init.headers as Record<string, string>)['User-Agent']).toContain('LeadHunter');

    expect(city.boundingBox).toEqual({ south: -23.3, north: -23, west: -46, east: -45.7 });
    expect(city.latitude).toBeCloseTo(-23.1791);
    expect(city.displayName).toBe(CITY.display_name);
  });

  it('usa Brasil como pais padrao', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([CITY]));
    global.fetch = fetchMock as unknown as typeof fetch;

    await geocodeCity({ city: 'Campinas' });
    const [url] = fetchMock.mock.calls[0] as [URL];
    expect(url.searchParams.get('q')).toBe('Campinas, Brasil');
  });

  it('cidade inexistente vira NOT_FOUND com orientacao ao usuario', async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse([])) as unknown as typeof fetch;

    const error = await geocodeCity({ city: 'Cidade Inexistente' }).catch((e) => e);
    expect(error).toBeInstanceOf(GeocodeError);
    expect((error as GeocodeError).code).toBe('NOT_FOUND');
    expect((error as GeocodeError).message).toContain('Cidade Inexistente');
  });

  it('resultado sem bounding box utilizavel tambem e NOT_FOUND', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(
        jsonResponse([{ ...CITY, boundingbox: undefined }]),
      ) as unknown as typeof fetch;

    const error = await geocodeCity({ city: 'X' }).catch((e) => e);
    expect((error as GeocodeError).code).toBe('NOT_FOUND');
  });

  it('429 do Nominatim vira RATE_LIMITED', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(new Response('', { status: 429 })) as unknown as typeof fetch;

    const error = await geocodeCity({ city: 'X' }).catch((e) => e);
    expect((error as GeocodeError).code).toBe('RATE_LIMITED');
  });

  it('timeout vira NETWORK com mensagem propria', async () => {
    const abort = new Error('aborted');
    abort.name = 'AbortError';
    global.fetch = vi.fn().mockRejectedValue(abort) as unknown as typeof fetch;

    const error = await geocodeCity({ city: 'X' }).catch((e) => e);
    expect((error as GeocodeError).code).toBe('NETWORK');
    expect((error as GeocodeError).message).toContain('demorou');
  });

  it('resposta nao-JSON vira INVALID_RESPONSE', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(new Response('<html>', { status: 200 })) as unknown as typeof fetch;

    const error = await geocodeCity({ city: 'X' }).catch((e) => e);
    expect((error as GeocodeError).code).toBe('INVALID_RESPONSE');
  });
});
