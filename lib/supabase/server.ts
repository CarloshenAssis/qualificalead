import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { publicEnv } from '@/lib/env';

/**
 * Cliente Supabase para Server Components, Server Actions e Route Handlers.
 * Toda leitura/escrita passa pela sessao do usuario, entao a RLS continua valendo.
 */
export async function createClient() {
  const env = publicEnv();
  const cookieStore = await cookies();

  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components nao podem escrever cookies; o middleware renova a sessao.
        }
      },
    },
  });
}

/** Usuario autenticado ou `null`. */
export async function getUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/** Usuario autenticado — lanca quando ausente. Use em rotas ja protegidas. */
export async function requireUser() {
  const user = await getUser();
  if (!user) {
    throw new Error('Sessao expirada. Faca login novamente.');
  }
  return user;
}
