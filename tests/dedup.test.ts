import { describe, expect, it } from 'vitest';
import { buildDedupKey, normalizePlace } from '@/lib/google/mappers';
import type { GooglePlace } from '@/lib/google/places';

const PLACE: GooglePlace = {
  id: 'ChIJ123',
  displayName: { text: 'Cantina da Nona' },
  formattedAddress: 'Rua das Flores, 100 - Centro, Sao Jose dos Campos - SP',
  addressComponents: [
    { longText: 'Sao Jose dos Campos', types: ['locality'] },
    { longText: 'Sao Paulo', shortText: 'SP', types: ['administrative_area_level_1'] },
    { longText: 'Brasil', shortText: 'BR', types: ['country'] },
  ],
  location: { latitude: -23.1791, longitude: -45.8872 },
  primaryTypeDisplayName: { text: 'Restaurante italiano' },
  types: ['restaurant', 'food'],
  nationalPhoneNumber: '(12) 3921-0000',
  internationalPhoneNumber: '+55 12 3921-0000',
  rating: 4.7,
  userRatingCount: 312,
  businessStatus: 'OPERATIONAL',
  googleMapsUri: 'https://maps.google.com/?cid=1',
};

describe('normalizePlace', () => {
  it('extrai cidade, estado e pais dos address components', () => {
    const normalized = normalizePlace(PLACE);
    expect(normalized).not.toBeNull();
    expect(normalized?.city).toBe('Sao Jose dos Campos');
    expect(normalized?.state).toBe('SP');
    expect(normalized?.country).toBe('BR');
  });

  it('marca NO_WEBSITE_DETECTED quando a fonte nao informa site', () => {
    expect(normalizePlace(PLACE)?.website_status).toBe('NO_WEBSITE_DETECTED');
    expect(normalizePlace({ ...PLACE, websiteUri: 'https://cantina.com.br' })?.website_status).toBe(
      'HAS_WEBSITE',
    );
  });

  it('mantem null nos campos ausentes em vez de inventar', () => {
    const normalized = normalizePlace({ id: 'x', displayName: { text: 'Sem dados' } });
    expect(normalized?.phone).toBeNull();
    expect(normalized?.rating).toBeNull();
    expect(normalized?.address).toBeNull();
    expect(normalized?.city).toBeNull();
  });

  it('descarta resultados sem id ou sem nome', () => {
    expect(normalizePlace({ id: '', displayName: { text: 'x' } })).toBeNull();
    expect(normalizePlace({ id: 'x' })).toBeNull();
  });
});

describe('buildDedupKey', () => {
  it('ignora acentos, caixa e pontuacao', () => {
    const a = buildDedupKey({ name: 'Cantina da Nona', phone: '(12) 3921-0000', address: 'Rua A, 100' });
    const b = buildDedupKey({ name: 'CANTINA DA NONÁ', phone: '1239210000', address: 'rua a 100' });
    expect(a).toBe(b);
  });

  it('separa empresas diferentes no mesmo endereco', () => {
    const a = buildDedupKey({ name: 'Padaria Sol', address: 'Rua A, 100' });
    const b = buildDedupKey({ name: 'Barbearia Sol', address: 'Rua A, 100' });
    expect(a).not.toBe(b);
  });

  it('arredonda coordenadas para tolerar pequenas variacoes', () => {
    const a = buildDedupKey({ name: 'X', latitude: -23.17911234, longitude: -45.88721234 });
    const b = buildDedupKey({ name: 'X', latitude: -23.17909876, longitude: -45.88719876 });
    expect(a).toBe(b);
  });
});
