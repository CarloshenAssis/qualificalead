'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { MessageCircle } from 'lucide-react';
import {
  Button,
  Card,
  ErrorMessage,
  ExternalLinkButton,
  Field,
  SectionTitle,
  Select,
  Textarea,
} from '@/components/ui';
import { formatDateTime } from '@/lib/utils';
import { INTERACTION_TYPES, LEAD_PRIORITIES, LEAD_STATUSES } from '@/types/database';
import type { Interaction, Lead } from '@/types/database';
import { addInteraction, updateLead, type ActionState } from '@/app/(app)/companies/actions';

function SaveButton({ label = 'Salvar' }: { label?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Salvando...' : label}
    </Button>
  );
}

const INTERACTION_LABELS: Record<(typeof INTERACTION_TYPES)[number], string> = {
  WHATSAPP: 'WhatsApp',
  LIGACAO: 'Ligacao',
  EMAIL: 'E-mail',
  REUNIAO: 'Reuniao',
  NOTA: 'Nota',
  MUDANCA_STATUS: 'Mudanca de status',
};

/** CRM da ficha: status, prioridade, notas e historico (SPEC 24/19/20). */
export function LeadPanel({
  companyId,
  lead,
  interactions,
  whatsappUrl,
}: {
  companyId: string;
  lead: Lead | null;
  interactions: Interaction[];
  whatsappUrl: string | null;
}) {
  const [leadState, leadAction] = useActionState<ActionState, FormData>(updateLead, {});
  const [interactionState, interactionAction] = useActionState<ActionState, FormData>(
    addInteraction,
    {},
  );

  return (
    <Card>
      <SectionTitle>CRM</SectionTitle>

      <form action={leadAction} className="flex flex-col gap-4">
        <input type="hidden" name="companyId" value={companyId} />

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Status" htmlFor="status">
            <Select id="status" name="status" defaultValue={lead?.status ?? 'NOVO'}>
              {LEAD_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {status.replace(/_/g, ' ')}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Prioridade" htmlFor="priority">
            <Select id="priority" name="priority" defaultValue={lead?.priority ?? 'MEDIA'}>
              {LEAD_PRIORITIES.map((priority) => (
                <option key={priority} value={priority}>
                  {priority}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="Observacoes" htmlFor="notes">
          <Textarea id="notes" name="notes" defaultValue={lead?.notes ?? ''} placeholder="Anotacoes sobre o contato" />
        </Field>

        <ErrorMessage>{leadState.error}</ErrorMessage>
        {leadState.message ? (
          <p role="status" className="text-sm text-positive">
            {leadState.message}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <SaveButton label={lead ? 'Salvar lead' : 'Criar lead'} />
          {whatsappUrl ? (
            <ExternalLinkButton href={whatsappUrl} variant="positive">
              <MessageCircle className="size-4" aria-hidden />
              Abrir WhatsApp
            </ExternalLinkButton>
          ) : null}
        </div>
      </form>

      {lead ? (
        <div className="mt-6 border-t border-line pt-4">
          <h3 className="mb-3 text-sm font-semibold text-ink">Registrar interacao</h3>

          <form action={interactionAction} className="flex flex-col gap-3">
            <input type="hidden" name="leadId" value={lead.id} />
            <input type="hidden" name="companyId" value={companyId} />

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Tipo" htmlFor="type">
                <Select id="type" name="type" defaultValue="WHATSAPP">
                  {INTERACTION_TYPES.filter((type) => type !== 'MUDANCA_STATUS').map((type) => (
                    <option key={type} value={type}>
                      {INTERACTION_LABELS[type]}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Descricao" htmlFor="description">
                <Textarea
                  id="description"
                  name="description"
                  className="min-h-11"
                  placeholder="O que aconteceu no contato"
                />
              </Field>
            </div>

            <ErrorMessage>{interactionState.error}</ErrorMessage>

            <Button type="submit" variant="secondary" className="sm:self-start">
              Registrar
            </Button>
          </form>

          <h3 className="mt-6 mb-2 text-sm font-semibold text-ink">Historico</h3>
          {interactions.length ? (
            <ul className="divide-y divide-line text-sm">
              {interactions.map((interaction) => (
                <li key={interaction.id} className="py-2">
                  <p className="font-medium text-ink">{INTERACTION_LABELS[interaction.type]}</p>
                  {interaction.description ? (
                    <p className="text-ink-soft">{interaction.description}</p>
                  ) : null}
                  <p className="text-xs text-ink-mute">{formatDateTime(interaction.created_at)}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-mute">Nenhuma interacao registrada ainda.</p>
          )}
        </div>
      ) : (
        <p className="mt-4 text-sm text-ink-mute">
          Salve o lead para registrar interacoes e acompanhar o historico.
        </p>
      )}
    </Card>
  );
}
