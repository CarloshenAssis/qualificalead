import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_ATTEMPTS, OverpassError, runOverpassQuery } from '@/lib/overpass/client';
import { osmElementToRawBusiness } from '@/lib/overpass/mapping';
import { assessSourceQuality } from '@/lib/prospecting/sources/types';

const QL = '[out:json][timeout:5];(node["shop"="bakery"](0,0,1,1););out center tags 10;';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('runOverpassQuery', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('envia a query como POST form-encoded com User-Agent identificavel', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ elements: [] }));
    global.fetch = fetchMock as unknown as typeof fetch;

    await runOverpassQuery(QL);

    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(init.headers['User-Agent']).toContain('LeadHunter');
    expect(init.body).toBe(new URLSearchParams({ data: QL }).toString());
  });

  it('resposta vazia devolve lista vazia, nao erro', async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse({ elements: [] })) as unknown as typeof fetch;
    await expect(runOverpassQuery(QL)).resolves.toEqual([]);
  });

  it('corpo sem `elements` devolve lista vazia', async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse({})) as unknown as typeof fetch;
    await expect(runOverpassQuery(QL)).resolves.toEqual([]);
  });

  it('429 e tratado como RATE_LIMITED e tentado no maximo duas vezes (SPEC 1.2 §26)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 429 }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const error = await runOverpassQuery(QL).catch((e) => e);
    expect(error).toBeInstanceOf(OverpassError);
    expect((error as OverpassError).code).toBe('RATE_LIMITED');
    expect((error as OverpassError).retryable).toBe(true);
    expect((error as OverpassError).httpStatus).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(MAX_ATTEMPTS);
  }, 10_000);

  it('5xx e transitorio: tenta de novo e vence se a segunda resposta for boa', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(jsonResponse({ elements: [{ type: 'node', id: 1 }] }));
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(runOverpassQuery(QL)).resolves.toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  }, 10_000);

  it('400 nao e repetido: query malformada nao melhora com retry', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 400 }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const error = await runOverpassQuery(QL).catch((e) => e);
    expect((error as OverpassError).code).toBe('BAD_REQUEST');
    expect((error as OverpassError).retryable).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('timeout vira TIMEOUT com mensagem acionavel', async () => {
    const abort = new Error('aborted');
    abort.name = 'AbortError';
    global.fetch = vi.fn().mockRejectedValue(abort) as unknown as typeof fetch;

    const error = await runOverpassQuery(QL).catch((e) => e);
    expect((error as OverpassError).code).toBe('TIMEOUT');
    expect((error as OverpassError).message).toContain('demorou');
  }, 10_000);

  it('falha de rede nao e confundida com timeout', async () => {
    global.fetch = vi
      .fn()
      .mockRejectedValue(new TypeError('fetch failed')) as unknown as typeof fetch;

    const error = await runOverpassQuery(QL).catch((e) => e);
    expect((error as OverpassError).code).toBe('NETWORK');
    expect((error as OverpassError).retryable).toBe(false);
  });

  it('JSON invalido vira INVALID_RESPONSE', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(new Response('nao e json', { status: 200 })) as unknown as typeof fetch;

    const error = await runOverpassQuery(QL).catch((e) => e);
    expect((error as OverpassError).code).toBe('INVALID_RESPONSE');
  });

  it('o log tecnico nao carrega a query nem cabecalhos', async () => {
    const logSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    global.fetch = vi
      .fn()
      .mockResolvedValue(new Response('', { status: 400 })) as unknown as typeof fetch;

    await runOverpassQuery(QL).catch(() => {});

    const [prefix, payload] = logSpy.mock.calls[0];
    expect(prefix).toBe('[overpass] erro');
    expect(Object.keys(payload as object).sort()).toEqual(['code', 'durationMs', 'httpStatus']);
  });
});

describe('osmElementToRawBusiness', () => {
  it('traduz um elemento completo sem inventar campos (SPEC 1.2 §13)', () => {
    const business = osmElementToRawBusiness({
      type: 'node',
      id: 123,
      lat: -23.2,
      lon: -45.9,
      tags: {
        name: 'Padaria Central',
        shop: 'bakery',
        'addr:street': 'Rua das Flores',
        'addr:housenumber': '100',
        'addr:suburb': 'Centro',
        'addr:city': 'Sao Jose dos Campos',
        'addr:state': 'SP',
        phone: '+55 12 3921-0000',
        website: 'https://padaria.com.br',
        opening_hours: 'Mo-Sa 07:00-19:00',
      },
    });

    expect(business).not.toBeNull();
    expect(business?.source).toBe('OPENSTREETMAP');
    expect(business?.sourceId).toBe('node/123');
    expect(business?.address).toBe('Rua das Flores, 100 - Centro - Sao Jose dos Campos');
    expect(business?.phone).toBe('+55 12 3921-0000');
    expect(business?.categories).toEqual(['bakery']);
    expect(business?.sourceUrl).toBe('https://www.openstreetmap.org/node/123');
    // OSM nao tem reputacao: esses campos jamais podem aparecer preenchidos.
    expect(business?.rating).toBeUndefined();
    expect(business?.reviewCount).toBeUndefined();
  });

  it('usa `center` quando o estabelecimento e uma area', () => {
    const business = osmElementToRawBusiness({
      type: 'way',
      id: 9,
      center: { lat: -23.1, lon: -45.8 },
      tags: { name: 'Mercado X', shop: 'supermarket' },
    });

    expect(business?.latitude).toBe(-23.1);
    expect(business?.longitude).toBe(-45.8);
    expect(business?.sourceId).toBe('way/9');
  });

  it('descarta elemento sem nome em vez de criar lead vazio', () => {
    expect(osmElementToRawBusiness({ type: 'node', id: 1, tags: { shop: 'bakery' } })).toBeNull();
    expect(osmElementToRawBusiness({ type: 'node', id: 1 })).toBeNull();
    expect(osmElementToRawBusiness({ tags: { name: 'Sem id' } })).toBeNull();
  });

  it('marca como fechado o que o OSM marcou com `disused:`', () => {
    const business = osmElementToRawBusiness({
      type: 'node',
      id: 5,
      tags: { name: 'Loja Antiga', 'disused:shop': 'clothes' },
    });
    expect(business?.businessStatus).toBe('CLOSED');
  });

  it('campo ausente permanece indefinido', () => {
    const business = osmElementToRawBusiness({
      type: 'node',
      id: 7,
      tags: { name: 'Bar do Ze', amenity: 'bar' },
    });

    expect(business?.phone).toBeUndefined();
    expect(business?.website).toBeUndefined();
    expect(business?.address).toBeUndefined();
    expect(business?.openingHours).toBeUndefined();
  });
});

describe('assessSourceQuality', () => {
  const base = { source: 'OPENSTREETMAP' as const, sourceId: 'node/1', name: 'X' };

  it('HIGH exige nome, endereco, coordenada e contato', () => {
    expect(
      assessSourceQuality({
        ...base,
        address: 'Rua A, 1',
        latitude: -23,
        longitude: -45,
        phone: '123',
      }),
    ).toBe('HIGH');
  });

  it('MEDIUM quando falta endereco ou contato', () => {
    expect(assessSourceQuality({ ...base, latitude: -23, longitude: -45, phone: '123' })).toBe(
      'MEDIUM',
    );
  });

  it('LOW quando o registro e apenas um nome', () => {
    expect(assessSourceQuality(base)).toBe('LOW');
  });
});
