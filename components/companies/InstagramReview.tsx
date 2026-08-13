'use client';

import { useActionState } from 'react';
import { AtSign } from 'lucide-react';
import { Badge, Button, Card, ErrorMessage, Field, Input, SectionTitle } from '@/components/ui';
import { instagramConfidenceLabel } from '@/lib/scoring/config';
import { reviewInstagram, type ActionState } from '@/app/(app)/companies/actions';
import type { Company } from '@/types/database';

/** Confirmar / rejeitar / substituir o perfil encontrado (SPEC 10/3.3). */
export function InstagramReview({ company }: { company: Company }) {
  const [state, formAction] = useActionState<ActionState, FormData>(reviewInstagram, {});
  const confidence = company.instagram_confidence ?? 0;

  return (
    <Card>
      <SectionTitle>Instagram</SectionTitle>

      {company.instagram_url ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={company.instagram_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-sm font-medium text-brand-700 underline"
            >
              <AtSign className="size-4" aria-hidden />
              {company.instagram_handle ?? company.instagram_url}
            </a>

            <Badge tone={company.instagram_status === 'CONFIRMED' ? 'positive' : 'attention'}>
              {company.instagram_status === 'CONFIRMED'
                ? 'Confirmado por voce'
                : `Confianca ${instagramConfidenceLabel(confidence)} (${confidence}/100)`}
            </Badge>
          </div>

          <p className="text-xs text-ink-mute">
            Encontrado a partir de link publicado no site oficial. Confirme antes de usar em uma abordagem.
          </p>

          {company.instagram_status !== 'CONFIRMED' ? (
            <form action={formAction} className="flex flex-wrap gap-2">
              <input type="hidden" name="companyId" value={company.id} />
              <Button type="submit" name="action" value="confirm" variant="positive">
                Confirmar perfil
              </Button>
              <Button type="submit" name="action" value="reject" variant="danger">
                Nao e desta empresa
              </Button>
            </form>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-ink-mute">
          {company.instagram_status === 'REJECTED'
            ? 'O perfil sugerido foi rejeitado por voce.'
            : 'Nao encontrado em fonte confiavel.'}
        </p>
      )}

      <form action={formAction} className="mt-4 flex flex-col gap-3 border-t border-line pt-4">
        <input type="hidden" name="companyId" value={company.id} />
        <input type="hidden" name="action" value="set" />

        <Field label="Informar perfil manualmente" htmlFor="handle" hint="Somente o usuario, sem a URL completa.">
          <Input id="handle" name="handle" placeholder="@empresa" />
        </Field>

        <ErrorMessage>{state.error}</ErrorMessage>

        <Button type="submit" variant="secondary" className="sm:self-start">
          Salvar perfil
        </Button>
      </form>
    </Card>
  );
}
