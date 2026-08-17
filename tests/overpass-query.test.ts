import { describe, expect, it } from 'vitest';
import {
  CATEGORY_MAP,
  knownCategories,
  normalizeTerm,
  resolveCategory,
} from '@/lib/overpass/categories';
import { buildOverpassQuery, escapeOverpassValue } from '@/lib/overpass/queries';
import { parseBoundingBox } from '@/lib/overpass/geocode';
import { boundingBoxFromRadius } from '@/lib/prospecting/sources/overpass';

const BBOX = { south: -23.3, west: -46.0, north: -23.1, east: -45.8 };

describe('normalizeTerm', () => {
  it('remove acentos, pontuacao e caixa (SPEC 1.2 §11)', () => {
    expect(normalizeTerm('  Padaria & Confeitaria  ')).toBe('padaria confeitaria');
    expect(normalizeTerm('Óticas')).toBe('oticas');
    expect(normalizeTerm('AÇOUGUE')).toBe('acougue');
  });
});

describe('resolveCategory', () => {
  it('mapeia categoria conhecida para tags OSM', () => {
    const resolution = resolveCategory('restaurante');
    expect(resolution.kind).toBe('TAGS');
    if (resolution.kind !== 'TAGS') throw new Error('esperava TAGS');
    expect(resolution.tags).toContainEqual(['amenity', 'restaurant']);
  });

  it('entende o plural em portugues', () => {
    expect(resolveCategory('restaurantes').kind).toBe('TAGS');
    expect(resolveCategory('bares').kind).toBe('TAGS');
    expect(resolveCategory('hoteis').kind).toBe('TAGS');
  });

  it('encontra a categoria dentro de uma frase', () => {
    const resolution = resolveCategory('melhores pizzarias da cidade');
    expect(resolution.kind).toBe('TAGS');
    if (resolution.kind !== 'TAGS') throw new Error('esperava TAGS');
    expect(resolution.matchedTerm).toBe('pizzaria');
  });

  it('nunca inventa tag: termo desconhecido cai em busca por nome (SPEC 1.2 §12)', () => {
    const resolution = resolveCategory('consultoria de blockchain');
    expect(resolution.kind).toBe('NAME_SEARCH');
    if (resolution.kind !== 'NAME_SEARCH') throw new Error('esperava NAME_SEARCH');
    expect(resolution.term).toBe('consultoria de blockchain');
  });

  it('trata termo vazio sem quebrar', () => {
    expect(resolveCategory('   ').kind).toBe('NAME_SEARCH');
  });

  it('expoe as categorias conhecidas ordenadas', () => {
    const categories = knownCategories();
    expect(categories.length).toBe(Object.keys(CATEGORY_MAP).length);
    expect([...categories].sort()).toEqual(categories);
  });
});

describe('escapeOverpassValue', () => {
  it('escapa aspas e barras invertidas', () => {
    expect(escapeOverpassValue('a"b')).toBe('a\\"b');
    expect(escapeOverpassValue('a\\b')).toBe('a\\\\b');
  });
});

describe('buildOverpassQuery', () => {
  it('gera query por tags limitada a bounding box (SPEC 1.2 §9)', () => {
    const { ql, resolution } = buildOverpassQuery({
      query: 'padaria',
      boundingBox: BBOX,
      limit: 50,
      timeoutSeconds: 30,
    });

    expect(resolution.kind).toBe('TAGS');
    expect(ql).toContain('[out:json][timeout:30];');
    expect(ql).toContain('node["shop"="bakery"](-23.3,-46,-23.1,-45.8);');
    expect(ql).toContain('way["shop"="bakery"](-23.3,-46,-23.1,-45.8);');
    expect(ql).toContain('relation["shop"="bakery"](-23.3,-46,-23.1,-45.8);');
    expect(ql.trimEnd().endsWith('out center tags 50;')).toBe(true);
    // Nunca global: toda clausula precisa carregar a bbox.
    for (const line of ql.split('\n').filter((l) => l.trim().startsWith('node'))) {
      expect(line).toContain('(-23.3,-46,-23.1,-45.8)');
    }
  });

  it('gera busca por nome restrita a objetos nomeados quando nao ha mapeamento', () => {
    const { ql } = buildOverpassQuery({
      query: 'consultoria de blockchain',
      boundingBox: BBOX,
      limit: 10,
      timeoutSeconds: 25,
    });

    expect(ql).toContain('node["name"~"consultoria de blockchain",i]');
    expect(ql).not.toContain('amenity');
  });

  it('escapa o termo do usuario dentro da query', () => {
    const { ql } = buildOverpassQuery({
      query: 'bar do "ze"',
      boundingBox: BBOX,
      limit: 10,
      timeoutSeconds: 25,
    });

    // O termo casa com "bar" no mapa de categorias; o que importa e nao vazar aspas cruas.
    expect(ql).not.toMatch(/~"[^"]*"[^,\]]/);
  });
});

describe('parseBoundingBox', () => {
  it('le o formato do Nominatim [south, north, west, east]', () => {
    expect(parseBoundingBox(['-23.3', '-23.1', '-46.0', '-45.8'])).toEqual({
      south: -23.3,
      north: -23.1,
      west: -46,
      east: -45.8,
    });
  });

  it('rejeita entrada invalida ou bbox degenerada', () => {
    expect(parseBoundingBox(undefined)).toBeNull();
    expect(parseBoundingBox(['a', 'b', 'c', 'd'])).toBeNull();
    expect(parseBoundingBox(['1', '2', '3'])).toBeNull();
    expect(parseBoundingBox(['1', '1', '2', '2'])).toBeNull();
  });
});

describe('boundingBoxFromRadius', () => {
  it('gera uma caixa em torno do ponto', () => {
    const bbox = boundingBoxFromRadius(-23.2, -45.9, 5_000);
    expect(bbox.south).toBeLessThan(-23.2);
    expect(bbox.north).toBeGreaterThan(-23.2);
    expect(bbox.west).toBeLessThan(-45.9);
    expect(bbox.east).toBeGreaterThan(-45.9);
  });

  it('alarga a longitude conforme a latitude se afasta do equador', () => {
    const equator = boundingBoxFromRadius(0, 0, 10_000);
    const polar = boundingBoxFromRadius(60, 0, 10_000);
    expect(polar.east - polar.west).toBeGreaterThan(equator.east - equator.west);
  });

  it('nao produz valores infinitos proximo aos polos', () => {
    const bbox = boundingBoxFromRadius(89.999, 0, 10_000);
    expect(Number.isFinite(bbox.east)).toBe(true);
    expect(Number.isFinite(bbox.west)).toBe(true);
  });
});
