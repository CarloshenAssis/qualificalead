'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { RefreshCw } from 'lucide-react';
import { Button, Card } from '@/components/ui';
import { reprocessFailed } from '@/app/(app)/companies/reprocess-action';
import type { ActionState } from '@/app/(app)/companies/actions';

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="secondary" disabled={pending}>
      <RefreshCw className={pending ? 'size-4 animate-spin' : 'size-4'} aria-hidden />
      {pending ? 'Reprocessando...' : 'REPROCESSAR'}
    </Button>
  );
}

/** Aviso de falha parcial com reprocessamento pontual (SPEC 1.1 §86/§87). */
export function ReprocessBanner({ failedCount }: { failedCount: number }) {
  const [state, formAction] = useActionState<ActionState, FormData>(
    () => reprocessFailed(),
    {},
  );

  if (!failedCount && !state.message) return null;

  return (
    <Card className="flex flex-wrap items-center justify-between gap-3 border-attention/30 bg-attention-soft">
      <p className="text-sm text-attention">
        {state.message ??
          `${failedCount} empresa(s) precisam de nova verificacao de presenca digital.`}
        {state.error ? ` ${state.error}` : ''}
      </p>
      <form action={formAction}>
        <Submit />
      </form>
    </Card>
  );
}
