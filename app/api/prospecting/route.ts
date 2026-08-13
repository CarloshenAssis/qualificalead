import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { firstIssueMessage, prospectingSearchSchema } from '@/lib/validation/schemas';
import { runProspecting, type ProspectingEvent } from '@/lib/prospecting/run';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Prospeccao pode levar dezenas de segundos; a UI acompanha pelo stream. */
export const maxDuration = 300;

/**
 * Executa a prospeccao e transmite o progresso como NDJSON (SPEC 22/39).
 * Cada linha do corpo e um `ProspectingEvent` serializado.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Sessao expirada. Faca login novamente.' }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Requisicao invalida.' }, { status: 400 });
  }

  const parsed = prospectingSearchSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: firstIssueMessage(parsed.error) }, { status: 400 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: ProspectingEvent) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };

      try {
        for await (const event of runProspecting(supabase, user.id, parsed.data)) {
          send(event);
        }
      } catch (error) {
        console.error('[api/prospecting] falha inesperada', error);
        send({ type: 'error', message: 'Nao foi possivel concluir a prospeccao. Tente novamente.' });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}
