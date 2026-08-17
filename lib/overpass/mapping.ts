import type { RawBusiness } from '@/lib/prospecting/sources/types';

/**
 * Traducao de um elemento OSM para `RawBusiness` (SPEC 1.2 §13).
 *
 * Nenhum campo e inventado: tag ausente vira `undefined`.
 * OSM nao possui rating nem volume de avaliacoes — esses campos ficam sempre ausentes,
 * e a 1.2 proibe trata-los como equivalentes ao Google Business Profile (§33).
 */

export type OverpassElement = {
  type?: string;
  id?: number;
  lat?: number;
  lon?: number;
  center?: { lat?: number; lon?: number };
  tags?: Record<string, string>;
};

/** Dias da semana em OSM (`opening_hours`) mantidos como vieram — nao interpretamos. */
function openingHours(tags: Record<string, string>): string[] | undefined {
  const raw = tags['opening_hours']?.trim();
  return raw ? [raw] : undefined;
}

function firstTag(tags: Record<string, string>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = tags[key]?.trim();
    if (value) return value;
  }
  return undefined;
}

/** Junta os componentes de endereco que o OSM fornece separadamente. */
function buildAddress(tags: Record<string, string>): string | undefined {
  const street = tags['addr:street']?.trim();
  const number = tags['addr:housenumber']?.trim();
  const neighborhood = tags['addr:suburb']?.trim() ?? tags['addr:neighbourhood']?.trim();
  const city = tags['addr:city']?.trim();

  const line = [street && number ? `${street}, ${number}` : street, neighborhood, city]
    .filter(Boolean)
    .join(' - ');

  return line || undefined;
}

/** Categorias legiveis a partir das tags que classificam o estabelecimento. */
function categories(tags: Record<string, string>): string[] | undefined {
  const values = ['amenity', 'shop', 'office', 'craft', 'healthcare', 'tourism', 'leisure']
    .map((key) => tags[key]?.trim())
    .filter((value): value is string => Boolean(value))
    .map((value) => value.replace(/_/g, ' '));

  return values.length ? values : undefined;
}

/**
 * `disused:` e `was:` sao convencoes OSM para estabelecimentos que fecharam.
 * Preservamos essa informacao em vez de descartar o registro silenciosamente.
 */
function businessStatus(tags: Record<string, string>): string | undefined {
  const closed = Object.keys(tags).some((key) => key.startsWith('disused:') || key.startsWith('was:'));
  return closed ? 'CLOSED' : 'OPERATIONAL';
}

export function osmElementToRawBusiness(element: OverpassElement): RawBusiness | null {
  const tags = element.tags ?? {};
  const name = tags['name']?.trim();

  // Sem nome nao ha empresa identificavel — descartamos em vez de criar um lead vazio.
  if (!name || !element.type || element.id === undefined) return null;

  const latitude = element.lat ?? element.center?.lat;
  const longitude = element.lon ?? element.center?.lon;

  return {
    source: 'OPENSTREETMAP',
    // O par tipo/id e o identificador estavel de um objeto OSM.
    sourceId: `${element.type}/${element.id}`,
    name,
    // OSM nao tem um campo unico de categoria: usamos a primeira tag classificadora.
    category: categories(tags)?.[0],
    address: buildAddress(tags),
    street: tags['addr:street']?.trim() || undefined,
    number: tags['addr:housenumber']?.trim() || undefined,
    neighborhood: tags['addr:suburb']?.trim() || tags['addr:neighbourhood']?.trim() || undefined,
    city: tags['addr:city']?.trim() || undefined,
    state: tags['addr:state']?.trim() || undefined,
    postalCode: tags['addr:postcode']?.trim() || undefined,
    country: tags['addr:country']?.trim() || undefined,
    latitude: typeof latitude === 'number' ? latitude : undefined,
    longitude: typeof longitude === 'number' ? longitude : undefined,
    phone: firstTag(tags, ['phone', 'contact:phone', 'contact:mobile', 'mobile']),
    website: firstTag(tags, ['website', 'contact:website', 'url']),
    categories: categories(tags),
    // OSM nao tem rating nem reviewCount: permanecem ausentes por natureza da fonte.
    openingHours: openingHours(tags),
    businessStatus: businessStatus(tags),
    sourceUrl: `https://www.openstreetmap.org/${element.type}/${element.id}`,
    metadata: { osm_tags: tags },
  };
}

/**
 * Qualidade do dado trazido pela fonte (SPEC 1.2 §14).
 * Nao e score comercial — mede apenas o quao completo veio o registro.
 */
export type SourceQuality = 'HIGH' | 'MEDIUM' | 'LOW';

export function assessSourceQuality(business: RawBusiness): SourceQuality {
  const hasLocation =
    typeof business.latitude === 'number' && typeof business.longitude === 'number';
  const hasAddress = Boolean(business.address);
  const hasContact = Boolean(business.phone || business.website);

  if (business.name && hasAddress && hasLocation && hasContact) return 'HIGH';
  if (business.name && hasLocation && (hasAddress || hasContact)) return 'MEDIUM';
  return 'LOW';
}
