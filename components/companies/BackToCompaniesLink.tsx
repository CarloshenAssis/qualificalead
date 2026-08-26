'use client';

import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';

/**
 * "Voltar para empresas" que preserva pagina/filtros de onde o usuario veio.
 *
 * Um `<Link href="/companies">` fixo sempre reseta para a pagina 1 sem filtros —
 * `router.back()` volta para a URL exata da listagem (pagina, filtros e ordenacao)
 * que o usuario tinha antes de abrir a ficha, igual ao botao "voltar" do navegador.
 * Se nao houver historico (ex.: link direto para a ficha), cai para /companies.
 */
export function BackToCompaniesLink() {
  const router = useRouter();

  return (
    <button
      type="button"
      onClick={() => {
        if (window.history.length > 1) router.back();
        else router.push('/companies');
      }}
      className="inline-flex items-center gap-1 text-sm text-ink-mute"
    >
      <ArrowLeft className="size-4" aria-hidden />
      Voltar para empresas
    </button>
  );
}
