import type { NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/session';

/** Renova a sessao e protege as rotas (convencao `proxy` do Next 16). */
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Todas as rotas exceto arquivos estaticos e imagens.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
