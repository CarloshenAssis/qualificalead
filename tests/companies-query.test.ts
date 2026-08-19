import { describe, expect, it } from 'vitest';
import { companiesQuery } from '@/lib/companies/query';
import { companyFiltersSchema } from '@/lib/validation/schemas';
import { createSupabaseMock, type Row } from './helpers/supabase-mock';

/**
 * Correcao pontual dos filtros do modulo Empresas (SPEC 13/21/23, SPEC 1.2 FASE 7 §5).
 * Testa a query de verdade (companiesQuery), nao so applyCompanyFilters isolado —
 * inclui o filtro de fonte via company_source_summary (migration 0005), paginacao e
 * count aplicados DEPOIS dos filtros, e isolamento por usuario.
 */

const USER_A = 'user-a';
const USER_B = 'user-b';

function company(overrides: Partial<Row> = {}): Row {
  return {
    id: overrides.id ?? `c-${Math.random().toString(36).slice(2)}`,
    user_id: USER_A,
    name: 'Empresa',
    city: 'Sao Jose dos Campos',
    website_status: 'NO_WEBSITE_DETECTED',
    opportunity_score: 50,
    opportunity_level: 'MEDIA',
    rating: null,
    review_count: null,
    phone: null,
    instagram_url: null,
    instagram_status: 'NOT_FOUND',
    instagram_confidence: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

/** Base de dados sintetica: 3 fontes distintas + 1 MULTI_SOURCE, espalhadas por 2 usuarios. */
function seedDb() {
  const companies: Row[] = [
    company({ id: 'osm-1', name: 'Padaria OSM', opportunity_score: 70 }),
    company({ id: 'osm-2', name: 'Padaria OSM 2', opportunity_score: 20 }),
    company({ id: 'google-1', name: 'Restaurante Google', opportunity_score: 55, rating: 4.8 }),
    company({ id: 'legacy-1', name: 'Loja Legada', opportunity_score: 30 }),
    company({ id: 'multi-1', name: 'Oficina Multi-fonte', opportunity_score: 90 }),
    company({ id: 'other-user-1', user_id: USER_B, name: 'Empresa de outro usuario', opportunity_score: 99 }),
  ];

  const leadSources: Row[] = [
    { id: 'ls-1', user_id: USER_A, company_id: 'osm-1', source: 'OPENSTREETMAP', source_quality: 'HIGH' },
    { id: 'ls-2', user_id: USER_A, company_id: 'osm-2', source: 'OPENSTREETMAP', source_quality: 'LOW' },
    { id: 'ls-3', user_id: USER_A, company_id: 'google-1', source: 'GOOGLE_PLACES', source_quality: 'HIGH' },
    { id: 'ls-4', user_id: USER_A, company_id: 'legacy-1', source: 'LEGACY', source_quality: null },
    { id: 'ls-5', user_id: USER_A, company_id: 'multi-1', source: 'OPENSTREETMAP', source_quality: 'MEDIUM' },
    { id: 'ls-6', user_id: USER_A, company_id: 'multi-1', source: 'GOOGLE_PLACES', source_quality: 'HIGH' },
    { id: 'ls-7', user_id: USER_B, company_id: 'other-user-1', source: 'OPENSTREETMAP', source_quality: 'HIGH' },
  ];

  // Equivalente sintetico da view company_source_summary (migration 0005) para o mock.
  const companySourceSummary: Row[] = [
    { company_id: 'osm-1', sources: ['OPENSTREETMAP'], source_count: 1 },
    { company_id: 'osm-2', sources: ['OPENSTREETMAP'], source_count: 1 },
    { company_id: 'google-1', sources: ['GOOGLE_PLACES'], source_count: 1 },
    { company_id: 'legacy-1', sources: ['LEGACY'], source_count: 1 },
    { company_id: 'multi-1', sources: ['GOOGLE_PLACES', 'OPENSTREETMAP'], source_count: 2 },
    { company_id: 'other-user-1', sources: ['OPENSTREETMAP'], source_count: 1 },
  ];

  return createSupabaseMock({
    companies,
    lead_sources: leadSources,
    company_source_summary: companySourceSummary,
  });
}

function filtersWith(overrides: Record<string, string>) {
  return companyFiltersSchema.parse(overrides);
}

describe('companiesQuery — filtro por fonte (SPEC 1.2 FASE 7 §5)', () => {
  it('1. OPENSTREETMAP retorna so empresas com essa fonte', async () => {
    const { client } = seedDb();
    const { data } = await companiesQuery(client, USER_A, filtersWith({ source: 'OPENSTREETMAP' }));
    expect((data ?? []).map((r) => r.id).sort()).toEqual(['multi-1', 'osm-1', 'osm-2'].sort());
  });

  it('2. GOOGLE_PLACES retorna so empresas com essa fonte', async () => {
    const { client } = seedDb();
    const { data } = await companiesQuery(client, USER_A, filtersWith({ source: 'GOOGLE_PLACES' }));
    expect((data ?? []).map((r) => r.id).sort()).toEqual(['google-1', 'multi-1'].sort());
  });

  it('3. LEGACY retorna so empresas com essa fonte', async () => {
    const { client } = seedDb();
    const { data } = await companiesQuery(client, USER_A, filtersWith({ source: 'LEGACY' }));
    expect((data ?? []).map((r) => r.id)).toEqual(['legacy-1']);
  });

  it('4. MULTI_SOURCE retorna so empresas com mais de uma fonte', async () => {
    const { client } = seedDb();
    const { data } = await companiesQuery(client, USER_A, filtersWith({ source: 'MULTI_SOURCE' }));
    expect((data ?? []).map((r) => r.id)).toEqual(['multi-1']);
  });

  it('5. sem selecao (source=all) retorna todas as empresas do usuario', async () => {
    const { client } = seedDb();
    const { data, count } = await companiesQuery(client, USER_A, filtersWith({}));
    expect(count).toBe(5);
    expect((data ?? []).map((r) => r.id).sort()).toEqual(
      ['osm-1', 'osm-2', 'google-1', 'legacy-1', 'multi-1'].sort(),
    );
  });

  it('se selecionar OPENSTREETMAP, empresa so-GOOGLE_PLACES nunca aparece', async () => {
    const { client } = seedDb();
    const { data } = await companiesQuery(client, USER_A, filtersWith({ source: 'OPENSTREETMAP' }));
    expect((data ?? []).some((r) => r.id === 'google-1')).toBe(false);
  });
});

describe('companiesQuery — combinacao de filtros', () => {
  it('6. fonte + score minimo combinados', async () => {
    const { client } = seedDb();
    const { data } = await companiesQuery(
      client,
      USER_A,
      filtersWith({ source: 'OPENSTREETMAP', minScore: '50' }),
    );
    // osm-1 (70) entra, osm-2 (20) fica de fora, multi-1 (90, tambem OSM) entra.
    expect((data ?? []).map((r) => r.id).sort()).toEqual(['multi-1', 'osm-1'].sort());
  });

  it('limpar os filtros volta a retornar todas as empresas', async () => {
    const { client } = seedDb();
    const filtrado = await companiesQuery(client, USER_A, filtersWith({ source: 'LEGACY' }));
    const limpo = await companiesQuery(client, USER_A, filtersWith({}));
    expect(filtrado.data).toHaveLength(1);
    expect(limpo.data).toHaveLength(5);
  });
});

describe('companiesQuery — "Qualquer" nao filtra (regressao: Number("") virava 0)', () => {
  it('minRating/minReviews/minScore vazios nao excluem empresas com esses campos null', async () => {
    const { client } = seedDb();
    const { data } = await companiesQuery(
      client,
      USER_A,
      filtersWith({ minRating: '', minReviews: '', minScore: '' }),
    );
    // Todas as 5 empresas do usuario continuam, mesmo as com rating/review_count null.
    expect(data).toHaveLength(5);
  });
});

describe('companiesQuery — paginacao respeita os filtros', () => {
  it('7. filtro persistido via searchParams: a mesma string de query sempre produz o mesmo filtro', () => {
    const params = new URLSearchParams('source=OPENSTREETMAP&minScore=50&page=2');
    const parsed = companyFiltersSchema.parse(Object.fromEntries(params));
    expect(parsed.source).toBe('OPENSTREETMAP');
    expect(parsed.minScore).toBe(50);
    expect(parsed.page).toBe(2);
  });

  it('8. pagina 2 com filtro aplicado nao mistura resultados de fora do filtro', async () => {
    const { client } = seedDb();
    // So ha 3 empresas OSM (osm-1, osm-2, multi-1): com PAGE_SIZE=20 cabem todas na pagina 1.
    const pagina1 = await companiesQuery(client, USER_A, filtersWith({ source: 'OPENSTREETMAP', page: '1' }));
    const pagina2 = await companiesQuery(client, USER_A, filtersWith({ source: 'OPENSTREETMAP', page: '2' }));
    expect(pagina1.data).toHaveLength(3);
    expect(pagina2.data).toHaveLength(0);
    expect(pagina1.count).toBe(3);
  });

  it('9. count reflete o total filtrado, nao o total geral nem so a pagina atual', async () => {
    const { client } = seedDb();
    const { count, data } = await companiesQuery(client, USER_A, filtersWith({ source: 'GOOGLE_PLACES' }));
    expect(count).toBe(2);
    expect(data).toHaveLength(2);
    expect(count).not.toBe(5); // total geral do usuario, sem filtro
  });
});

describe('companiesQuery — isolamento entre usuarios (SPEC: user_id/auth.uid)', () => {
  it('10. usuario A nunca ve empresa de outro usuario, com ou sem filtro de fonte', async () => {
    const { client } = seedDb();
    const semFiltro = await companiesQuery(client, USER_A, filtersWith({}));
    const comFiltro = await companiesQuery(client, USER_A, filtersWith({ source: 'OPENSTREETMAP' }));

    expect((semFiltro.data ?? []).some((r) => r.id === 'other-user-1')).toBe(false);
    expect((comFiltro.data ?? []).some((r) => r.id === 'other-user-1')).toBe(false);
  });

  it('usuario B so ve a propria empresa, mesmo filtrando por uma fonte que ele tambem usa', async () => {
    const { client } = seedDb();
    const { data } = await companiesQuery(client, USER_B, filtersWith({ source: 'OPENSTREETMAP' }));
    expect((data ?? []).map((r) => r.id)).toEqual(['other-user-1']);
  });
});
