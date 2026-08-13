'use server';

import { revalidatePath } from 'next/cache';
import { createClient, requireUser } from '@/lib/supabase/server';
import { reprocessFailedEnrichment } from '@/lib/prospecting/run';
import type { ActionState } from './actions';

/**
 * Reprocessa apenas as empresas cujo enriquecimento falhou (SPEC 1.1 §87).
 * Nao repete a pesquisa no Google.
 */
// A assinatura recebe o estado anterior por contrato do useActionState; ele nao e usado.
export async function reprocessFailed(): Promise<ActionState> {
  try {
    const user = await requireUser();
    const supabase = await createClient();

    const result = await reprocessFailedEnrichment(supabase, user.id);

    revalidatePath('/companies');

    if (!result.processed) return { message: 'Nao ha empresas pendentes de reprocessamento.' };

    return {
      message:
        result.stillFailing > 0
          ? `${result.recovered} recuperada(s), ${result.stillFailing} ainda com falha.`
          : `${result.recovered} empresa(s) reprocessada(s) com sucesso.`,
    };
  } catch (error) {
    console.error('[companies/reprocess]', error);
    return { error: 'Nao foi possivel reprocessar agora. Tente novamente.' };
  }
}
