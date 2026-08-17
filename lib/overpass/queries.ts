import type { BoundingBox } from './geocode';
import { resolveCategory, type CategoryResolution } from './categories';

/**
 * Construcao da query Overpass QL (SPEC 1.2 §9/§11/§12).
 *
 * A consulta e sempre delimitada pela bounding box da cidade — nunca global (§9).
 * Buscamos `node`, `way` e `relation` porque um estabelecimento pode estar mapeado
 * como ponto ou como area (predio); `center` devolve a coordenada de areas.
 */

/** Escapa aspas e barras invertidas para uso dentro de um literal Overpass QL. */
export function escapeOverpassValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function bboxClause(bbox: BoundingBox): string {
  return `(${bbox.south},${bbox.west},${bbox.north},${bbox.east})`;
}

export type BuildQueryParams = {
  query: string;
  boundingBox: BoundingBox;
  limit: number;
  timeoutSeconds: number;
};

export type BuiltQuery = {
  ql: string;
  resolution: CategoryResolution;
};

/**
 * Monta a query final.
 *
 * Com tags conhecidas, filtramos por elas — resultado preciso.
 * Sem mapeamento, caimos numa busca por nome (`~` case-insensitive) restrita a objetos
 * que tenham `name`, o que evita varrer o mapa inteiro.
 */
export function buildOverpassQuery(params: BuildQueryParams): BuiltQuery {
  const resolution = resolveCategory(params.query);
  const bbox = bboxClause(params.boundingBox);
  const elements: string[] = [];

  if (resolution.kind === 'TAGS') {
    for (const [key, value] of resolution.tags) {
      const k = escapeOverpassValue(key);
      const v = escapeOverpassValue(value);
      elements.push(`  node["${k}"="${v}"]${bbox};`);
      elements.push(`  way["${k}"="${v}"]${bbox};`);
      elements.push(`  relation["${k}"="${v}"]${bbox};`);
    }
  } else {
    const term = escapeOverpassValue(resolution.term);
    // Apenas objetos nomeados: sem isso a busca livre retorna geometria irrelevante.
    elements.push(`  node["name"~"${term}",i]${bbox};`);
    elements.push(`  way["name"~"${term}",i]${bbox};`);
    elements.push(`  relation["name"~"${term}",i]${bbox};`);
  }

  const ql = [
    `[out:json][timeout:${params.timeoutSeconds}];`,
    '(',
    ...elements,
    ');',
    `out center tags ${params.limit};`,
  ].join('\n');

  return { ql, resolution };
}
