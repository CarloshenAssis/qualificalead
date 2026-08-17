import type { WebsiteStatus } from '@/types/database';
import type { RawBusiness, SourceId } from './types';

/**
 * Normalizacao neutra em relacao a fonte (SPEC 1.2 §6/§13).
 *
 * `RawBusiness` carrega o que cada fonte devolveu; `NormalizedBusiness` e o formato
 * unico que o resto do pipeline (dedup, presenca digital, qualificacao, score,
 * persistencia) consome — sem nenhum `if (source === 'GOOGLE_PLACES')` a partir daqui.
 *
 * Cada adaptador de fonte e responsavel por preencher seus proprios campos derivados
 * (ex.: `category`) antes deste passo; esta funcao nao inventa fallback entre fontes
 * para nao alterar, nem por acidente, o resultado ja validado do Google (SPEC 1.1).
 */
export type NormalizedBusiness = {
  source: SourceId;
  sourceId: string;
  name: string;
  category: string | null;
  categories: string[] | null;
  description: string | null;
  phone: string | null;
  phoneInternational: string | null;
  website: string | null;
  websiteStatus: WebsiteStatus;
  /** Endereco publico do registro na fonte original (ficha do Google, pagina do OSM etc.). */
  sourceUrl: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
  rating: number | null;
  reviewCount: number | null;
  openingHours: string[] | null;
  businessStatus: string | null;
};

export function normalizeRawBusiness(business: RawBusiness): NormalizedBusiness | null {
  const name = business.name?.trim();
  if (!name || !business.sourceId) return null;

  const website = business.website?.trim() || null;

  return {
    source: business.source,
    sourceId: business.sourceId,
    name,
    category: business.category?.trim() || null,
    categories: business.categories?.length ? business.categories : null,
    description: business.description?.trim() || null,
    phone: business.phone?.trim() || null,
    phoneInternational: business.phoneInternational?.trim() || null,
    website,
    // Ausencia de website aqui significa apenas "nao informado pela fonte" (SPEC 9).
    websiteStatus: website ? 'HAS_WEBSITE' : 'NO_WEBSITE_DETECTED',
    sourceUrl: business.sourceUrl?.trim() || null,
    address: business.address?.trim() || null,
    city: business.city?.trim() || null,
    state: business.state?.trim() || null,
    country: business.country?.trim() || null,
    latitude: typeof business.latitude === 'number' ? business.latitude : null,
    longitude: typeof business.longitude === 'number' ? business.longitude : null,
    rating: typeof business.rating === 'number' ? business.rating : null,
    reviewCount: typeof business.reviewCount === 'number' ? business.reviewCount : null,
    openingHours: business.openingHours?.length ? business.openingHours : null,
    businessStatus: business.businessStatus?.trim() || null,
  };
}
