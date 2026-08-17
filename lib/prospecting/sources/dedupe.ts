import type { NormalizedBusiness } from './normalize';

/**
 * Identidade e deduplicacao neutras em relacao a fonte (SPEC 1.2 §6/§18).
 *
 * `buildDedupKey` ja nasceu neutra na 1.1 (SPEC 18: "chave de fallback quando nao ha
 * place_id confiavel") — nome + telefone + endereco + coordenadas, sem nenhuma referencia
 * ao Google. Mudou apenas de endereco: sai de `lib/google/mappers.ts`, onde nao fazia mais
 * sentido morar, para aqui, ao lado do resto do pipeline neutro.
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

/**
 * A empresa e identificada por `place_id` do Google quando a fonte e o Google
 * (persistencia continua usando a coluna `google_place_id`, SPEC 1.2 §22) e por
 * `dedup_key` para as demais fontes (indice parcial ja existente, migration 0001).
 * Registros antigos (`LEGACY`) tambem carregam `google_place_id`, entao seguem a
 * mesma regra do Google.
 */
export function identityKeyFor(business: NormalizedBusiness): string {
  if (business.source === 'GOOGLE_PLACES' || business.source === 'LEGACY') {
    return `place_id:${business.sourceId}`;
  }
  return `dedup_key:${buildDedupKey(business)}`;
}

/**
 * Remove duplicatas dentro do mesmo lote de busca (estagio "Deduplicate" do pipeline).
 *
 * Cada fonte ja deduplica internamente pelo seu proprio identificador estavel
 * (`textSearch` pelo `place.id`, Overpass pelo par tipo/id) — mas dois objetos
 * *diferentes* na fonte podem colidir no `dedup_key` que a persistencia usa como
 * chave de conflito (ex.: o mesmo estabelecimento mapeado duas vezes no OSM).
 * Sem este passo, o upsert falharia com "ON CONFLICT DO UPDATE command cannot
 * affect row a second time". Mantem a primeira ocorrencia.
 */
export function dedupeNormalizedBusinesses(businesses: NormalizedBusiness[]): NormalizedBusiness[] {
  const seen = new Set<string>();
  const result: NormalizedBusiness[] = [];

  for (const business of businesses) {
    const key = identityKeyFor(business);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(business);
  }

  return result;
}
