'use client';

import { useEffect } from 'react';
import { Button, Card } from '@/components/ui';

/** Erro amigavel; o detalhe tecnico fica no log, nunca na tela (SPEC 38). */
export default function AppError({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    console.error('[app] erro nao tratado', error);
  }, [error]);

  return (
    <Card className="flex flex-col items-start gap-3">
      <h1 className="text-lg font-semibold text-ink">Algo nao saiu como esperado</h1>
      <p className="text-sm text-ink-soft">
        Nao foi possivel carregar esta tela agora. Tente novamente em instantes.
      </p>
      <Button type="button" onClick={reset}>
        Tentar novamente
      </Button>
    </Card>
  );
}
