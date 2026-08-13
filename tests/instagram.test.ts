import { describe, expect, it } from 'vitest';
import {
  SIGNAL_WEIGHTS,
  handleNameAffinity,
  rankCandidates,
  scoreCandidate,
} from '@/lib/instagram/discover';
import {
  SOURCE_OFFICIAL_SITE,
  SOURCE_WEB_SEARCH,
  extractInstagramHandles,
  type CompanySignals,
  type InstagramCandidate,
} from '@/lib/instagram/shared';
import { instagramConfidenceTier } from '@/lib/scoring/config';

const COMPANY: CompanySignals = {
  name: 'Restaurante Sabor da Terra',
  category: 'Restaurante italiano',
  city: 'Sao Jose dos Campos',
  state: 'SP',
  phone: '(12) 3921-0000',
  website: null,
};

function candidate(overrides: Partial<InstagramCandidate> = {}): InstagramCandidate {
  return { handle: 'sabordaterra', context: '', source: SOURCE_WEB_SEARCH, ...overrides };
}

describe('extractInstagramHandles', () => {
  it('encontra perfis em links', () => {
    const html = `
      <a href="https://www.instagram.com/sabordaterra/">Instagram</a>
      <a href="https://instagram.com/outraconta">Outro</a>
    `;
    expect(extractInstagramHandles(html)).toEqual(['sabordaterra', 'outraconta']);
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
    expect(extractInstagramHandles('https://instagram.com/loja https://www.instagram.com/loja')).toEqual([
      'loja',
    ]);
  });
});

describe('handleNameAffinity', () => {
  it('reconhece nome identico e contido', () => {
    expect(handleNameAffinity('restaurantesabordaterra', 'Restaurante Sabor da Terra')).toBe(1);
    expect(handleNameAffinity('sabordaterra', 'Restaurante Sabor da Terra')).toBeGreaterThan(0.5);
  });

  it('nao associa perfis sem relacao com o nome', () => {
    expect(handleNameAffinity('agenciaweb', 'Restaurante Sabor da Terra')).toBe(0);
  });
});

describe('scoreCandidate', () => {
  it('nome sozinho nao alcanca a faixa alta (SPEC 1.1 §23)', () => {
    const { confidence } = scoreCandidate(candidate({ context: '' }), COMPANY);
    expect(confidence).toBe(SIGNAL_WEIGHTS.NAME);
    expect(instagramConfidenceTier(confidence)).toBe('LOW');
  });

  it('combina nome, cidade, categoria e telefone', () => {
    const { confidence, evidence } = scoreCandidate(
      candidate({
        handle: 'sabordaterra.sjc',
        context: 'Sabor da Terra - Restaurante em Sao Jose dos Campos - (12) 3921-0000',
      }),
      COMPANY,
    );

    expect(confidence).toBeGreaterThanOrEqual(50);
    const matched = evidence.filter((e) => e.matched).map((e) => e.signal);
    expect(matched).toContain('NAME');
    expect(matched).toContain('CITY');
    expect(matched).toContain('CATEGORY');
    expect(matched).toContain('PHONE');
  });

  it('link no site oficial e a evidencia mais forte', () => {
    const { confidence, evidence } = scoreCandidate(
      candidate({ source: SOURCE_OFFICIAL_SITE, context: 'sabordaterra.com.br' }),
      COMPANY,
    );

    expect(evidence.find((e) => e.signal === 'OFFICIAL_SITE')?.matched).toBe(true);
    expect(instagramConfidenceTier(confidence)).toBe('HIGH');
  });

  it('registra evidencia tambem quando o sinal nao bate', () => {
    const { evidence } = scoreCandidate(candidate({ handle: 'outracoisa' }), COMPANY);
    expect(evidence.find((e) => e.signal === 'NAME')?.matched).toBe(false);
    expect(evidence).toHaveLength(6);
  });

  it('nunca ultrapassa 100', () => {
    const { confidence } = scoreCandidate(
      candidate({
        handle: 'sabordaterra',
        source: SOURCE_OFFICIAL_SITE,
        context: 'Sabor da Terra Restaurante Sao Jose dos Campos 1239210000',
      }),
      { ...COMPANY, website: 'https://sabordaterra.com.br' },
    );
    expect(confidence).toBeLessThanOrEqual(100);
  });
});

describe('rankCandidates', () => {
  it('nao inventa perfil quando nao ha candidato', () => {
    const result = rankCandidates([], COMPANY);
    expect(result.instagram_url).toBeNull();
    expect(result.instagram_status).toBe('NOT_FOUND');
  });

  it('escolhe o candidato com mais evidencias', () => {
    const result = rankCandidates(
      [
        candidate({ handle: 'saborsjc', context: 'Sao Jose dos Campos' }),
        candidate({
          handle: 'sabordaterra',
          context: 'Restaurante em Sao Jose dos Campos',
        }),
      ],
      COMPANY,
    );

    expect(result.instagram_handle).toBe('@sabordaterra');
    expect(result.instagram_source).toBe(SOURCE_WEB_SEARCH);
  });

  it('reduz a confianca quando ha empate real entre candidatos', () => {
    const single = rankCandidates([candidate({ handle: 'sabordaterra' })], COMPANY);
    const tied = rankCandidates(
      [candidate({ handle: 'sabordaterra' }), candidate({ handle: 'sabordaterra.oficial' })],
      COMPANY,
    );

    expect(single.instagram_confidence).toBe(SIGNAL_WEIGHTS.NAME);
    expect(tied.instagram_confidence!).toBeLessThan(single.instagram_confidence!);
  });

  it('descarta candidato sem nenhum sinal de correspondencia', () => {
    const result = rankCandidates(
      [candidate({ handle: 'agenciaweb', context: 'agencia de marketing digital' })],
      COMPANY,
    );

    expect(result.instagram_status).toBe('NOT_FOUND');
    expect(result.instagram_url).toBeNull();
  });

  it('deixa sempre pendente de confirmacao humana e registra proveniencia', () => {
    const result = rankCandidates([candidate({ source: SOURCE_OFFICIAL_SITE })], COMPANY);
    expect(result.instagram_status).toBe('PENDING');
    expect(result.instagram_source).toBe(SOURCE_OFFICIAL_SITE);
    expect(result.instagram_checked_at).not.toBeNull();
    expect(result.instagram_evidence.length).toBeGreaterThan(0);
  });
});

describe('instagramConfidenceTier', () => {
  it('respeita as faixas da SPEC 1.1 §22', () => {
    expect(instagramConfidenceTier(0)).toBe('LOW');
    expect(instagramConfidenceTier(39)).toBe('LOW');
    expect(instagramConfidenceTier(40)).toBe('POSSIBLE');
    expect(instagramConfidenceTier(69)).toBe('POSSIBLE');
    expect(instagramConfidenceTier(70)).toBe('HIGH');
    expect(instagramConfidenceTier(89)).toBe('HIGH');
    expect(instagramConfidenceTier(90)).toBe('VERY_HIGH');
    expect(instagramConfidenceTier(100)).toBe('VERY_HIGH');
  });
});
