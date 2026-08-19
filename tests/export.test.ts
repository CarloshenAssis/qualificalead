import { describe, expect, it } from 'vitest';
import { buildCsv } from '@/lib/export/csv';
import { buildXlsx, buildXlsxFromRows } from '@/lib/export/xlsx';
import { EXPORT_HEADERS } from '@/lib/export/rows';
import type { CompanyWithLead } from '@/types/database';

function company(overrides: Partial<CompanyWithLead> = {}): CompanyWithLead {
  return {
    id: 'id-1',
    user_id: 'user-1',
    google_place_id: 'ChIJ1',
    name: 'Bar do "Ze", Ltda',
    category: 'Bar',
    categories: null,
    description: null,
    phone: '(12) 99999-0000',
    phone_international: '+55 12 99999-0000',
    whatsapp: '5512999990000',
    website: null,
    website_status: 'NO_WEBSITE_DETECTED',
    google_maps_url: null,
    address: 'Rua A, 1\nCentro',
    city: 'Sao Jose dos Campos',
    state: 'SP',
    country: 'BR',
    latitude: null,
    longitude: null,
    rating: 4.6,
    review_count: 42,
    opening_hours: null,
    business_status: 'OPERATIONAL',
    instagram_url: null,
    instagram_handle: null,
    instagram_confidence: null,
    instagram_status: 'NOT_FOUND',
    opportunity_score: 73,
    opportunity_level: 'ALTA',
    score_breakdown: [],
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
    last_checked_at: null,
    leads: null,
    lead_sources: [],
    ...overrides,
  };
}

describe('buildCsv', () => {
  it('escapa aspas, virgulas e quebras de linha', () => {
    const csv = buildCsv([company()]);
    expect(csv).toContain('"Bar do ""Ze"", Ltda"');
    expect(csv).toContain('"Rua A, 1\nCentro"');
  });

  it('mantem o cabecalho na ordem definida', () => {
    const csv = buildCsv([]);
    expect(csv.replace('﻿', '').split('\r\n')[0]).toBe(EXPORT_HEADERS.join(','));
  });

  it('inclui o link de WhatsApp normalizado', () => {
    expect(buildCsv([company()])).toContain('https://wa.me/5512999990000');
  });

  it('inclui as colunas de fonte (SPEC 1.2 FASE 7 §7)', () => {
    for (const header of ['source', 'source_id', 'source_url', 'source_quality']) {
      expect(EXPORT_HEADERS).toContain(header);
    }

    const csv = buildCsv([
      company({
        lead_sources: [
          { source: 'OPENSTREETMAP', source_id: 'node/1', source_url: 'https://osm.example/1', source_quality: 'HIGH' },
        ],
      }),
    ]);
    expect(csv).toContain('OPENSTREETMAP,node/1,https://osm.example/1,HIGH');
  });

  it('preserva todas as fontes de um lead MULTI_SOURCE, alinhadas por posicao', () => {
    const csv = buildCsv([
      company({
        lead_sources: [
          { source: 'OPENSTREETMAP', source_id: 'node/1', source_url: 'https://osm.example/1', source_quality: 'HIGH' },
          { source: 'GOOGLE_PLACES', source_id: 'ChIJ9', source_url: 'https://maps.example/9', source_quality: 'MEDIUM' },
        ],
      }),
    ]);
    expect(csv).toContain('OPENSTREETMAP; GOOGLE_PLACES,node/1; ChIJ9,https://osm.example/1; https://maps.example/9,HIGH; MEDIUM');
  });
});

describe('buildXlsx', () => {
  it('gera um pacote ZIP valido', () => {
    const file = buildXlsx([company()]);
    // Assinatura local de arquivo ZIP.
    expect(Array.from(file.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
    // Fim do diretorio central.
    expect(file.length).toBeGreaterThan(22);
  });

  it('escapa XML no conteudo das celulas', () => {
    const file = buildXlsxFromRows([['<script>&"teste"']]);
    const text = new TextDecoder().decode(file);
    expect(text).toContain('&lt;script&gt;&amp;&quot;teste&quot;');
    expect(text).not.toContain('<script>');
  });

  it('grava numeros como numero e texto como inline string', () => {
    const text = new TextDecoder().decode(buildXlsxFromRows([['73', 'Alta']]));
    expect(text).toContain('<c r="A1"><v>73</v></c>');
    expect(text).toContain('t="inlineStr"');
  });
});
