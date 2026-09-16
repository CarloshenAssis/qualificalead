import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  SPEC2_SECRET_ENV_VARS,
  aiEnv,
  aiUsable,
  apifyEnv,
  apifyUsable,
  emailEnv,
  emailUsable,
  websiteAuditEnv,
  workerEnv,
} from '@/lib/env-spec2';

const TOUCHED = [
  'APIFY_ENABLED',
  'APIFY_API_TOKEN',
  'APIFY_GOOGLE_MAPS_ACTOR_ID',
  'AI_ENABLED',
  'AI_PROVIDER',
  'AI_API_KEY',
  'AI_MODEL',
  'EMAIL_PROVIDER',
  'EMAIL_API_KEY',
  'EMAIL_DEFAULT_FROM',
  'EMAIL_DAILY_LIMIT',
  'WEBSITE_AUDIT_ENABLED',
  'JOB_BATCH_SIZE',
];

afterEach(() => {
  for (const key of TOUCHED) delete process.env[key];
});

describe('variaveis da SPEC 2.0 §31', () => {
  it('tudo vem desligado por padrao', () => {
    expect(apifyEnv().enabled).toBe(false);
    expect(aiEnv().enabled).toBe(false);
    expect(apifyUsable()).toBe(false);
    expect(aiUsable()).toBe(false);
    expect(emailUsable()).toBe(false);
  });

  it('credencial presente NAO autoriza gasto sem opt-in explicito', () => {
    process.env.APIFY_API_TOKEN = 'token-secreto';
    process.env.APIFY_GOOGLE_MAPS_ACTOR_ID = 'actor-1';
    expect(apifyUsable()).toBe(false);

    process.env.APIFY_ENABLED = 'true';
    expect(apifyUsable()).toBe(true);
  });

  it('qualquer valor diferente de "true" mantem a fonte desligada', () => {
    process.env.APIFY_API_TOKEN = 'token';
    process.env.APIFY_GOOGLE_MAPS_ACTOR_ID = 'actor';
    for (const value of ['1', 'yes', 'TRUE ', 'sim', '']) {
      process.env.APIFY_ENABLED = value;
      expect(apifyUsable(), JSON.stringify(value)).toBe(value.trim().toLowerCase() === 'true');
    }
  });

  it('opt-in sem credencial completa tambem nao roda', () => {
    process.env.APIFY_ENABLED = 'true';
    expect(apifyUsable()).toBe(false);

    process.env.APIFY_API_TOKEN = 'token';
    expect(apifyUsable()).toBe(false);
  });

  it('a IA exige opt-in, provedor, chave e modelo', () => {
    process.env.AI_ENABLED = 'true';
    process.env.AI_PROVIDER = 'provider';
    process.env.AI_API_KEY = 'key';
    expect(aiUsable()).toBe(false);

    process.env.AI_MODEL = 'modelo';
    expect(aiUsable()).toBe(true);
  });

  it('o e-mail exige provedor, chave e remetente padrao', () => {
    process.env.EMAIL_PROVIDER = 'provedor';
    process.env.EMAIL_API_KEY = 'chave';
    expect(emailUsable()).toBe(false);

    process.env.EMAIL_DEFAULT_FROM = 'contato@empresa.com.br';
    expect(emailUsable()).toBe(true);
  });

  it('a auditoria de site vem ligada, pois nao gera custo externo', () => {
    expect(websiteAuditEnv().enabled).toBe(true);

    process.env.WEBSITE_AUDIT_ENABLED = 'false';
    expect(websiteAuditEnv().enabled).toBe(false);
  });

  it('limites invalidos caem no padrao em vez de virar NaN', () => {
    process.env.EMAIL_DAILY_LIMIT = 'muitos';
    expect(emailEnv().dailyLimit).toBe(20);

    process.env.EMAIL_DAILY_LIMIT = '-5';
    expect(emailEnv().dailyLimit).toBe(20);

    process.env.JOB_BATCH_SIZE = '50';
    expect(workerEnv().batchSize).toBe(50);
  });

  it('nenhum segredo usa o prefixo NEXT_PUBLIC_ (SPEC 2.0 §31)', () => {
    for (const name of SPEC2_SECRET_ENV_VARS) {
      expect(name.startsWith('NEXT_PUBLIC_'), name).toBe(false);
    }
  });

  it('o .env.example nao expoe nenhum segredo ao browser', () => {
    const example = readFileSync('.env.example', 'utf8');
    for (const name of SPEC2_SECRET_ENV_VARS) {
      expect(example, name).not.toContain(`NEXT_PUBLIC_${name}`);
    }
  });

  it('o .env.example documenta todas as variaveis da SPEC 2.0 §31', () => {
    const example = readFileSync('.env.example', 'utf8');
    const required = [
      'APIFY_ENABLED',
      'APIFY_API_TOKEN',
      'APIFY_GOOGLE_MAPS_ACTOR_ID',
      'APIFY_WEBHOOK_SECRET',
      'EMAIL_PROVIDER',
      'EMAIL_API_KEY',
      'EMAIL_WEBHOOK_SECRET',
      'EMAIL_INBOUND_SECRET',
      'EMAIL_DEFAULT_FROM',
      'EMAIL_DEFAULT_REPLY_TO',
      'EMAIL_DAILY_LIMIT',
      'AI_ENABLED',
      'AI_PROVIDER',
      'AI_API_KEY',
      'AI_MODEL',
      'AI_MAX_COST_PER_CAMPAIGN',
      'WEBSITE_AUDIT_ENABLED',
      'WEBSITE_AUDIT_TIMEOUT_MS',
      'WEBSITE_AUDIT_MAX_PAGES',
      'WEBSITE_AUDIT_MAX_BYTES',
      'JOB_WORKER_SECRET',
      'JOB_BATCH_SIZE',
      'JOB_MAX_ATTEMPTS',
    ];

    for (const name of required) {
      expect(example, name).toContain(name);
    }
  });

  it('nao existe variavel de WhatsApp (SPEC 2.0 §33.5)', () => {
    const example = readFileSync('.env.example', 'utf8');
    expect(example).not.toMatch(/^WHATSAPP_/m);
  });
});
