import { describe, expect, it } from 'vitest';
import {
  CONFIDENCE,
  extractInstagramHandles,
  handleNameAffinity,
  rankCandidates,
} from '@/lib/instagram/discover';

describe('extractInstagramHandles', () => {
  it('encontra perfis em links do site', () => {
    const html = `
      <a href="https://www.instagram.com/cantinadanona/">Instagram</a>
      <a href="https://instagram.com/outraconta">Outro</a>
    `;
    expect(extractInstagramHandles(html)).toEqual(['cantinadanona', 'outraconta']);
  });

  it('ignora caminhos que nao sao perfis', () => {
    const html = `
      <a href="https://instagram.com/p/ABC123/">post</a>
      <a href="https://instagram.com/explore/tags/food/">tag</a>
      <a href="https://instagram.com/accounts/login">login</a>
    `;
    expect(extractInstagramHandles(html)).toEqual([]);
  });

  it('nao duplica o mesmo perfil', () => {
    const html = 'https://instagram.com/loja https://www.instagram.com/loja';
    expect(extractInstagramHandles(html)).toEqual(['loja']);
  });
});

describe('handleNameAffinity', () => {
  it('reconhece nome identico e contido', () => {
    expect(handleNameAffinity('cantinadanona', 'Cantina da Nona')).toBe(1);
    expect(handleNameAffinity('cantina', 'Cantina da Nona')).toBeGreaterThan(0.5);
  });

  it('nao associa perfis sem relacao com o nome', () => {
    expect(handleNameAffinity('agenciaweb', 'Cantina da Nona')).toBe(0);
  });
});

describe('rankCandidates', () => {
  it('nao inventa perfil quando nao ha candidato', () => {
    const result = rankCandidates([], 'Cantina da Nona');
    expect(result.instagram_url).toBeNull();
    expect(result.instagram_status).toBe('NOT_FOUND');
  });

  it('da confianca maxima quando o handle bate com o nome', () => {
    const result = rankCandidates(['cantinadanona', 'agenciaweb'], 'Cantina da Nona');
    expect(result.instagram_handle).toBe('@cantinadanona');
    expect(result.instagram_confidence).toBe(CONFIDENCE.OFFICIAL_SITE_NAME_MATCH);
  });

  it('reduz a confianca quando ha varios perfis sem relacao com o nome', () => {
    const result = rankCandidates(['agenciaweb', 'fotografo'], 'Cantina da Nona');
    expect(result.instagram_confidence).toBe(CONFIDENCE.OFFICIAL_SITE_AMBIGUOUS);
  });

  it('deixa sempre pendente de confirmacao humana', () => {
    expect(rankCandidates(['cantinadanona'], 'Cantina da Nona').instagram_status).toBe('PENDING');
  });
});
