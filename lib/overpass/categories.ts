/**
 * Mapeamento de termo do usuario para tags OSM (SPEC 1.2 §11/§12).
 *
 * Regra da 1.2: nunca inventar tag OSM arbitraria. Quando o termo nao tem mapeamento
 * conhecido, o sistema declara isso abertamente e usa uma estrategia por nome, em vez de
 * chutar uma tag que produziria resultados errados silenciosamente.
 */

/** Par `[chave, valor]` de tag OSM. */
export type OsmTag = readonly [string, string];

/**
 * Mapa extensivel de categorias.
 * As chaves sao comparadas ja normalizadas (sem acento, minusculas).
 */
export const CATEGORY_MAP: Record<string, OsmTag[]> = {
  restaurante: [
    ['amenity', 'restaurant'],
    ['amenity', 'fast_food'],
  ],
  pizzaria: [['amenity', 'restaurant']],
  lanchonete: [['amenity', 'fast_food']],
  bar: [['amenity', 'bar'], ['amenity', 'pub']],
  cafe: [['amenity', 'cafe']],
  padaria: [['shop', 'bakery']],
  confeitaria: [['shop', 'pastry']],
  acougue: [['shop', 'butcher']],
  mercado: [['shop', 'convenience'], ['shop', 'supermarket']],
  supermercado: [['shop', 'supermarket']],

  dentista: [['amenity', 'dentist']],
  'clinica odontologica': [['amenity', 'dentist']],
  medico: [['amenity', 'doctors']],
  clinica: [['amenity', 'clinic'], ['amenity', 'doctors']],
  veterinario: [['amenity', 'veterinary']],
  farmacia: [['amenity', 'pharmacy']],
  psicologo: [['healthcare', 'psychotherapist']],
  fisioterapia: [['healthcare', 'physiotherapist']],
  laboratorio: [['healthcare', 'laboratory']],

  salao: [['shop', 'hairdresser']],
  'salao de beleza': [['shop', 'hairdresser']],
  cabeleireiro: [['shop', 'hairdresser']],
  barbearia: [['shop', 'hairdresser']],
  estetica: [['shop', 'beauty']],
  manicure: [['shop', 'beauty']],
  tatuagem: [['shop', 'tattoo']],

  'pet shop': [['shop', 'pet']],
  petshop: [['shop', 'pet']],

  mecanica: [['shop', 'car_repair']],
  'oficina mecanica': [['shop', 'car_repair']],
  'auto pecas': [['shop', 'car_parts']],
  autopecas: [['shop', 'car_parts']],
  'lava rapido': [['amenity', 'car_wash']],
  concessionaria: [['shop', 'car']],
  borracharia: [['shop', 'tyres']],

  academia: [['leisure', 'fitness_centre']],
  'loja de roupas': [['shop', 'clothes']],
  roupas: [['shop', 'clothes']],
  calcados: [['shop', 'shoes']],
  otica: [['shop', 'optician']],
  joalheria: [['shop', 'jewelry']],
  floricultura: [['shop', 'florist']],
  livraria: [['shop', 'books']],
  papelaria: [['shop', 'stationery']],
  moveis: [['shop', 'furniture']],
  'material de construcao': [['shop', 'doityourself'], ['shop', 'hardware']],
  eletronicos: [['shop', 'electronics']],
  informatica: [['shop', 'computer']],
  celular: [['shop', 'mobile_phone']],

  hotel: [['tourism', 'hotel']],
  pousada: [['tourism', 'guest_house']],

  contador: [['office', 'accountant']],
  contabilidade: [['office', 'accountant']],
  advogado: [['office', 'lawyer']],
  imobiliaria: [['office', 'estate_agent']],
  seguros: [['office', 'insurance']],
  arquiteto: [['office', 'architect']],
  fotografo: [['shop', 'photo'], ['craft', 'photographer']],
  grafica: [['shop', 'copyshop']],
  lavanderia: [['shop', 'laundry']],
  escola: [['amenity', 'school']],
  'auto escola': [['amenity', 'driving_school']],
};

export function normalizeTerm(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export type CategoryResolution =
  | { kind: 'TAGS'; tags: OsmTag[]; matchedTerm: string }
  /** Sem mapeamento conhecido: busca por nome, declarada como tal (SPEC 1.2 §12). */
  | { kind: 'NAME_SEARCH'; term: string };

/**
 * Resolve o termo do usuario.
 *
 * A busca considera o termo inteiro, depois formas singulares e, por fim, se algum termo
 * conhecido aparece dentro da frase ("melhor pizzaria" → pizzaria).
 */
export function resolveCategory(query: string): CategoryResolution {
  const term = normalizeTerm(query);
  if (!term) return { kind: 'NAME_SEARCH', term: '' };

  const candidates = [term];

  // Plural simples do portugues: "restaurantes" → "restaurante", "bares" → "bar".
  if (term.endsWith('s')) {
    candidates.push(term.slice(0, -1));
    if (term.endsWith('es')) candidates.push(term.slice(0, -2));
    if (term.endsWith('is')) candidates.push(`${term.slice(0, -2)}l`);
  }

  for (const candidate of candidates) {
    const tags = CATEGORY_MAP[candidate];
    if (tags) return { kind: 'TAGS', tags, matchedTerm: candidate };
  }

  // "melhores restaurantes da cidade" ainda deve encontrar "restaurante".
  const words = term.split(' ');
  for (const known of Object.keys(CATEGORY_MAP)) {
    const knownWords = known.split(' ');
    const present = knownWords.every(
      (word) => words.includes(word) || words.includes(`${word}s`) || words.includes(`${word}es`),
    );
    if (present) return { kind: 'TAGS', tags: CATEGORY_MAP[known], matchedTerm: known };
  }

  return { kind: 'NAME_SEARCH', term };
}

export function knownCategories(): string[] {
  return Object.keys(CATEGORY_MAP).sort();
}
