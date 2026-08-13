import { Card, LinkButton } from '@/components/ui';

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg items-center px-4">
      <Card className="w-full">
        <h1 className="text-lg font-semibold text-ink">Pagina nao encontrada</h1>
        <p className="mt-1 mb-4 text-sm text-ink-soft">
          O conteudo que voce procurou nao existe ou nao pertence a sua conta.
        </p>
        <LinkButton href="/dashboard" variant="primary">
          Voltar ao painel
        </LinkButton>
      </Card>
    </main>
  );
}
