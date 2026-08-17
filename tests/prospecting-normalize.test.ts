import { describe, expect, it } from 'vitest';
import { normalizeRawBusiness } from '@/lib/prospecting/sources/normalize';
import { buildDedupKey, dedupeNormalizedBusinesses, identityKeyFor } from '@/lib/prospecting/sources/dedupe';
import type { RawBusiness } from '@/lib/prospecting/sources/types';

const OSM_BUSINESS: RawBusiness = {
  source: 'OPENSTREETMAP',
  sourceId: 'node/1',
  name: '  Padaria Central  ',
  category: 'bakery',
  address: 'Rua A, 100',
  city: 'Sao Jose dos Campos',
  phone: '(12) 3921-0000',
  website: undefined,
};

const GOOGLE_BUSINESS: RawBusiness = {
  source: 'GOOGLE_PLACES',
  sourceId: 'ChIJ123',
  name: 'Cantina da Nona',
  category: 'Restaurante italiano',
  description: 'Culinaria italiana',
  address: 'Rua das Flores, 100',
  city: 'Sao Jose dos Campos',
  state: 'SP',
  phone: '(12) 3921-0000',
  phoneInternational: '+55 12 3921-0000',
  website: 'https://cantina.com.br',
  categories: ['restaurant', 'food'],
  rating: 4.7,
  reviewCount: 312,
  sourceUrl: 'https://maps.google.com/?cid=1',
};

describe('normalizeRawBusiness', () => {
  it('descarta campos ausentes como null, nunca inventa valor', () => {
    const business = normalizeRawBusiness(OSM_BUSINESS);
    expect(business?.website).toBeNull();
    expect(business?.websiteStatus).toBe('NO_WEBSITE_DETECTED');
    expect(business?.rating).toBeNull();
    expect(business?.reviewCount).toBeNull();
    expect(business?.description).toBeNull();
    expect(business?.name).toBe('Padaria Central');
  });

  it('marca HAS_WEBSITE quando a fonte informa site', () => {
    const business = normalizeRawBusiness(GOOGLE_BUSINESS);
    expect(business?.websiteStatus).toBe('HAS_WEBSITE');
    expect(business?.website).toBe('https://cantina.com.br');
  });

  it('preserva todos os campos do Google sem perda (regressao)', () => {
    const business = normalizeRawBusiness(GOOGLE_BUSINESS);
    expect(business).toMatchObject({
      source: 'GOOGLE_PLACES',
      sourceId: 'ChIJ123',
      name: 'Cantina da Nona',
      category: 'Restaurante italiano',
      categories: ['restaurant', 'food'],
      description: 'Culinaria italiana',
      phone: '(12) 3921-0000',
      phoneInternational: '+55 12 3921-0000',
      rating: 4.7,
      reviewCount: 312,
      sourceUrl: 'https://maps.google.com/?cid=1',
    });
  });

  it('descarta registro sem nome ou sem sourceId', () => {
    expect(normalizeRawBusiness({ ...OSM_BUSINESS, name: undefined })).toBeNull();
    expect(normalizeRawBusiness({ ...OSM_BUSINESS, name: '   ' })).toBeNull();
    expect(normalizeRawBusiness({ ...OSM_BUSINESS, sourceId: '' })).toBeNull();
  });

  it('nao aplica fallback de categoria entre fontes: ausencia continua null', () => {
    const business = normalizeRawBusiness({ ...OSM_BUSINESS, category: undefined, categories: ['bakery', 'shop'] });
    // Cada fonte decide sua propria categoria unica; o normalize generico nao infere.
    expect(business?.category).toBeNull();
    expect(business?.categories).toEqual(['bakery', 'shop']);
  });
});

describe('identityKeyFor', () => {
  it('usa o sourceId para Google e LEGACY', () => {
    const business = normalizeRawBusiness(GOOGLE_BUSINESS)!;
    expect(identityKeyFor(business)).toBe('place_id:ChIJ123');
    expect(identityKeyFor({ ...business, source: 'LEGACY' })).toBe('place_id:ChIJ123');
  });

  it('usa dedup_key para as demais fontes', () => {
    const business = normalizeRawBusiness(OSM_BUSINESS)!;
    expect(identityKeyFor(business)).toBe(`dedup_key:${buildDedupKey(business)}`);
  });
});

describe('dedupeNormalizedBusinesses', () => {
  it('mantem a primeira ocorrencia quando duas fontes diferentes colidem no dedup_key', () => {
    const a = normalizeRawBusiness(OSM_BUSINESS)!;
    const b = normalizeRawBusiness({ ...OSM_BUSINESS, sourceId: 'way/2' })!; // mesmo nome/endereco/telefone

    const result = dedupeNormalizedBusinesses([a, b]);
    expect(result).toHaveLength(1);
    expect(result[0].sourceId).toBe('node/1');
  });

  it('nao remove empresas legitimamente diferentes', () => {
    const a = normalizeRawBusiness(OSM_BUSINESS)!;
    const b = normalizeRawBusiness({ ...OSM_BUSINESS, sourceId: 'node/2', name: 'Padaria do Sul' })!;

    expect(dedupeNormalizedBusinesses([a, b])).toHaveLength(2);
  });

  it('leads do Google nunca colidem entre si so por endereco parecido: identidade e o place_id', () => {
    const a = normalizeRawBusiness(GOOGLE_BUSINESS)!;
    const b = normalizeRawBusiness({ ...GOOGLE_BUSINESS, sourceId: 'ChIJ456' })!;
    expect(dedupeNormalizedBusinesses([a, a, b])).toHaveLength(2);
  });
});
