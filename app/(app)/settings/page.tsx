import { Button, Card, SectionTitle } from '@/components/ui';
import { signOut } from '@/app/auth/actions';
import { createClient, requireUser } from '@/lib/supabase/server';
import {
  HIGH_RATING_THRESHOLD,
  INSTAGRAM_HIGH_CONFIDENCE_THRESHOLD,
  OPPORTUNITY_LEVEL_RANGES,
  REVIEW_COUNT_TIERS,
  SCORE_WEIGHTS,
} from '@/lib/scoring/config';
import { digitalPresenceTtlDays } from '@/lib/env';
import type { Profile } from '@/types/database';

export const dynamic = 'force-dynamic';

const WEIGHT_LABELS: Record<keyof typeof SCORE_WEIGHTS, string> = {
  NO_WEBSITE: 'Site nao identificado',
  DIGITAL_PRESENCE_GAP: 'Presenca digital insuficiente (sem site e sem Instagram)',
  HIGH_RATING: `Avaliacao ${HIGH_RATING_THRESHOLD} ou mais`,
  INSTAGRAM_FOUND: 'Instagram encontrado',
  INSTAGRAM_HIGH_CONFIDENCE: `Instagram com confianca ${INSTAGRAM_HIGH_CONFIDENCE_THRESHOLD}+`,
  PHONE_AVAILABLE: 'Telefone disponivel',
  BUSINESS_ACTIVE: 'Empresa ativa',
};

export default async function SettingsPage() {
  const user = await requireUser();
  const supabase = await createClient();

  const { data } = await supabase.from('profiles').select('*').eq('user_id', user.id).maybeSingle();
  const profile = (data as Profile | null) ?? null;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-xl font-semibold text-ink">Configuracoes</h1>
        <p className="text-sm text-ink-mute">Conta e preferencias de qualificacao.</p>
      </header>

      <Card>
        <SectionTitle>Conta</SectionTitle>
        <dl className="text-sm">
          <div className="flex justify-between border-b border-line py-2">
            <dt className="text-ink-mute">Nome</dt>
            <dd className="font-medium text-ink">{profile?.name || 'Nao informado'}</dd>
          </div>
          <div className="flex justify-between py-2">
            <dt className="text-ink-mute">E-mail</dt>
            <dd className="font-medium text-ink">{user.email}</dd>
          </div>
        </dl>

        <p className="mt-3 text-xs text-ink-mute">
          A troca de senha e feita pelo fluxo de recuperacao do Supabase Auth.
        </p>

        <form action={signOut} className="mt-4">
          <Button type="submit" variant="secondary">
            Sair da conta
          </Button>
        </form>
      </Card>

      <Card>
        <SectionTitle>Preferencias de score</SectionTitle>
        <p className="mb-3 text-sm text-ink-mute">
          Os pesos abaixo sao aplicados a todas as empresas. Eles ficam centralizados em{' '}
          <code className="rounded bg-canvas px-1">lib/scoring/config.ts</code> e podem ser ajustados
          por codigo; a edicao pela interface entra em uma versao futura.
        </p>

        <dl className="text-sm">
          {(Object.keys(SCORE_WEIGHTS) as (keyof typeof SCORE_WEIGHTS)[]).map((key) => (
            <div key={key} className="flex justify-between border-b border-line py-2">
              <dt className="text-ink-mute">{WEIGHT_LABELS[key]}</dt>
              <dd className="font-medium text-ink">+{SCORE_WEIGHTS[key]}</dd>
            </div>
          ))}
          {REVIEW_COUNT_TIERS.filter((tier) => tier.points > 0).map((tier) => (
            <div key={tier.min} className="flex justify-between border-b border-line py-2">
              <dt className="text-ink-mute">{tier.min}+ avaliacoes</dt>
              <dd className="font-medium text-ink">+{tier.points}</dd>
            </div>
          ))}
        </dl>

        <h3 className="mt-4 mb-2 text-sm font-semibold text-ink">Classificacao</h3>
        <ul className="text-sm text-ink-soft">
          {OPPORTUNITY_LEVEL_RANGES.map((range) => (
            <li key={range.level} className="flex justify-between border-b border-line py-2 last:border-0">
              <span>{range.label}</span>
              <span className="font-medium text-ink">{range.min}+</span>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <SectionTitle>Pesquisa</SectionTitle>
        <p className="text-sm text-ink-soft">
          A presenca digital de uma empresa ja conhecida so e reconsultada apos{' '}
          <strong>{digitalPresenceTtlDays()} dias</strong>, para evitar chamadas desnecessarias as
          APIs. Empresas ja salvas nunca sao duplicadas: a chave e o identificador do Google.
        </p>
      </Card>
    </div>
  );
}
