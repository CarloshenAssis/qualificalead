import { describe, expect, it } from 'vitest';
import { resolveIdentities, persistBusiness } from '@/lib/prospecting/sources/persist';
import { normalizeRawBusiness, type NormalizedBusiness } from '@/lib/prospecting/sources/normalize';
import { inferCompanySource } from '@/lib/prospecting/sources/identity';
import type { RawBusiness } from '@/lib/prospecting/sources/types';
import { createSupabaseMock, type Row } from './helpers/supabase-mock';

/**
 * Identidade neutra multi-source (SPEC 1.2 FASE 6).
 *
 * RLS e as constraints do banco (unicidade `user_id+source+source_id`, FK composta
 * tenant-safe) foram validadas contra um Postgres real local, nao aqui — ver o relatorio
 * da FASE 6. Estes testes cobrem a LOGICA de aplicacao: quando o pipeline reconhece um
 * lead ja existente, quando funde entre fontes, e quando so registra a suspeita.
 */

function osmBusiness(overrides: Partial<RawBusiness> = {}): NormalizedBusiness {
  const raw: RawBusiness = {
    source: 'OPENSTREETMAP',
    sourceId: 'node/1',
    name: 'Padaria Central',
    address: 'Rua das Flores, 100',
    city: 'Sao Jose dos Campos',
    phone: '(12) 3921-0000',
    latitude: -23.2,
    longitude: -45.9,
    ...overrides,
  };
  return normalizeRawBusiness(raw)!;
}

function googleBusiness(overrides: Partial<RawBusiness> = {}): NormalizedBusiness {
  const raw: RawBusiness = {
    source: 'GOOGLE_PLACES',
    sourceId: 'ChIJ_google_1',
    name: 'Padaria Central Ltda',
    address: 'Rua das Flores, 100',
    city: 'Sao Jose dos Campos',
    phone: '(12) 3921-0000',
    latitude: -23.2001,
    longitude: -45.9001,
    ...overrides,
  };
  return normalizeRawBusiness(raw)!;
}

function buildRowFor(business: NormalizedBusiness) {
  return () => ({
    user_id: 'user-1',
    google_place_id: business.source === 'GOOGLE_PLACES' ? business.sourceId : null,
    name: business.name,
    category: business.category,
    categories: business.categories,
    description: business.description,
    phone: business.phone,
    phone_international: business.phoneInternational,
    whatsapp: business.phone,
    website: business.website,
    website_status: business.websiteStatus,
    website_checked_at: new Date().toISOString(),
    google_maps_url: business.sourceUrl,
    address: business.address,
    city: business.city,
    state: business.state,
    country: business.country,
    latitude: business.latitude,
    longitude: business.longitude,
    rating: business.rating,
    review_count: business.reviewCount,
    opening_hours: business.openingHours,
    business_status: business.businessStatus,
    instagram_url: null,
    instagram_handle: null,
    instagram_confidence: null,
    instagram_status: 'NOT_FOUND' as const,
    instagram_source: null,
    instagram_evidence: [],
    instagram_checked_at: null,
    opportunity_score: 0,
    opportunity_level: 'BAIXA' as const,
    score_breakdown: [],
    google_business_quality: 'NOT_APPLICABLE' as const,
    next_action: 'RESEARCH_MORE' as const,
    next_action_reason: null,
    enrichment_status: 'OK' as const,
    enrichment_error: null,
    source_data: { source: business.source, source_id: business.sourceId },
    dedup_key: `${business.name}|${business.phone}`,
    last_checked_at: new Date().toISOString(),
  });
}

