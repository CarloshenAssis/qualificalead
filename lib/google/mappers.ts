import type { GoogleAddressComponent, GooglePlace } from './places';
import type { WebsiteStatus } from '@/types/database';

/**
 * Traducao de um `Place` da API para os campos do dominio (SPEC 8/9).
 * Campo ausente na fonte permanece `null` — o sistema nunca preenche por conta propria (SPEC 3.1).
 */

export type NormalizedPlace = {
  google_place_id: string;
  name: string;
  category: string | null;
  categories: string[] | null;
  description: string | null;
  phone: string | null;
  phone_international: string | null;
  website: string | null;
  website_status: WebsiteStatus;
  google_maps_url: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
  rating: number | null;
  review_count: number | null;
  opening_hours: string[] | null;
  business_status: string | null;
};

function component(
  components: GoogleAddressComponent[] | undefined,
  type: string,
  prefer: 'long' | 'short' = 'long',
): string | null {
  const found = components?.find((c) => c.types?.includes(type));
  if (!found) return null;
  const value = prefer === 'short' ? (found.shortText ?? found.longText) : (found.longText ?? found.shortText);
  return value?.trim() || null;
}

/** Cidade: `locality` costuma existir; ha fallbacks para regioes sem esse componente. */
function extractCity(components: GoogleAddressComponent[] | undefined): string | null {
  return (
    component(components, 'locality') ??
    component(components, 'administrative_area_level_2') ??
    component(components, 'postal_town') ??
    null
  );
}

/** Transforma `restaurant`/`italian_restaurant` em algo legivel quando falta displayName. */
function humanizeType(type: string | undefined): string | null {
  if (!type) return null;
  const text = type.replace(/_/g, ' ').trim();
  if (!text) return null;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function normalizePlace(place: GooglePlace): NormalizedPlace | null {
  const name = place.displayName?.text?.trim();
  if (!place.id || !name) return null;

  const website = place.websiteUri?.trim() || null;

  return {
    google_place_id: place.id,
    name,
    category: place.primaryTypeDisplayName?.text?.trim() || humanizeType(place.primaryType),
    categories: place.types?.length ? place.types : null,
    description: place.editorialSummary?.text?.trim() || null,
    phone: place.nationalPhoneNumber?.trim() || null,
    phone_international: place.internationalPhoneNumber?.trim() || null,
    website,
    // Ausencia de website aqui significa apenas "nao informado pela fonte" (SPEC 9).
    website_status: website ? 'HAS_WEBSITE' : 'NO_WEBSITE_DETECTED',
    google_maps_url: place.googleMapsUri?.trim() || null,
    address: place.formattedAddress?.trim() || place.shortFormattedAddress?.trim() || null,
    city: extractCity(place.addressComponents),
    state: component(place.addressComponents, 'administrative_area_level_1', 'short'),
    country: component(place.addressComponents, 'country', 'short'),
    latitude: typeof place.location?.latitude === 'number' ? place.location.latitude : null,
    longitude: typeof place.location?.longitude === 'number' ? place.location.longitude : null,
    rating: typeof place.rating === 'number' ? place.rating : null,
    review_count: typeof place.userRatingCount === 'number' ? place.userRatingCount : null,
    opening_hours: place.regularOpeningHours?.weekdayDescriptions?.length
      ? place.regularOpeningHours.weekdayDescriptions
      : null,
    business_status: place.businessStatus?.trim() || null,
  };
}

/**
 * Chave de deduplicacao alternativa quando nao ha `place_id` confiavel (SPEC 18):
 * nome + telefone + endereco + coordenadas arredondadas.
 */
export function buildDedupKey(input: {
  name: string;
  phone?: string | null;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}): string {
  const slug = (value: string | null | undefined) =>
    (value ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '');

  const coords =
    typeof input.latitude === 'number' && typeof input.longitude === 'number'
      ? `${input.latitude.toFixed(4)},${input.longitude.toFixed(4)}`
      : '';

  return [slug(input.name), slug(input.phone), slug(input.address), coords].join('|');
}
