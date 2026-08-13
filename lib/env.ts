import { z } from 'zod';

/**
 * Acesso centralizado e validado a variaveis de ambiente (SPEC 33/34).
 * Segredos ficam em funcoes `server*` e nunca sao importados por Client Components.
 */

const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
});

export type PublicEnv = z.infer<typeof publicSchema>;

/**
 * Le uma variavel `NEXT_PUBLIC_*` sem ficar preso ao valor do build.
 *
 * O Next substitui `process.env.NEXT_PUBLIC_X` pelo valor existente no momento do
 * build. Se a imagem for construida sem as variaveis (CI sem segredos, por exemplo)
 * e elas so aparecerem em tempo de execucao, o servidor continuaria usando o valor
 * antigo — apontando para o Supabase errado sem avisar. No servidor, portanto, o
 * acesso dinamico vem primeiro; no browser resta o valor inlinado, que e o unico
 * disponivel ali.
 */
function readPublicVar(name: keyof PublicEnv): string | undefined {
  if (typeof window === 'undefined') {
    const runtimeValue = process.env[name as string];
    if (runtimeValue) return runtimeValue;
  }

  return name === 'NEXT_PUBLIC_SUPABASE_URL'
    ? process.env.NEXT_PUBLIC_SUPABASE_URL
    : process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
}

/** Env publico (browser + servidor). Lanca se a configuracao do Supabase faltar. */
export function publicEnv(): PublicEnv {
  const parsed = publicSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: readPublicVar('NEXT_PUBLIC_SUPABASE_URL'),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: readPublicVar('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
  });

  if (!parsed.success) {
    throw new Error(
      'Configuracao do Supabase ausente. Defina NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY (veja .env.example).',
    );
  }

  return parsed.data;
}

/** `true` quando o Supabase esta configurado — permite telas de setup amigaveis. */
export function isSupabaseConfigured(): boolean {
  return Boolean(
    readPublicVar('NEXT_PUBLIC_SUPABASE_URL') && readPublicVar('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
  );
}

/** Chave do Google Maps. Apenas servidor. `null` quando nao configurada. */
export function serverGoogleMapsKey(): string | null {
  const key = process.env.GOOGLE_MAPS_API_KEY?.trim();
  return key ? key : null;
}

export function googleRegionCode(): string {
  return process.env.GOOGLE_PLACES_REGION_CODE?.trim() || 'BR';
}

export function googleLanguageCode(): string {
  return process.env.GOOGLE_PLACES_LANGUAGE_CODE?.trim() || 'pt-BR';
}

export function defaultPhoneCountryCode(): string {
  return process.env.DEFAULT_PHONE_COUNTRY_CODE?.trim() || '55';
}

/** Dias antes de reconsultar a presenca digital de uma empresa ja conhecida (SPEC 1.1 §12). */
export const DEFAULT_DIGITAL_PRESENCE_TTL_DAYS = 7;

export function digitalPresenceTtlDays(): number {
  const raw = Number(process.env.DIGITAL_PRESENCE_TTL_DAYS);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_DIGITAL_PRESENCE_TTL_DAYS;
}

/** Busca de Instagram por mecanismo de busca oficial — opcional (SPEC 1.1 §20). */
export function instagramSearchEnv(): { cx: string | null; key: string | null } {
  return {
    cx: process.env.GOOGLE_CSE_ID?.trim() || null,
    key: process.env.GOOGLE_CSE_API_KEY?.trim() || null,
  };
}
