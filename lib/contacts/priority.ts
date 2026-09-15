import type { Contact, EmailVerificationStatus } from '@/types/spec2';
import { isEmailStatusSendable } from '@/lib/email/sendability';

/** @deprecated Prefer the positive allowlist in email/sendability. */
export const BLOCKED_EMAIL_STATUSES: ReadonlySet<EmailVerificationStatus> = new Set([
  'UNKNOWN', 'RISKY', 'INVALID', 'DISPOSABLE', 'BOUNCED', 'SUPPRESSED',
]);

/**
 * Escolha do contato e normalizacao de e-mail (SPEC 2.0 §10).
 *
 * A regra final do §10.3 e absoluta e vem antes de qualquer ordenacao: e-mail
 * invalido, com bounce ou suprimido **nunca** pode ser programado. Por isso este
 * modulo separa duas perguntas que costumam ser confundidas: "este endereco pode
 * receber e-mail?" e "entre os que podem, qual e o melhor?".
 */

/** Enderecos institucionais por area — uteis, mas menos que um nominal (§10.3). */
const ROLE_LOCAL_PARTS = new Set([
  'contato',
  'comercial',
  'vendas',
  'atendimento',
  'financeiro',
  'faleconosco',
  'sac',
  'info',
  'contact',
  'sales',
  'hello',
  'admin',
  'suporte',
  'support',
]);

/** Enderecos genericos de baixa qualidade. */
const GENERIC_LOCAL_PARTS = new Set(['no-reply', 'noreply', 'nao-responda', 'naoresponda']);

export function normalizeEmail(raw: string | null | undefined): string | null {
  const value = raw?.trim().toLowerCase();
  if (!value) return null;
  // Validacao estrutural minima: nao substitui verificacao real (§10.2).
  return /^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(value) ? value : null;
}

export function emailDomain(raw: string | null | undefined): string | null {
  const normalized = normalizeEmail(raw);
  return normalized ? normalized.split('@')[1] : null;
}

export function emailLocalPart(raw: string | null | undefined): string | null {
  const normalized = normalizeEmail(raw);
  return normalized ? normalized.split('@')[0] : null;
}

export function isRoleBasedEmail(raw: string | null | undefined): boolean {
  const local = emailLocalPart(raw);
  return local ? ROLE_LOCAL_PARTS.has(local) : false;
}

export function isGenericEmail(raw: string | null | undefined): boolean {
  const local = emailLocalPart(raw);
  return local ? GENERIC_LOCAL_PARTS.has(local) : false;
}

/** Nunca agendavel (SPEC 2.0 §10.3, ultima linha). */
export type ContactCandidate = Pick<
  Contact,
  'id' | 'email' | 'role' | 'is_decision_maker' | 'is_primary' | 'email_verification_status'
> & { name?: string | null };

export function isSchedulable(contact: ContactCandidate): boolean {
  if (!isEmailStatusSendable(contact.email_verification_status)) return false;
  if (!normalizeEmail(contact.email)) return false;
  if (isGenericEmail(contact.email)) return false;
  return true;
}

/**
 * Prioridade do §10.3, do melhor para o pior. O numero e so uma ordenacao: ele nao
 * entra em score nenhum e nao significa probabilidade de resposta.
 */
export const CONTACT_PRIORITY_TIERS = [
  'DECISION_MAKER_VALIDATED',
  'PROFESSIONAL_NAMED',
  'ROLE_BASED_RELEVANT',
  'GENERAL_COMPANY',
  'RISKY_NEEDS_REVIEW',
] as const;
export type ContactPriorityTier = (typeof CONTACT_PRIORITY_TIERS)[number];

const TIER_RANK: Record<ContactPriorityTier, number> = {
  DECISION_MAKER_VALIDATED: 0,
  PROFESSIONAL_NAMED: 1,
  ROLE_BASED_RELEVANT: 2,
  GENERAL_COMPANY: 3,
  RISKY_NEEDS_REVIEW: 4,
};

/** Estados que exigem revisao humana antes do envio (§10.3, ultimo item). */
const RISKY_STATUSES: ReadonlySet<EmailVerificationStatus> = new Set<EmailVerificationStatus>([
  'RISKY',
  'ACCEPT_ALL',
  'UNKNOWN',
]);

export function contactTier(contact: ContactCandidate): ContactPriorityTier {
  if (RISKY_STATUSES.has(contact.email_verification_status)) return 'RISKY_NEEDS_REVIEW';

  if (contact.is_decision_maker && contact.email_verification_status === 'VALID') {
    return 'DECISION_MAKER_VALIDATED';
  }

  // Nominal: tem nome e o endereco nao e um papel generico da empresa.
  if (contact.name?.trim() && !isRoleBasedEmail(contact.email)) return 'PROFESSIONAL_NAMED';

  if (isRoleBasedEmail(contact.email)) return 'ROLE_BASED_RELEVANT';

  return 'GENERAL_COMPANY';
}

/**
 * Melhor contato agendavel da empresa. `null` quando nenhum contato pode receber
 * e-mail — caso em que a acao correta e pesquisar mais, nunca enviar assim mesmo.
 */
export function selectPrimaryContact<T extends ContactCandidate>(contacts: T[]): T | null {
  const schedulable = contacts.filter(isSchedulable);
  if (!schedulable.length) return null;

  return [...schedulable].sort((a, b) => {
    const tierDiff = TIER_RANK[contactTier(a)] - TIER_RANK[contactTier(b)];
    if (tierDiff !== 0) return tierDiff;

    // Desempate estavel: marcacao manual do usuario vence, depois o id.
    if (a.is_primary !== b.is_primary) return a.is_primary ? -1 : 1;
    return a.id.localeCompare(b.id);
  })[0];
}
