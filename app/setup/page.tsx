import { Card } from '@/components/ui';

/** Tela exibida quando o ambiente ainda nao esta configurado (SPEC 38). */
export default function SetupPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl items-center px-4 py-10">
      <Card className="w-full">
        <h1 className="text-xl font-semibold text-ink">LeadHunter ainda nao esta configurado</h1>
        <p className="mt-2 text-sm text-ink-soft">
          Para usar a aplicacao e preciso informar as credenciais do Supabase e do Google Maps.
        </p>

        <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm text-ink-soft">
          <li>
            Copie <code className="rounded bg-canvas px-1">.env.example</code> para{' '}
            <code className="rounded bg-canvas px-1">.env.local</code>.
          </li>
          <li>
            Preencha <code className="rounded bg-canvas px-1">NEXT_PUBLIC_SUPABASE_URL</code>,{' '}
            <code className="rounded bg-canvas px-1">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> e{' '}
            <code className="rounded bg-canvas px-1">GOOGLE_MAPS_API_KEY</code>.
          </li>
          <li>
            Rode o script <code className="rounded bg-canvas px-1">database/migrations/0001_init.sql</code>{' '}
            no SQL Editor do Supabase.
          </li>
          <li>Reinicie o servidor de desenvolvimento.</li>
        </ol>

        <p className="mt-4 text-sm text-ink-mute">
          O passo a passo completo esta no <code className="rounded bg-canvas px-1">README.md</code>.
        </p>
      </Card>
    </main>
  );
}
