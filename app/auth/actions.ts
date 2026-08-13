'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { authSchema, firstIssueMessage } from '@/lib/validation/schemas';

export type AuthState = { error?: string; message?: string };

/**
 * Mensagens do Supabase traduzidas para linguagem de usuario final (SPEC 38).
 * O detalhe tecnico vai para o log do servidor (SPEC 1.1 §57), nunca para a tela.
 */
function friendlyAuthError(message: string): string {
  console.error('[auth] falha de autenticacao', { message });

  const normalized = message.toLowerCase();
  if (normalized.includes('invalid login credentials')) return 'E-mail ou senha incorretos.';
  if (normalized.includes('email not confirmed')) {
    return 'Confirme seu e-mail antes de entrar. Verifique sua caixa de entrada.';
  }
  if (normalized.includes('already registered') || normalized.includes('already exists')) {
    return 'Ja existe uma conta com este e-mail.';
  }
  if (normalized.includes('rate limit')) return 'Muitas tentativas. Aguarde alguns minutos.';
  return 'Nao foi possivel concluir. Tente novamente.';
}

export async function signIn(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = authSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });

  if (!parsed.success) return { error: firstIssueMessage(parsed.error) };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) return { error: friendlyAuthError(error.message) };

  const next = formData.get('next');
  revalidatePath('/', 'layout');
  redirect(typeof next === 'string' && next.startsWith('/') ? next : '/dashboard');
}

export async function signUp(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = authSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
    name: formData.get('name') ?? undefined,
  });

  if (!parsed.success) return { error: firstIssueMessage(parsed.error) };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: { data: { name: parsed.data.name ?? '' } },
  });

  if (error) return { error: friendlyAuthError(error.message) };

  // Projetos com confirmacao de e-mail nao criam sessao imediatamente.
  if (!data.session) {
    return { message: 'Conta criada. Confirme seu e-mail para entrar.' };
  }

  revalidatePath('/', 'layout');
  redirect('/dashboard');
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath('/', 'layout');
  redirect('/login');
}
