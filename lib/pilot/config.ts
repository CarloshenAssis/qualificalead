/** Fail-closed operational controls. This module contains no secrets and is safe to inspect. */
export function strictFlag(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === 'true';
}

export type PilotFlags = { apifyEnabled: boolean; emailSendingEnabled: boolean; emailDryRun: boolean };
export function pilotFlags(env: NodeJS.ProcessEnv = process.env): PilotFlags {
  const nonProductionRuntime = env.NODE_ENV === 'test' || env.VERCEL_ENV === 'preview' || env.NODE_ENV === 'development';
  return {
    apifyEnabled: strictFlag(env.APIFY_ENABLED),
    emailSendingEnabled: strictFlag(env.EMAIL_SENDING_ENABLED) && env.NODE_ENV !== 'test',
    // Dry-run fails safe: only an explicit false in production can disable it.
    emailDryRun: nonProductionRuntime || env.EMAIL_DRY_RUN?.trim().toLowerCase() !== 'false',
  };
}

export function mayCallApify(env: NodeJS.ProcessEnv = process.env): boolean {
  return pilotFlags(env).apifyEnabled && env.NODE_ENV !== 'test';
}
export function maySendRealEmail(env: NodeJS.ProcessEnv = process.env): boolean {
  const flags = pilotFlags(env);
  return flags.emailSendingEnabled && !flags.emailDryRun && env.POSTGRES_VALIDATED === 'true' && env.EMAIL_DNS_VALIDATED === 'true';
}
