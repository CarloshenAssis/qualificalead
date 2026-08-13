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

/** Env publico (browser + servidor). Lanca se a configuracao do Supabase faltar. */
export function publicEnv(): PublicEnv {
  const parsed = publicSchema.safeParse({
    // As referencias precisam ser estaticas para o Next inlinar no bundle do cliente.
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
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
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
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
