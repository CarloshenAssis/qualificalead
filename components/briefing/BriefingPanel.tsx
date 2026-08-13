'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { FileText, Sparkles } from 'lucide-react';
import { Button, Card, ErrorMessage, Field, Input, SectionTitle, Textarea } from '@/components/ui';
import { CopyButton } from '@/components/ui/CopyButton';
import { saveBriefing, type ActionState } from '@/app/(app)/companies/actions';
import type { Briefing, BriefingManualData } from '@/types/database';

const MANUAL_FIELDS: { name: keyof BriefingManualData; label: string; long?: boolean; hint?: string }[] = [
  { name: 'description', label: 'Descricao da empresa', long: true },
  { name: 'services', label: 'Servicos', long: true },
  { name: 'products', label: 'Produtos', long: true },
  { name: 'differentials', label: 'Diferenciais', long: true },
  { name: 'menu', label: 'Cardapio', long: true },
  { name: 'prices', label: 'Precos', long: true },
  { name: 'institutional', label: 'Informacoes institucionais', long: true },
  { name: 'colors', label: 'Cores da marca', hint: 'Ex.: azul escuro e branco' },
  { name: 'logo_url', label: 'Link da logo' },
  { name: 'photos', label: 'Links de fotos' },
  { name: 'links', label: 'Outros links' },
  { name: 'notes', label: 'Observacoes', long: true },
];

function GenerateButton({ hasBriefing }: { hasBriefing: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      <Sparkles className="size-4" aria-hidden />
      {pending ? 'Gerando...' : hasBriefing ? 'ATUALIZAR BRIEFING' : 'GERAR BRIEFING PARA SITE'}
    </Button>
  );
}

/** Campos manuais + briefing + prompt do Lovable (SPEC 25/26/27/28). */
export function BriefingPanel({
  companyId,
  briefing,
}: {
  companyId: string;
  briefing: Briefing | null;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(saveBriefing, {});
  const [showManual, setShowManual] = useState(!briefing);
  const manual = briefing?.manual_data ?? {};

  return (
    <Card>
      <SectionTitle
        action={
          <Button type="button" variant="ghost" onClick={() => setShowManual((v) => !v)}>
            {showManual ? 'Ocultar campos manuais' : 'Complementar informacoes'}
          </Button>
        }
      >
        Producao do site
      </SectionTitle>

      <form action={formAction} className="flex flex-col gap-4">
        <input type="hidden" name="companyId" value={companyId} />

        {showManual ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <p className="text-xs text-ink-mute sm:col-span-2">
              Estes campos sao preenchidos por voce e ficam separados dos dados coletados
              automaticamente. Deixe em branco o que ainda nao souber — nada sera inventado.
            </p>

            {MANUAL_FIELDS.map((field) => (
              <div key={field.name} className={field.long ? 'sm:col-span-2' : undefined}>
                <Field label={field.label} htmlFor={field.name} hint={field.hint}>
                  {field.long ? (
                    <Textarea
                      id={field.name}
                      name={field.name}
                      defaultValue={manual[field.name] ?? ''}
                    />
                  ) : (
                    <Input id={field.name} name={field.name} defaultValue={manual[field.name] ?? ''} />
                  )}
                </Field>
              </div>
            ))}
          </div>
        ) : null}

        <ErrorMessage>{state.error}</ErrorMessage>

        <div className="flex flex-wrap gap-2">
          <GenerateButton hasBriefing={Boolean(briefing)} />
        </div>
      </form>

      {briefing?.generated_briefing ? (
        <div className="mt-6 flex flex-col gap-3 border-t border-line pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
              <FileText className="size-4" aria-hidden />
              Briefing
            </h3>
            <CopyButton value={briefing.generated_briefing} label="Copiar briefing" />
          </div>

          <pre className="max-h-80 overflow-auto rounded-lg bg-canvas p-3 text-xs leading-relaxed whitespace-pre-wrap text-ink-soft">
            {briefing.generated_briefing}
          </pre>
        </div>
      ) : null}

      {briefing?.generated_lovable_prompt ? (
        <div className="mt-6 flex flex-col gap-3 border-t border-line pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-ink">Prompt para o Lovable</h3>
            <CopyButton
              value={briefing.generated_lovable_prompt}
              label="COPIAR PROMPT PARA LOVABLE"
              variant="primary"
            />
          </div>

          <pre className="max-h-80 overflow-auto rounded-lg bg-canvas p-3 text-xs leading-relaxed whitespace-pre-wrap text-ink-soft">
            {briefing.generated_lovable_prompt}
          </pre>
        </div>
      ) : null}
    </Card>
  );
}
