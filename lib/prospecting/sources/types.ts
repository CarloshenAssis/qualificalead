/**
 * Contrato comum das fontes de descoberta (SPEC 1.2 §5/§6).
 *
 * Regra central da 1.2: o dominio do LeadHunter nao conhece Google, OSM ou Foursquare.
 * Toda fonte devolve `RawBusiness`, e so o adaptador de cada fonte sabe traduzir o
 * formato nativo para esse formato intermediario.
 */

export const SOURCE_IDS = ['OPENSTREETMAP', 'GOOGLE_PLACES', 'FOURSQUARE', 'LEGACY'] as const;
export type SourceId = (typeof SOURCE_IDS)[number];

export const SOURCE_LABELS: Record<SourceId, string> = {
  OPENSTREETMAP: 'OpenStreetMap',
  GOOGLE_PLACES: 'Google Places',
  FOURSQUARE: 'Foursquare',
  // Empresas anteriores a 1.2, cuja origem nao foi registrada (SPEC 1.2 §76).
  LEGACY: 'Origem nao registrada',
};

/**
 * `FREE` nunca gera custo. `PAID` pode gerar cobranca e exige habilitacao explicita.
 * `OPTIONAL` depende de credencial, mas nao necessariamente cobra.
 */
export type SourceType = 'FREE' | 'PAID' | 'OPTIONAL';

/**
 * Empresa como a fonte entregou, ja em formato neutro (SPEC 1.2 §6).
 * Campo ausente na fonte permanece `undefined` — nunca uma estimativa.
 */
export type RawBusiness = {
  source: SourceId;
  /** Identificador da empresa dentro da fonte. Estavel entre execucoes. */
  sourceId: string;

  name?: string;
  /** Categoria unica e legivel, quando a propria fonte a fornece (nao inferida aqui). */
  category?: string;
  description?: string;

  address?: string;
  street?: string;
  number?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;

  latitude?: number;
  longitude?: number;

  phone?: string;
  /** Telefone em formato internacional, quando a fonte distingue os dois formatos. */
  phoneInternational?: string;
  website?: string;

  categories?: string[];

  rating?: number;
  reviewCount?: number;

  openingHours?: string[];

  businessStatus?: string;

  sourceUrl?: string;

  metadata?: Record<string, unknown>;
};

export type ProspectingSearchParams = {
  /** Termo ou categoria informada pelo usuario. */
  query: string;
  city: string;
  state?: string;
  countryCode?: string;

  latitude?: number;
  longitude?: number;
  radiusMeters?: number;

  limit?: number;
};

export type SourceSearchResult = {
  source: SourceId;
  businesses: RawBusiness[];
  totalFound?: number;
  metrics: {
    requested: number;
    returned: number;
    durationMs: number;
    /** `true` quando o resultado veio do cache de descoberta (SPEC 1.2 §25/§43). */
    cacheHit: boolean;
  };
  /** Avisos que nao impedem o uso do resultado (SPEC 1.2 §27). */
  warnings: string[];
};

export interface ProspectingSource {
  id: SourceId;
  name: string;
  type: SourceType;
  /** Avaliado em tempo de execucao: uma fonte paga so fica ativa por opt-in explicito. */
  enabled: boolean;

  search(params: ProspectingSearchParams): Promise<SourceSearchResult>;
}

/**
 * Quais tipos de sinal a fonte e capaz de fornecer.
 *
 * Isso alimenta o score relativo a fonte (SPEC 1.2 §34/§35): um sinal que a fonte
 * nao consegue observar nao entra na conta — nem como ponto ganho, nem como ponto
 * perdido. Ausencia de rating no OSM nao e evidencia negativa.
 */
export type SourceCapabilities = {
  /** A fonte publica nota de avaliacao (Google sim, OSM nao). */
  rating: boolean;
  /** A fonte publica volume de avaliacoes. */
  reviewCount: boolean;
  /** A fonte mantem um perfil comercial rico (horarios, descricao, ficha publica). */
  businessProfile: boolean;
  /** A fonte costuma informar telefone. */
  phone: boolean;
  /** A fonte costuma informar website. */
  website: boolean;
};

export const SOURCE_CAPABILITIES: Record<SourceId, SourceCapabilities> = {
  GOOGLE_PLACES: {
    rating: true,
    reviewCount: true,
    businessProfile: true,
    phone: true,
    website: true,
  },
  // OSM e um mapa colaborativo, nao um diretorio de reputacao: nao ha rating nem reviews.
  OPENSTREETMAP: {
    rating: false,
    reviewCount: false,
    businessProfile: false,
    phone: true,
    website: true,
  },
  FOURSQUARE: {
    rating: true,
    reviewCount: true,
    businessProfile: false,
    phone: true,
    website: true,
  },
  // Registros anteriores a 1.2 vieram do Google; manter as capacidades daquele periodo
  // preserva o score historico desses leads sem inventar uma origem (SPEC 1.2 §76).
  LEGACY: {
    rating: true,
    reviewCount: true,
    businessProfile: true,
    phone: true,
    website: true,
  },
};

export function capabilitiesFor(source: SourceId | null | undefined): SourceCapabilities {
  return SOURCE_CAPABILITIES[source ?? 'LEGACY'] ?? SOURCE_CAPABILITIES.LEGACY;
}

/**
 * Capacidades combinadas quando um lead tem mais de uma fonte (SPEC 1.2 FASE 6): um lead
 * consolidado de OSM + Google pode usar rating/reviews (do Google) mesmo que o registro
 * do OSM sozinho nao os tivesse — a capacidade e do conjunto de fontes, nao da ultima
 * que respondeu.
 */
export function capabilitiesForSources(sources: SourceId[]): SourceCapabilities {
  if (!sources.length) return SOURCE_CAPABILITIES.LEGACY;

  return sources.reduce<SourceCapabilities>(
    (acc, source) => {
      const capabilities = capabilitiesFor(source);
      return {
        rating: acc.rating || capabilities.rating,
        reviewCount: acc.reviewCount || capabilities.reviewCount,
        businessProfile: acc.businessProfile || capabilities.businessProfile,
        phone: acc.phone || capabilities.phone,
        website: acc.website || capabilities.website,
      };
    },
    { rating: false, reviewCount: false, businessProfile: false, phone: false, website: false },
  );
}

/**
 * Qualidade do dado trazido pela fonte (SPEC 1.2 §14).
 * Nao e score comercial — mede apenas o quao completo veio o registro de uma fonte.
 * Guardado por registro em `lead_sources.source_quality` (FASE 6).
 */
export type SourceQuality = 'HIGH' | 'MEDIUM' | 'LOW';

/**
 * Estrutural, nao ligado a `RawBusiness`: so olha presenca/tipo dos campos, entao serve
 * tanto para uma empresa recem-buscada quanto para uma ja normalizada.
 */
type QualityAssessable = {
  name?: string | null;
  address?: string | null;
  phone?: string | null;
  website?: string | null;
  latitude?: number | null;
  longitude?: number | null;
};

export function assessSourceQuality(business: QualityAssessable): SourceQuality {
  const hasLocation =
    typeof business.latitude === 'number' && typeof business.longitude === 'number';
  const hasAddress = Boolean(business.address);
  const hasContact = Boolean(business.phone || business.website);

  if (business.name && hasAddress && hasLocation && hasContact) return 'HIGH';
  if (business.name && hasLocation && (hasAddress || hasContact)) return 'MEDIUM';
  return 'LOW';
}
