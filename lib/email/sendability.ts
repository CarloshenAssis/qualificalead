import type { EmailVerificationStatus } from '@/types/spec2';

/** Central, fail-closed policy used by every automatic e-mail decision. */
export const SENDABLE_EMAIL_STATUSES: ReadonlySet<EmailVerificationStatus> = new Set([
  'VALID',
  'ROLE_BASED',
  'ACCEPT_ALL',
]);

export function isEmailStatusSendable(status: EmailVerificationStatus | string): boolean {
  return SENDABLE_EMAIL_STATUSES.has(status as EmailVerificationStatus);
}
