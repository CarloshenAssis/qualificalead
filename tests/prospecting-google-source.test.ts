import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { googlePlacesSource } from '@/lib/prospecting/sources/google';

const originalFetch = global.fetch;
const originalKey = process.env.GOOGLE_MAPS_API_KEY;
const originalEnabled = process.env.GOOGLE_PLACES_ENABLED;

function placesResponse(places: unknown[]): Response {
  return new Response(JSON.stringify({ places }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('googlePlacesSource', () => {
  beforeEach(() => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.GOOGLE_MAPS_API_KEY = originalKey;
    process.env.GOOGLE_PLACES_ENABLED = originalEnabled;
    vi.restoreAllMocks();
  });

  it('id, tipo e nome sao fixos e a fonte e paga', () => {
    expect(googlePlacesSource.id).toBe('GOOGLE_PLACES');
    expect(googlePlacesSource.type).toBe('PAID');
    expect(googlePlacesSource.name).toBe('Google Places');
  });

  it('`enabled` reflete a flag em tempo real, sem cache no modulo (SPEC 1.2 §22)', () => {
    process.env.GOOGLE_PLACES_ENABLED = 'false';
    expect(googlePlacesSource.enabled).toBe(false);

    process.env.GOOGLE_PLACES_ENABLED = 'true';
    expect(googlePlacesSource.enabled).toBe(true);

    process.env.GOOGLE_PLACES_ENABLED = 'false';
    expect(googlePlacesSource.enabled).toBe(false);
  });

  it('traduz um GooglePlace para RawBusiness preservando todos os campos (SPEC 1.2 §6)', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      placesResponse([
        {
          id: 'ChIJ123',
          displayName: { text: 'Cantina da Nona' },
          formattedAddress: 'Rua das Flores, 100',
          addressComponents: [{ longText: 'Sao Jose dos Campos', types: ['locality'] }],
          location: { latitude: -23.1791, longitude: -45.8872 },
          primaryTypeDisplayName: { text: 'Restaurante italiano' },
          types: ['restaurant', 'food'],
          nationalPhoneNumber: '(12) 3921-0000',
          internationalPhoneNumber: '+55 12 3921-0000',
          rating: 4.7,
          userRatingCount: 312,
          businessStatus: 'OPERATIONAL',
          googleMapsUri: 'https://maps.google.com/?cid=1',
          editorialSummary: { text: 'Culinaria italiana' },
        },
      ]),
    ) as unknown as typeof fetch;

    const result = await googlePlacesSource.search({
      query: 'restaurantes',
      city: 'Sao Jose dos Campos',
      state: 'SP',
      limit: 20,
    });

    expect(result.source).toBe('GOOGLE_PLACES');
    expect(result.businesses).toHaveLength(1);
    expect(result.businesses[0]).toMatchObject({
      source: 'GOOGLE_PLACES',
      sourceId: 'ChIJ123',
      name: 'Cantina da Nona',
      category: 'Restaurante italiano',
      description: 'Culinaria italiana',
      city: 'Sao Jose dos Campos',
      phone: '(12) 3921-0000',
      phoneInternational: '+55 12 3921-0000',
      rating: 4.7,
      reviewCount: 312,
      sourceUrl: 'https://maps.google.com/?cid=1',
    });
  });

  it('monta o textQuery no mesmo formato da 1.1 ("segmento em cidade, estado, pais")', async () => {
    const fetchMock = vi.fn().mockResolvedValue(placesResponse([]));
    global.fetch = fetchMock as unknown as typeof fetch;

    await googlePlacesSource.search({ query: 'pizzaria', city: 'Campinas', state: 'SP', limit: 10 });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { textQuery: string };
    expect(body.textQuery).toBe('pizzaria em Campinas, SP, Brasil');
  });

  it('sem website a fonte devolve o campo ausente, nao um website_status computado', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      placesResponse([{ id: 'x', displayName: { text: 'Sem site' } }]),
    ) as unknown as typeof fetch;

    const result = await googlePlacesSource.search({ query: 'x', city: 'Y', limit: 10 });
    expect(result.businesses[0].website).toBeUndefined();
  });
});
