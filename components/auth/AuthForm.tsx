'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import Link from 'next/link';
import { Button, Card, ErrorMessage, Field, Input } from '@/components/ui';
import type { AuthState } from '@/app/auth/actions';

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? 'Aguarde...' : label}
    </Button>
  );
}

export function AuthForm({
  mode,
  action,
  next,
}: {
  mode: 'signin' | 'signup';
  action: (prev: AuthState, formData: FormData) => Promise<AuthState>;
  next?: string;
}) {
  const [state, formAction] = useActionState<AuthState, FormData>(action, {});
  const isSignup = mode === 'signup';

  return (
    <Card className="w-full max-w-sm">
      <h1 className="text-xl font-semibold text-ink">
        {isSignup ? 'Criar conta' : 'Entrar no LeadHunter'}
      </h1>
      <p className="mt-1 mb-5 text-sm text-ink-mute">
        {isSignup
          ? 'Seus leads ficam visiveis apenas para voce.'
          : 'Prospeccao, qualificacao e briefing em um lugar so.'}
      </p>

      <form action={formAction} className="flex flex-col gap-4">
        {next ? <input type="hidden" name="next" value={next} /> : null}

        {isSignup ? (
          <Field label="Nome" htmlFor="name">
            <Input id="name" name="name" autoComplete="name" placeholder="Como devemos te chamar" />
          </Field>
        ) : null}

        <Field label="E-mail" htmlFor="email">
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </Field>

        <Field label="Senha" htmlFor="password" hint={isSignup ? 'Minimo de 8 caracteres.' : undefined}>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete={isSignup ? 'new-password' : 'current-password'}
            required
            minLength={8}
          />
        </Field>

        <ErrorMessage>{state.error}</ErrorMessage>

        {state.message ? (
          <p role="status" className="rounded-lg bg-positive-soft px-3 py-2 text-sm text-positive">
            {state.message}
          </p>
        ) : null}

        <SubmitButton label={isSignup ? 'Criar conta' : 'Entrar'} />
      </form>

      <p className="mt-4 text-center text-sm text-ink-mute">
        {isSignup ? (
          <>
            Ja tem conta?{' '}
            <Link href="/login" className="font-medium text-brand-700 underline">
              Entrar
            </Link>
          </>
        ) : (
          <>
            Ainda nao tem conta?{' '}
            <Link href="/signup" className="font-medium text-brand-700 underline">
              Criar conta
            </Link>
          </>
        )}
      </p>
    </Card>
  );
}
