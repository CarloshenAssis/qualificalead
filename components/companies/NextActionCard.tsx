import { Card, SectionTitle } from '@/components/ui';
import { NEXT_ACTION_LABELS, type NextAction } from '@/types/database';
import { cn } from '@/lib/utils';

/** Acao recomendada, derivada de regras determinísticas (SPEC 1.1 §33/§77). */

const TONE: Record<NextAction, { dot: string; text: string; box: string }> = {
  CONTACT_NOW: { dot: '🟢', text: 'text-positive', box: 'border-positive/30 bg-positive-soft' },
  RESEARCH_MORE: { dot: '🟡', text: 'text-attention', box: 'border-attention/30 bg-attention-soft' },
  LOW_PRIORITY: { dot: '⚪', text: 'text-ink-soft', box: 'border-line bg-canvas' },
  ALREADY_CONTACTED: { dot: '🔵', text: 'text-brand-700', box: 'border-brand-100 bg-brand-50' },
  DO_NOT_CONTACT: { dot: '🔴', text: 'text-danger', box: 'border-danger/30 bg-danger-soft' },
};

export function NextActionCard({
  action,
  reason,
}: {
  action: NextAction;
  reason: string | null;
}) {
  const tone = TONE[action];

  return (
    <Card className={cn('border', tone.box)}>
      <SectionTitle>Acao recomendada</SectionTitle>
      <p className={cn('text-lg font-semibold', tone.text)}>
        <span aria-hidden>{tone.dot}</span> {NEXT_ACTION_LABELS[action].toUpperCase()}
      </p>
      {reason ? <p className="mt-1 text-sm text-ink-soft">{reason}</p> : null}
    </Card>
  );
}

/** Versao compacta para a lista de resultados. */
export function NextActionTag({ action }: { action: NextAction }) {
  const tone = TONE[action];
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs font-medium', tone.text)}>
      <span aria-hidden>{tone.dot}</span>
      {NEXT_ACTION_LABELS[action]}
    </span>
  );
}
