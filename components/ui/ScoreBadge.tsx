import type { OpportunityLevel, ScoreBreakdownItem } from '@/types/database';
import { levelLabel } from '@/lib/scoring/config';
import { Badge, Card } from './index';
import { cn } from '@/lib/utils';

const LEVEL_TONE: Record<OpportunityLevel, 'neutral' | 'brand' | 'positive' | 'attention'> = {
  BAIXA: 'neutral',
  MEDIA: 'attention',
  ALTA: 'brand',
  EXCELENTE: 'positive',
};

/** Destaque visual por classificacao (SPEC 15). */
export function ScoreBadge({
  score,
  level,
  className,
}: {
  score: number;
  level: OpportunityLevel;
  className?: string;
}) {
  return (
    <Badge tone={LEVEL_TONE[level]} className={cn('whitespace-nowrap', className)}>
      <strong className="font-semibold">{score}</strong>
      <span className="hidden sm:inline">/100</span>
      <span className="sr-only sm:not-sr-only sm:ml-1">{levelLabel(level)}</span>
    </Badge>
  );
}

/** Justificativa item a item (SPEC 16). */
export function ScoreBreakdown({
  score,
  level,
  breakdown,
}: {
  score: number;
  level: OpportunityLevel;
  breakdown: ScoreBreakdownItem[];
}) {
  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className="text-sm text-ink-mute">Score de oportunidade</p>
          <p className="text-2xl font-semibold text-ink">{score}/100</p>
        </div>
        <ScoreBadge score={score} level={level} />
      </div>

      {breakdown.length ? (
        <ul className="divide-y divide-line text-sm">
          {breakdown.map((item) => (
            <li key={item.code} className="flex items-center justify-between gap-3 py-2">
              <span className="text-ink-soft">{item.label}</span>
              <span className="font-medium text-ink">+{item.points}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-ink-mute">Sem sinais pontuados ate agora.</p>
      )}

      <p className="mt-3 text-xs text-ink-mute">
        O score resume sinais observaveis da presenca digital. Nao e previsao de compra.
      </p>
    </Card>
  );
}
