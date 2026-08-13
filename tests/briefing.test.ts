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
      'GOOGLE',
      'PRESENCA DIGITAL',
      'INSTAGRAM',
      'DESCRICAO ENCONTRADA',
      'DADOS IDENTIFICADOS',
      'DADOS AUSENTES',
      'INFORMACOES QUE PRECISAM SER CONFIRMADAS',
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
    expect(text).toContain('INFORMACOES FORNECIDAS MANUALMENTE');
    expect(text).toContain('Massas e pizzas');
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

  it('nao expoe Instagram ainda nao confirmado', () => {
    const prompt = buildLovablePrompt(
      company({
        instagram_url: 'https://instagram.com/cantina',
        instagram_status: 'PENDING',
        instagram_confidence: 85,
      }),
    );
    expect(prompt).not.toContain('instagram.com/cantina');
    expect(prompt).toContain('Instagram confirmado');
  });
});
