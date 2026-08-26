import { describe, expect, it } from 'vitest';
import { applyCompanyFilters } from '@/lib/companies/query';
import { companyFiltersSchema } from '@/lib/validation/schemas';

type Call = [string, string, unknown?];

/** Builder falso que apenas registra os filtros aplicados. */
function fakeQuery(calls: Call[]) {
  const builder = {
    eq: (column: string, value: unknown) => {
      calls.push(['eq', column, value]);
      return builder;
    },
    not: (column: string, operator: string, value: unknown) => {
      calls.push(['not', column, `${operator}:${value}`]);
      return builder;
    },
    is: (column: string, value: unknown) => {
      calls.push(['is', column, value]);
      return builder;
    },
    gte: (column: string, value: unknown) => {
      calls.push(['gte', column, value]);
      return builder;
    },
    ilike: (column: string, value: string) => {
      calls.push(['ilike', column, value]);
      return builder;
    },
  };
  return builder;
}

function applied(params: Record<string, string>): Call[] {
  const calls: Call[] = [];
  applyCompanyFilters(fakeQuery(calls), companyFiltersSchema.parse(params));
  return calls;
}

describe('applyCompanyFilters', () => {
  it('nao filtra nada com os valores padrao', () => {
    expect(applied({})).toEqual([]);
  });

  it('filtra empresas sem site identificado', () => {
    expect(applied({ website: 'without' })).toContainEqual([
      'eq',
      'website_status',
      'NO_WEBSITE_DETECTED',
    ]);
  });

  it('aplica avaliacao e quantidade minima', () => {
    const calls = applied({ minRating: '4.5', minReviews: '50' });
    expect(calls).toContainEqual(['gte', 'rating', 4.5]);
    expect(calls).toContainEqual(['gte', 'review_count', 50]);
  });

  it('trata os modos de Instagram', () => {
    expect(applied({ instagram: 'found' })).toContainEqual(['not', 'instagram_url', 'is:null']);
    expect(applied({ instagram: 'not_found' })).toContainEqual(['is', 'instagram_url', null]);
    expect(applied({ instagram: 'high_confidence' })).toContainEqual([
      'gte',
      'instagram_confidence',
      70,
    ]);
    expect(applied({ instagram: 'pending' })).toContainEqual(['eq', 'instagram_status', 'PENDING']);
  });

  it('filtra por telefone, nivel, cidade e nome', () => {
    expect(applied({ phone: 'available' })).toContainEqual(['not', 'phone', 'is:null']);
    expect(applied({ phone: 'unavailable' })).toContainEqual(['is', 'phone', null]);
    expect(applied({ level: 'EXCELENTE' })).toContainEqual(['eq', 'opportunity_level', 'EXCELENTE']);
    expect(applied({ city: 'Sao Jose' })).toContainEqual(['ilike', 'city', '%Sao Jose%']);
    expect(applied({ q: 'cantina' })).toContainEqual(['ilike', 'name', '%cantina%']);
  });

  it('"Qualquer" (campo vazio) nao filtra nada — correcao pontual', () => {
    // Um <select> em formulario GET envia o campo mesmo quando "Qualquer" esta
    // selecionado (minRating=, nao ausencia da chave). Sem a correcao, z.coerce.number()
    // fazia Number('') virar 0, e o filtro virava "rating >= 0" de verdade — o que
    // excluia toda empresa com rating/review_count/opportunity_score nulos (ex.: todo
    // lead do OpenStreetMap, que nao tem rating nem review_count).
    const calls = applied({ minRating: '', minReviews: '', minScore: '' });
    expect(calls.some((c) => c[0] === 'gte' && c[1] === 'rating')).toBe(false);
    expect(calls.some((c) => c[0] === 'gte' && c[1] === 'review_count')).toBe(false);
    expect(calls.some((c) => c[0] === 'gte' && c[1] === 'opportunity_score')).toBe(false);
  });

  it('valores reais de minRating/minReviews/minScore continuam funcionando', () => {
    expect(applied({ minScore: '70' })).toContainEqual(['gte', 'opportunity_score', 70]);
  });
});
