'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Check, Plus } from 'lucide-react';
import { Button } from '@/components/ui';
import { addToPipeline, type ActionState } from '@/app/(app)/companies/actions';

function Submit({ alreadyIn }: { alreadyIn: boolean }) {
  const { pending } = useFormStatus();

  if (alreadyIn) {
    return (
      <Button type="button" variant="ghost" disabled>
        <Check className="size-4" aria-hidden />
        No pipeline
      </Button>
    );
  }

  return (
    <Button type="submit" variant="secondary" disabled={pending}>
      <Plus className="size-4" aria-hidden />
      {pending ? 'Adicionando...' : 'Adicionar ao pipeline'}
    </Button>
  );
}

export function AddToPipelineButton({
  companyId,
  alreadyIn,
}: {
  companyId: string;
  alreadyIn: boolean;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(addToPipeline, {});

  return (
    <form action={formAction} className="contents">
      <input type="hidden" name="companyId" value={companyId} />
      <Submit alreadyIn={alreadyIn} />
      {state.error ? (
        <span role="alert" className="text-xs text-danger">
          {state.error}
        </span>
      ) : null}
    </form>
  );
}
