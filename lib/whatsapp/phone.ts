/**
 * Normalizacao de telefone e link de WhatsApp (SPEC 11).
 * O sistema apenas abre a conversa — nunca envia mensagem automaticamente.
 */

const BR_COUNTRY_CODE = '55';

/** Apenas digitos, preservando o `+` inicial quando existir. */
function digitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}

/**
 * Converte um telefone para o formato aceito pelo wa.me (somente digitos, com DDI).
 * Retorna `null` quando o numero nao tem tamanho plausivel — nunca inventa digitos.
 */
export function normalizePhone(
  raw: string | null | undefined,
  defaultCountryCode: string = BR_COUNTRY_CODE,
): string | null {
  if (!raw) return null;

  const hadPlus = raw.trim().startsWith('+');
  let digits = digitsOnly(raw);
  if (!digits) return null;

  // Prefixo internacional discado (00 55 ...).
  if (!hadPlus && digits.startsWith('00')) {
    digits = digits.slice(2);
    return digits.length >= 10 && digits.length <= 15 ? digits : null;
  }

  if (hadPlus) {
    return digits.length >= 10 && digits.length <= 15 ? digits : null;
  }

  // Numero nacional brasileiro: 10 (fixo) ou 11 (movel) digitos com DDD.
  if (defaultCountryCode === BR_COUNTRY_CODE) {
    if (digits.startsWith('0')) digits = digits.replace(/^0+/, '');

    if (digits.length === 10 || digits.length === 11) {
      return `${BR_COUNTRY_CODE}${digits}`;
    }
    // Ja veio com DDI.
    if ((digits.length === 12 || digits.length === 13) && digits.startsWith(BR_COUNTRY_CODE)) {
      return digits;
    }
    return null;
  }

  if (digits.startsWith(defaultCountryCode)) {
    return digits.length >= 10 && digits.length <= 15 ? digits : null;
  }

  const withCode = `${defaultCountryCode}${digits}`;
  return withCode.length >= 10 && withCode.length <= 15 ? withCode : null;
}

/** Link wa.me. Retorna `null` quando o telefone nao pode ser normalizado. */
export function whatsappLink(
  raw: string | null | undefined,
  defaultCountryCode?: string,
): string | null {
  const normalized = normalizePhone(raw, defaultCountryCode);
  return normalized ? `https://wa.me/${normalized}` : null;
}

/** Formatacao legivel para telefones brasileiros; devolve o original se nao reconhecer. */
export function formatPhoneDisplay(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = digitsOnly(raw);

  const national = digits.startsWith(BR_COUNTRY_CODE) ? digits.slice(2) : digits;
  if (national.length === 11) {
    return `(${national.slice(0, 2)}) ${national.slice(2, 7)}-${national.slice(7)}`;
  }
  if (national.length === 10) {
    return `(${national.slice(0, 2)}) ${national.slice(2, 6)}-${national.slice(6)}`;
  }
  return raw;
}
