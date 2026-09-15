import { z } from 'zod';

/**
 * Leitura validada das variaveis da SPEC 2.0 §31.
 *
 * Segue a mesma disciplina de `lib/env.ts`: segredo so no servidor, nunca com
 * prefixo `NEXT_PUBLIC_`, e **nada ligado por padrao**. A regra que se repete em
 * todo integrador pago do produto vale aqui igual: a presenca de uma credencial
 * no ambiente nao autoriza gasto — e preciso um opt-in explicito `true`. Isso
 * evita que uma chave esquecida numa variavel produza cobranca sem ninguem pedir.
 */

function envFlag(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === 'true';
}

function envText(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function envInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

// --- Apify (§8) -------------------------------------------------------------

export type ApifyEnv = {
  enabled: boolean;
  token: string | null;
  googleMapsActorId: string | null;
  webhookSecret: string | null;
  defaultMemoryMb: number;
  defaultTimeoutSeconds: number;
};

export const DEFAULT_APIFY_MEMORY_MB = 1024;
export const DEFAULT_APIFY_TIMEOUT_SECONDS = 300;

export function apifyEnv(): ApifyEnv {
  return {
    enabled: envFlag(process.env.APIFY_ENABLED),
    token: envText(process.env.APIFY_API_TOKEN),
    googleMapsActorId: envText(process.env.APIFY_GOOGLE_MAPS_ACTOR_ID),
    webhookSecret: envText(process.env.APIFY_WEBHOOK_SECRET),
    defaultMemoryMb: envInt(process.env.APIFY_DEFAULT_MEMORY_MB, DEFAULT_APIFY_MEMORY_MB),
    defaultTimeoutSeconds: envInt(
      process.env.APIFY_DEFAULT_TIMEOUT_SECONDS,
      DEFAULT_APIFY_TIMEOUT_SECONDS,
    ),
  };
}

/**
 * O Apify so pode ser chamado com opt-in **e** credenciais completas. Faltando
 * qualquer uma das duas coisas, a fonte nao roda — nunca "roda pela metade".
 */
export function apifyUsable(env: ApifyEnv = apifyEnv()): boolean {
  return env.enabled && Boolean(env.token) && Boolean(env.googleMapsActorId);
}

// --- E-mail (§17) -----------------------------------------------------------

export type EmailEnv = {
  provider: string | null;
  apiKey: string | null;
  webhookSecret: string | null;
  inboundSecret: string | null;
  defaultFrom: string | null;
  defaultReplyTo: string | null;
  dailyLimit: number;
};

export const DEFAULT_EMAIL_DAILY_LIMIT = 25;

export function emailEnv(): EmailEnv {
  return {
    provider: envText(process.env.EMAIL_PROVIDER),
    apiKey: envText(process.env.EMAIL_API_KEY),
    webhookSecret: envText(process.env.EMAIL_WEBHOOK_SECRET),
    inboundSecret: envText(process.env.EMAIL_INBOUND_SECRET),
    defaultFrom: envText(process.env.EMAIL_DEFAULT_FROM),
    defaultReplyTo: envText(process.env.EMAIL_DEFAULT_REPLY_TO),
    dailyLimit: envInt(process.env.EMAIL_DAILY_LIMIT, DEFAULT_EMAIL_DAILY_LIMIT),
  };
}

/** Sem provedor, chave e remetente padrao nao existe cadencia de e-mail. */
export function emailUsable(env: EmailEnv = emailEnv()): boolean {
  return Boolean(env.provider) && Boolean(env.apiKey) && Boolean(env.defaultFrom);
}

// --- IA (§15) ---------------------------------------------------------------

export type AiEnv = {
  enabled: boolean;
  provider: string | null;
  apiKey: string | null;
  model: string | null;
  /** Teto por campanha em centavos. `null` = sem teto configurado. */
  maxCostPerCampaignCents: number | null;
};

export function aiEnv(): AiEnv {
  const rawCost = Number(process.env.AI_MAX_COST_PER_CAMPAIGN);
  return {
    enabled: envFlag(process.env.AI_ENABLED),
    provider: envText(process.env.AI_PROVIDER),
    apiKey: envText(process.env.AI_API_KEY),
    model: envText(process.env.AI_MODEL),
    maxCostPerCampaignCents:
      Number.isFinite(rawCost) && rawCost >= 0 ? Math.floor(rawCost) : null,
  };
}

/**
 * Degradacao graciosa (SPEC 2.0 §15.5): sem IA o produto continua inteiro — score
 * deterministico, templates e campos manuais. Por isso esta funcao existe: o
 * chamador pergunta antes e segue sem IA, em vez de quebrar.
 */
export function aiUsable(env: AiEnv = aiEnv()): boolean {
  return env.enabled && Boolean(env.provider) && Boolean(env.apiKey) && Boolean(env.model);
}

// --- Auditoria de site (§11.3) ----------------------------------------------

export type WebsiteAuditEnv = {
  enabled: boolean;
  timeoutMs: number;
  maxPages: number;
  maxBytes: number;
};

export const DEFAULT_WEBSITE_AUDIT = {
  timeoutMs: 15_000,
  maxPages: 5,
  maxBytes: 5_000_000,
} as const;

export function websiteAuditEnv(): WebsiteAuditEnv {
  return {
    // Diferente das fontes pagas, a auditoria vem ligada: ela nao gera custo externo.
    enabled: process.env.WEBSITE_AUDIT_ENABLED?.trim().toLowerCase() !== 'false',
    timeoutMs: envInt(process.env.WEBSITE_AUDIT_TIMEOUT_MS, DEFAULT_WEBSITE_AUDIT.timeoutMs),
    maxPages: envInt(process.env.WEBSITE_AUDIT_MAX_PAGES, DEFAULT_WEBSITE_AUDIT.maxPages),
    maxBytes: envInt(process.env.WEBSITE_AUDIT_MAX_BYTES, DEFAULT_WEBSITE_AUDIT.maxBytes),
  };
}

// --- Worker (§24) -----------------------------------------------------------

export type WorkerEnv = {
  secret: string | null;
  batchSize: number;
  maxAttempts: number;
};

export function workerEnv(): WorkerEnv {
  return {
    secret: envText(process.env.JOB_WORKER_SECRET),
    batchSize: envInt(process.env.JOB_BATCH_SIZE, 10),
    maxAttempts: envInt(process.env.JOB_MAX_ATTEMPTS, 3),
  };
}

// --- Conformidade (§31) -----------------------------------------------------

/** Toda variavel secreta da 2.0 — usada pelo teste que proibe expor segredo. */
export const SPEC2_SECRET_ENV_VARS = [
  'APIFY_API_TOKEN',
  'APIFY_WEBHOOK_SECRET',
  'EMAIL_API_KEY',
  'EMAIL_WEBHOOK_SECRET',
  'EMAIL_INBOUND_SECRET',
  'AI_API_KEY',
  'JOB_WORKER_SECRET',
] as const;

/**
 * Validacao de forma das variaveis, para uma tela de diagnostico poder dizer o que
 * esta configurado errado em vez de falhar em tempo de envio.
 */
export const spec2EnvSchema = z.object({
  APIFY_ENABLED: z.enum(['true', 'false']).optional(),
  AI_ENABLED: z.enum(['true', 'false']).optional(),
  WEBSITE_AUDIT_ENABLED: z.enum(['true', 'false']).optional(),
  EMAIL_DEFAULT_FROM: z.string().email().optional().or(z.literal('')),
  EMAIL_DEFAULT_REPLY_TO: z.string().email().optional().or(z.literal('')),
});
