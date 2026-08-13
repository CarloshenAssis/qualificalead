import { AlertTriangle, Check, X } from 'lucide-react';
import { Card, SectionTitle } from '@/components/ui';
import { runHealthChecks, type HealthLevel } from '@/lib/health/check';

export const dynamic = 'force-dynamic';

const ICONS: Record<HealthLevel, React.ReactNode> = {
  ok: <Check className="size-4 text-positive" aria-hidden />,
  warn: <AlertTriangle className="size-4 text-attention" aria-hidden />,
  fail: <X className="size-4 text-danger" aria-hidden />,
};

const LABELS: Record<HealthLevel, string> = {
  ok: 'Funcionando',
  warn: 'Atencao',
  fail: 'Falha',
};

/** System Health (SPEC 1.1 §7): diagnostico das integracoes, sem expor segredos. */
export default async function HealthPage() {
  const checks = await runHealthChecks();
  const failures = checks.filter((c) => c.level === 'fail').length;
  const warnings = checks.filter((c) => c.level === 'warn').length;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-xl font-semibold text-ink">Diagnostico do sistema</h1>
        <p className="text-sm text-ink-mute">
          {failures > 0
            ? `${failures} integracao(oes) com falha. A prospeccao real pode nao funcionar.`
            : warnings > 0
              ? `Tudo essencial funcionando, com ${warnings} ponto(s) de atencao.`
              : 'Todas as integracoes essenciais respondendo.'}
        </p>
      </header>

      <Card>
        <SectionTitle>Integracoes</SectionTitle>
        <ul className="divide-y divide-line">
          {checks.map((check) => (
            <li key={check.name} className="flex items-start justify-between gap-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink">{check.name}</p>
                <p className="text-sm text-ink-mute">{check.detail}</p>
              </div>
              <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-ink-soft">
                {ICONS[check.level]}
                {LABELS[check.level]}
              </span>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <SectionTitle>Como corrigir</SectionTitle>
        <ul className="list-disc space-y-1 pl-5 text-sm text-ink-soft">
          <li>
            Chaves ficam em <code className="rounded bg-canvas px-1">.env.local</code> — veja{' '}
            <code className="rounded bg-canvas px-1">.env.example</code>.
          </li>
          <li>
            Tabelas ausentes: rode os scripts de{' '}
            <code className="rounded bg-canvas px-1">database/migrations</code> no SQL Editor.
          </li>
          <li>
            Erro <code className="rounded bg-canvas px-1">PERMISSION_DENIED</code>: habilite a Places
            API (New) e a Geocoding API no Google Cloud.
          </li>
          <li>
            Erro <code className="rounded bg-canvas px-1">RESOURCE_EXHAUSTED</code>: o limite da API
            foi atingido; aguarde ou revise a cota.
          </li>
        </ul>
      </Card>
    </div>
  );
}
