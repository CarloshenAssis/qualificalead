import { describe, expect, it } from 'vitest';
import { buildBriefing } from '@/lib/briefing/generate';
import { buildLovablePrompt } from '@/lib/briefing/lovable';
import type { Company } from '@/types/database';

function company(overrides: Partial<Company> = {}): Company {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    user_id: '22222222-2222-2222-2222-222222222222',
    google_place_id: 'ChIJ123',
    name: 'Cantina da Nona',
    category: 'Restaurante italiano',
    categories: ['restaurant'],
    description: null,
    phone: '(12) 3921-0000',
    phone_international: '+55 12 3921-0000',
    whatsapp: '551239210000',
    website: null,
    website_status: 'NO_WEBSITE_DETECTED',
    google_maps_url: 'https://maps.google.com/?cid=1',
    address: 'Rua das Flores, 100',
    city: 'Sao Jose dos Campos',
    state: 'SP',
    country: 'BR',
    latitude: -23.1791,
    longitude: -45.8872,
    rating: 4.8,
    review_count: 183,
    opening_hours: null,
    business_status: 'OPERATIONAL',
    instagram_url: null,
    instagram_handle: null,
    instagram_confidence: null,
    instagram_status: 'NOT_FOUND',
    opportunity_score: 87,
    opportunity_level: 'EXCELENTE',
    score_breakdown: [{ code: 'NO_WEBSITE', label: 'Site nao identificado', points: 30 }],
    instagram_source: null,
    instagram_evidence: [],
    instagram_checked_at: null,
    website_checked_at: null,
    google_business_quality: 'MEDIUM',
    next_action: 'RESEARCH_MORE',
    next_action_reason: null,
    enrichment_status: 'OK',
    enrichment_error: null,
    source_data: null,
    dedup_key: null,
    created_at: '2026-01-01T12:00:00.000Z',
    updated_at: '2026-01-01T12:00:00.000Z',
    last_checked_at: '2026-01-01T12:00:00.000Z',
    ...overrides,
  };
}

describe('buildBriefing', () => {
  it('contem todas as secoes previstas', () => {
    const text = buildBriefing(company());
    for (const section of [
      'NOME DA EMPRESA',
      'SEGMENTO',
      'LOCALIZACAO',
      'CONTATOS',
      'FONTE DOS DADOS',
      'PERFIL COMERCIAL',
      'PRESENCA DIGITAL',
      'INSTAGRAM',
      'DESCRICAO ENCONTRADA',
      'INFORMACOES AUTOMATICAS',
      'INFORMACOES CONFIRMADAS',
      'INFORMACOES PENDENTES / A CONFIRMAR',
      'DADOS PARA COMPLETAR',
      'SUGESTAO DE ESTRUTURA DO SITE',
    ]) {
      expect(text).toContain(section);
    }
  });

  it('marca lacunas em vez de preencher', () => {
    const text = buildBriefing(company({ description: null, opening_hours: null }));
    expect(text).toContain('Nao encontrado');
    expect(text).toContain('Horario de funcionamento');
  });

  it('nao afirma ausencia de site de forma absoluta', () => {
    const text = buildBriefing(company());
    expect(text).toContain('Site nao identificado');
    expect(text).toContain('Confirmar com a empresa se realmente nao existe site');
  });

  it('separa os dados informados manualmente', () => {
    const text = buildBriefing(company(), { services: 'Massas e pizzas' });
    expect(text).toContain('INFORMACOES CONFIRMADAS (fornecidas por voce)');
    expect(text).toContain('Massas e pizzas');
  });

  it('nao afirma Google quando a fonte nao foi informada (SPEC 1.2 FASE 7 §6)', () => {
    const text = buildBriefing(company());
    expect(text).toContain('Origem nao registrada');
    expect(text).not.toContain('coletadas do Google');
  });

  it('preserva a proveniencia real quando a fonte e informada', () => {
    const text = buildBriefing(company(), {}, 'OpenStreetMap');
    expect(text).toContain('OpenStreetMap');
    expect(text).toContain('INFORMACOES AUTOMATICAS (coletadas de OpenStreetMap)');
  });
});

describe('buildLovablePrompt', () => {
  it('instrui explicitamente a nao inventar dados', () => {
    const prompt = buildLovablePrompt(company());
    expect(prompt).toContain('NAO invente dados');
    expect(prompt).toContain('[PREENCHER: item]');
  });

  it('inclui o link de WhatsApp quando ha telefone', () => {
    expect(buildLovablePrompt(company())).toContain('https://wa.me/551239210000');
  });

  it('usa placeholder de contato quando nao ha telefone', () => {
    const prompt = buildLovablePrompt(company({ phone: null, phone_international: null }));
    expect(prompt).toContain('[PREENCHER: telefone/WhatsApp]');
    expect(prompt).not.toContain('wa.me');
  });

  it('separa dados confirmados de dados a confirmar (SPEC 1.1 §38)', () => {
    const prompt = buildLovablePrompt(
      company({
        instagram_url: 'https://instagram.com/cantina',
        instagram_handle: '@cantina',
        instagram_status: 'PENDING',
        instagram_confidence: 85,
      }),
    );

    const confirmedBlock = prompt.slice(
      prompt.indexOf('DADOS CONFIRMADOS'),
      prompt.indexOf('DADOS A CONFIRMAR'),
    );
    const pendingBlock = prompt.slice(
      prompt.indexOf('DADOS A CONFIRMAR'),
      prompt.indexOf('DADOS QUE AINDA NAO EXISTEM'),
    );

    // O perfil pendente nunca entra como dado confirmado.
    expect(confirmedBlock).not.toContain('cantina');
    expect(pendingBlock).toContain('@cantina');
    expect(pendingBlock).toContain('nao apresentar como perfil oficial');
  });

  it('lista Instagram confirmado entre os dados confirmados', () => {
    const prompt = buildLovablePrompt(
      company({
        instagram_url: 'https://instagram.com/cantina',
        instagram_handle: '@cantina',
        instagram_status: 'CONFIRMED',
        instagram_confidence: 100,
      }),
    );

    const confirmedBlock = prompt.slice(
      prompt.indexOf('DADOS CONFIRMADOS'),
      prompt.indexOf('DADOS A CONFIRMAR'),
    );
    expect(confirmedBlock).toContain('Instagram confirmado: https://instagram.com/cantina');
  });

  it('reforca a instrucao de nao inventar dados pendentes (SPEC 1.1 §39)', () => {
    const prompt = buildLovablePrompt(company());
    expect(prompt).toContain('Nao invente informacoes sobre a empresa.');
    expect(prompt).toContain('nao crie conteudo factual');
    expect(prompt).toContain('[PREENCHER: item]');
  });

  it('inclui a fonte dos dados entre os dados confirmados (SPEC 1.2 FASE 7 §6)', () => {
    const prompt = buildLovablePrompt(company(), {}, 'OpenStreetMap');
    const confirmedBlock = prompt.slice(prompt.indexOf('DADOS CONFIRMADOS'), prompt.indexOf('DADOS A CONFIRMAR'));
    expect(confirmedBlock).toContain('Fonte dos dados: OpenStreetMap');
    expect(prompt).not.toContain('no Google');
  });
});
