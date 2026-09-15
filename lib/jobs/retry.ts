import type { JobStatus, JobType } from '@/types/spec2';

/**
 * Politica de retry e lock dos jobs (SPEC 2.0 §24.4).
 *
 * O NDJSON de streaming da 1.x continua servindo para feedback visual, mas deixa
 * de ser a fonte de verdade de processo longo (§24.1): o que vale e a linha em
 * `jobs`. Isso importa em serverless, onde a requisicao pode morrer no meio sem
 * avisar ninguem — o lock expira e outro worker retoma de onde parou.
 */

export const DEFAULT_MAX_ATTEMPTS = 3;

/** Base do backoff exponencial, em segundos. */
export const RETRY_BASE_SECONDS = 30;

/** Teto do backoff: 1h. Alem disso o intervalo deixa de ser util e vira abandono. */
export const RETRY_MAX_SECONDS = 3600;

/**
 * Backoff exponencial deterministico: 30s, 60s, 120s, 240s... limitado ao teto.
 * Sem jitter aleatorio de proposito — o agendamento precisa ser reproduzivel para
 * poder ser testado e auditado.
 */
export function retryDelaySeconds(attempt: number): number {
  if (attempt <= 0) return RETRY_BASE_SECONDS;
  return Math.min(RETRY_BASE_SECONDS * 2 ** (attempt - 1), RETRY_MAX_SECONDS);
}

export type RetryDecision = {
  status: Extract<JobStatus, 'PENDING' | 'DEAD_LETTER'>;
  /** Segundos ate a proxima tentativa. `null` quando o job foi para a dead-letter. */
  delaySeconds: number | null;
  reason: string;
};

/**
 * Erros permanentes nao merecem retry: tentar de novo produz exatamente o mesmo
 * erro e so queima tentativa e dinheiro (§24.4).
 */
export type FailureKind = 'TRANSIENT' | 'PERMANENT';

export function decideRetry(
  attempts: number,
  maxAttempts: number,
  kind: FailureKind,
): RetryDecision {
  if (kind === 'PERMANENT') {
    return {
      status: 'DEAD_LETTER',
      delaySeconds: null,
      reason: 'Falha permanente: retry produziria o mesmo erro.',
    };
  }

  if (attempts >= maxAttempts) {
    return {
      status: 'DEAD_LETTER',
      delaySeconds: null,
      reason: `Tentativas esgotadas (${attempts}/${maxAttempts}).`,
    };
  }

  return {
    status: 'PENDING',
    delaySeconds: retryDelaySeconds(attempts),
    reason: `Reagendado (tentativa ${attempts + 1}/${maxAttempts}).`,
  };
}

/** Duracao do lock. Um worker morto libera o job sozinho quando o lock expira. */
export const DEFAULT_LOCK_SECONDS = 300;

export function lockExpiresAt(now: Date, lockSeconds = DEFAULT_LOCK_SECONDS): string {
  return new Date(now.getTime() + lockSeconds * 1000).toISOString();
}

export function isLockExpired(lockedUntil: string | null, now: Date): boolean {
  if (!lockedUntil) return true;
  const expiry = Date.parse(lockedUntil);
  return Number.isNaN(expiry) ? true : expiry <= now.getTime();
}

/**
 * Jobs que gastam dinheiro externo (Apify, IA, provedor de e-mail). Eles exigem
 * checagem de orcamento antes de rodar (§8.5) e nunca podem ter retry infinito.
 */
export const COST_BEARING_JOB_TYPES: ReadonlySet<JobType> = new Set<JobType>([
  'START_APIFY_RUN',
  'IMPORT_APIFY_DATASET',
  'AUDIT_WEBSITE',
  'VERIFY_EMAIL',
  'GENERATE_EMAIL',
  'GENERATE_DIAGNOSIS',
  'SEND_EMAIL',
]);

export function bearsCost(type: JobType): boolean {
  return COST_BEARING_JOB_TYPES.has(type);
}