describe('lead_sources — criacao e unicidade (SPEC 1.2 FASE 6)', () => {
  it('uma empresa nova ganha exatamente uma linha em lead_sources', async () => {
    const { client, tables } = createSupabaseMock();
    const business = osmBusiness();

    const [identity] = await resolveIdentities(client, 'user-1', 'Sao Jose dos Campos', [business]);
    const outcome = await persistBusiness(client, 'user-1', business, identity, buildRowFor(business), {
      sourceUrl: null,
      sourceQuality: 'HIGH',
      rawData: {},
    });

    expect(outcome.isNew).toBe(true);
    expect(tables.lead_sources).toHaveLength(1);
    expect(tables.lead_sources[0]).toMatchObject({
      user_id: 'user-1',
      company_id: outcome.companyId,
      source: 'OPENSTREETMAP',
      source_id: 'node/1',
    });
  });

  it('a mesma fonte+source_id encontrada de novo reconhece o lead existente (match exato)', async () => {
    const { client, tables } = createSupabaseMock();
    const business = osmBusiness();

    const [firstIdentity] = await resolveIdentities(client, 'user-1', 'Sao Jose dos Campos', [business]);
    const first = await persistBusiness(client, 'user-1', business, firstIdentity, buildRowFor(business), {
      sourceUrl: null,
      sourceQuality: 'HIGH',
      rawData: {},
    });

    // Mesma pesquisa rodada de novo (ex.: usuario repete a prospeccao).
    const [secondIdentity] = await resolveIdentities(client, 'user-1', 'Sao Jose dos Campos', [business]);
    expect(secondIdentity.kind).toBe('EXACT');

    const second = await persistBusiness(client, 'user-1', business, secondIdentity, buildRowFor(business), {
      sourceUrl: null,
      sourceQuality: 'HIGH',
      rawData: {},
    });

    expect(second.isNew).toBe(false);
    expect(second.companyId).toBe(first.companyId);
    // Nao duplica a linha de lead_sources: upsert no mesmo (user_id, source, source_id).
    expect(tables.lead_sources).toHaveLength(1);
    expect(tables.companies).toHaveLength(1);
  });
});

describe('multiplas fontes para o mesmo lead — consolidacao cross-source (SPEC 1.2 FASE 6)', () => {
  it('telefone identico (sinal forte) funde automaticamente: uma empresa, duas linhas em lead_sources', async () => {
    const { client, tables } = createSupabaseMock();
    const osm = osmBusiness();
    const google = googleBusiness(); // mesmo telefone normalizado, nome/endereco parecidos

    const [osmIdentity] = await resolveIdentities(client, 'user-1', 'Sao Jose dos Campos', [osm]);
    await persistBusiness(client, 'user-1', osm, osmIdentity, buildRowFor(osm), {
      sourceUrl: null,
      sourceQuality: 'MEDIUM',
      rawData: {},
    });

    const [googleIdentity] = await resolveIdentities(client, 'user-1', 'Sao Jose dos Campos', [google]);
    expect(googleIdentity.kind).toBe('CONSOLIDATED');
    if (googleIdentity.kind === 'CONSOLIDATED') {
      expect(googleIdentity.signals).toContain('PHONE_MATCH');
    }

    const result = await persistBusiness(client, 'user-1', google, googleIdentity, buildRowFor(google), {
      sourceUrl: null,
      sourceQuality: 'HIGH',
      rawData: {},
    });

    expect(result.isNew).toBe(false);
    // Uma unica empresa...
    expect(tables.companies).toHaveLength(1);
    // ...com duas origens: OSM e Google (o diagrama "Lead -> OSM / Google / Foursquare" da SPEC).
    expect(tables.lead_sources).toHaveLength(2);
    expect(tables.lead_sources.map((r) => r.source).sort()).toEqual(['GOOGLE_PLACES', 'OPENSTREETMAP']);
    expect(tables.lead_sources.every((r) => r.company_id === result.companyId)).toBe(true);
    // Nenhuma linha de "possivel duplicidade": telefone bateu, nao ha incerteza.
    expect(tables.lead_duplicate_candidates).toHaveLength(0);
  });

  it('so nome parecido (sem telefone/site batendo) NUNCA funde automaticamente', async () => {
    const { client, tables } = createSupabaseMock();
    const osm = osmBusiness({ phone: '(12) 3921-0000' });
    // Mesmo nome, mesmo endereco, mas telefone diferente e sem site — sinal fraco
    // (nome+endereco, nunca telefone/site) e por isso nunca pode chegar a HIGH.
    const similarButDifferentPhone = googleBusiness({
      sourceId: 'ChIJ_outro',
      name: 'Padaria Central',
      phone: '(12) 90000-0000',
      latitude: -23.2,
      longitude: -45.9,
    });

    const [osmIdentity] = await resolveIdentities(client, 'user-1', 'Sao Jose dos Campos', [osm]);
    await persistBusiness(client, 'user-1', osm, osmIdentity, buildRowFor(osm), {
      sourceUrl: null,
      sourceQuality: 'MEDIUM',
      rawData: {},
    });

    const [identity] = await resolveIdentities(client, 'user-1', 'Sao Jose dos Campos', [similarButDifferentPhone]);

    // Nome+endereco batendo e MEDIUM, nunca HIGH — nao pode virar fusao automatica.
    expect(identity.kind).not.toBe('CONSOLIDATED');

    await persistBusiness(client, 'user-1', similarButDifferentPhone, identity, buildRowFor(similarButDifferentPhone), {
      sourceUrl: null,
      sourceQuality: 'HIGH',
      rawData: {},
    });

    // Duas empresas distintas continuam existindo — nada foi apagado nem fundido.
    expect(tables.companies).toHaveLength(2);
    // A suspeita fica registrada para revisao, nao decidida sozinha.
    expect(tables.lead_duplicate_candidates).toHaveLength(1);
    expect(tables.lead_duplicate_candidates[0].confidence).toBe('MEDIUM');
  });

  it('nenhum sinal em comum: duas empresas seguem totalmente independentes, sem evidencia registrada', async () => {
    const { client, tables } = createSupabaseMock();
    const a = osmBusiness({ sourceId: 'node/1', name: 'Padaria Central', phone: '(12) 3921-0000' });
    const b = osmBusiness({
      sourceId: 'node/2',
      name: 'Barbearia do Ze',
      phone: '(12) 90000-1111',
      address: 'Rua B, 200',
      latitude: -23.5,
      longitude: -46.5,
    });

    for (const business of [a, b]) {
      const [identity] = await resolveIdentities(client, 'user-1', 'Sao Jose dos Campos', [business]);
      await persistBusiness(client, 'user-1', business, identity, buildRowFor(business), {
        sourceUrl: null,
        sourceQuality: 'HIGH',
        rawData: {},
      });
    }

    expect(tables.companies).toHaveLength(2);
    expect(tables.lead_duplicate_candidates).toHaveLength(0);
  });
});

