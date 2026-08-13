import { describe, expect, it } from 'vitest';
import { GooglePlacesError, MAX_ATTEMPTS, mapGoogleError } from '@/lib/google/places';
import { isFresh } from '@/lib/prospecting/run';
import { DEFAULT_DIGITAL_PRESENCE_TTL_DAYS } from '@/lib/env';

describe('mapGoogleError', () => {
  it('mapeia os codigos conhecidos da API (SPEC 1.1 §55)', () => {
    expect(mapGoogleError(400, '{"error":{"status":"INVALID_ARGUMENT"}}').code).toBe(
      'INVALID_ARGUMENT',
    );
    expect(mapGoogleError(401, '').code).toBe('UNAUTHENTICATED');
    expect(mapGoogleError(403, '{"error":{"status":"PERMISSION_DENIED"}}').code).toBe(
      'PERMISSION_DENIED',
    );
    expect(mapGoogleError(429, '').code).toBe('RESOURCE_EXHAUSTED');
    expect(mapGoogleError(404, '').code).toBe('NOT_FOUND');
    expect(mapGoogleError(500, '').code).toBe('INTERNAL');
  });

  it('reconhece o status no corpo mesmo com HTTP generico', () => {
    expect(mapGoogleError(200, 'RESOURCE_EXHAUSTED: quota').code).toBe('RESOURCE_EXHAUSTED');
  });

  it('gera mensagem util para o usuario final, sem stack trace', () => {
    const error = mapGoogleError(403, 'permission denied');
    expect(error.message).toContain('permissao');
    expect(error.message).not.toContain('Error:');
  });

  it('nunca vaza o corpo inteiro da resposta na mensagem', () => {
    const error = mapGoogleError(500, 'x'.repeat(5000));
    expect(error.message.length).toBeLessThan(200);
  });
});

describe('retry', () => {
  it('so marca como repetivel erro transitorio (SPEC 1.1 §56)', () => {
    expect(new GooglePlacesError('INTERNAL', 'x').retryable).toBe(true);
    expect(new GooglePlacesError('NETWORK', 'x').retryable).toBe(true);
    expect(new GooglePlacesError('RESOURCE_EXHAUSTED', 'x').retryable).toBe(true);

    expect(new GooglePlacesError('UNAUTHENTICATED', 'x').retryable).toBe(false);
    expect(new GooglePlacesError('PERMISSION_DENIED', 'x').retryable).toBe(false);
    expect(new GooglePlacesError('INVALID_ARGUMENT', 'x').retryable).toBe(false);
    expect(new GooglePlacesError('NOT_CONFIGURED', 'x').retryable).toBe(false);
  });

  it('limita o numero de tentativas', () => {
    expect(MAX_ATTEMPTS).toBeLessThanOrEqual(3);
    expect(MAX_ATTEMPTS).toBeGreaterThanOrEqual(1);
  });
});

describe('cache de presenca digital', () => {
  const days = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();

  it('reaproveita dados recentes e permite atualizar os antigos (SPEC 1.1 §12)', () => {
    expect(isFresh(days(1))).toBe(true);
    expect(isFresh(days(DEFAULT_DIGITAL_PRESENCE_TTL_DAYS - 1))).toBe(true);
    expect(isFresh(days(DEFAULT_DIGITAL_PRESENCE_TTL_DAYS + 1))).toBe(false);
  });

  it('trata ausencia e data invalida como "precisa verificar"', () => {
    expect(isFresh(null)).toBe(false);
    expect(isFresh('nao e uma data')).toBe(false);
  });

  it('respeita um TTL customizado', () => {
    expect(isFresh(days(10), 30)).toBe(true);
    expect(isFresh(days(10), 3)).toBe(false);
  });
});
