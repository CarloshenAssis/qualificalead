import { describe, expect, it } from 'vitest';
import { formatPhoneDisplay, normalizePhone, whatsappLink } from '@/lib/whatsapp/phone';

describe('normalizePhone', () => {
  it('acrescenta o DDI brasileiro em numeros nacionais', () => {
    expect(normalizePhone('(12) 99999-0000')).toBe('5512999990000');
    expect(normalizePhone('12 3456-7890')).toBe('551234567890');
  });

  it('remove o zero de operadora', () => {
    expect(normalizePhone('012 99999-0000')).toBe('5512999990000');
  });

  it('preserva numeros ja internacionais', () => {
    expect(normalizePhone('+55 12 99999-0000')).toBe('5512999990000');
    expect(normalizePhone('+1 415 555 2671')).toBe('14155552671');
    expect(normalizePhone('0055 12 99999-0000')).toBe('5512999990000');
  });

  it('devolve null quando o numero nao e plausivel', () => {
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone('sem telefone')).toBeNull();
    expect(normalizePhone('1234')).toBeNull();
  });
});

describe('whatsappLink', () => {
  it('monta o link wa.me apenas com digitos', () => {
    expect(whatsappLink('(12) 99999-0000')).toBe('https://wa.me/5512999990000');
  });

  it('nao inventa link quando falta telefone', () => {
    expect(whatsappLink(null)).toBeNull();
    expect(whatsappLink('123')).toBeNull();
  });
});

describe('formatPhoneDisplay', () => {
  it('formata celular e fixo brasileiros', () => {
    expect(formatPhoneDisplay('5512999990000')).toBe('(12) 99999-0000');
    expect(formatPhoneDisplay('551234567890')).toBe('(12) 3456-7890');
  });

  it('devolve o original quando nao reconhece o formato', () => {
    expect(formatPhoneDisplay('+44 20 7123 4567')).toBe('+44 20 7123 4567');
    expect(formatPhoneDisplay(null)).toBeNull();
  });
});