describe('LEGACY — leads sem origem registrada (SPEC 1.2 §76)', () => {
  it('empresa sem source_data e sem google_place_id nunca tem origem inferida: vira LEGACY', () => {
    const { source, sourceId } = inferCompanySource({ source_data: null, google_place_id: null });
    expect(source).toBe('LEGACY');
    // Nunca um id interno (company.id) fingindo ser um id externo (SPEC 1.2 FASE 6).
    expect(sourceId).toBeNull();
  });

  it('empresa com google_place_id (todo lead da 1.1) e reconhecida como GOOGLE_PLACES, preservando o id', () => {
    const { source, sourceId } = inferCompanySource({ source_data: null, google_place_id: 'ChIJ_legado' });
    expect(source).toBe('GOOGLE_PLACES');
    expect(sourceId).toBe('ChIJ_legado');
  });

  it('empresa com source_data da FASE 4 (ex.: OSM) usa exatamente o que foi gravado, sem reinterpretar', () => {
    const { source, sourceId } = inferCompanySource({
      source_data: { source: 'OPENSTREETMAP', source_id: 'node/42' },
      google_place_id: null,
    });
    expect(source).toBe('OPENSTREETMAP');
    expect(sourceId).toBe('node/42');
  });
});

describe('isolamento por usuario na resolucao de identidade (defesa em profundidade — RLS e a garantia real)', () => {
  it('match exato de um usuario nunca e devolvido para outro usuario com o mesmo source_id', async () => {
    const rowsSeed: Row[] = [
      { id: 'company-a', user_id: 'user-a', name: 'Padaria A' },
      { id: 'ls-a', user_id: 'user-a', company_id: 'company-a', source: 'OPENSTREETMAP', source_id: 'node/1' },
    ];
    const { client } = createSupabaseMock({ companies: [rowsSeed[0]], lead_sources: [rowsSeed[1]] });

    const business = osmBusiness(); // mesmo sourceId 'node/1'
    const [identityForOwner] = await resolveIdentities(client, 'user-a', 'Sao Jose dos Campos', [business]);
    const [identityForOther] = await resolveIdentities(client, 'user-b', 'Sao Jose dos Campos', [business]);

    expect(identityForOwner.kind).toBe('EXACT');
    expect(identityForOther.kind).toBe('NEW');
  });

  it('candidatos de consolidacao de um usuario nunca vazam para outro', async () => {
    const { client, tables } = createSupabaseMock({
      companies: [
        {
          id: 'company-a',
          user_id: 'user-a',
          name: 'Padaria Central',
          city: 'Sao Jose dos Campos',
          phone: '(12) 3921-0000',
          whatsapp: '551239210000',
          website: null,
          address: 'Rua das Flores, 100',
          latitude: -23.2,
          longitude: -45.9,
        },
      ],
    });

    // Usuario B descobre uma empresa com o MESMO telefone — nao pode consolidar com a
    // empresa de A, mesmo que o sinal bateria se fosse do mesmo tenant.
    const business = googleBusiness();
    const [identity] = await resolveIdentities(client, 'user-b', 'Sao Jose dos Campos', [business]);

    expect(identity.kind).toBe('NEW');
    expect(tables.companies.filter((c) => c.user_id === 'user-b')).toHaveLength(0);
  });
});
