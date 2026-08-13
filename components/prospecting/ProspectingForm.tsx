'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Search } from 'lucide-react';
import { Button, Card, ErrorMessage, Field, Input, LinkButton, Select } from '@/components/ui';
import type { ProspectingEvent, ProspectingSummary } from '@/lib/prospecting/run';

type Status = 'idle' | 'running' | 'done' | 'error';

/** Formulario de prospeccao com progresso em tempo real (SPEC 22/39). */
export function ProspectingForm() {
  const router = useRouter();
  const [status, setStatus] = useState<Status>('idle');
  const [stageMessage, setStageMessage] = useState('');
  const [progress, setProgress] = useState<{ processed: number; total: number } | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ProspectingSummary | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const formData = new FormData(event.currentTarget);
    const payload = {
      segment: String(formData.get('segment') ?? ''),
      city: String(formData.get('city') ?? ''),
      state: String(formData.get('state') ?? ''),
      country: String(formData.get('country') ?? ''),
      radiusKm: formData.get('radiusKm') ? Number(formData.get('radiusKm')) : undefined,
      limit: Number(formData.get('limit') ?? 60),
    };

    setStatus('running');
    setStageMessage('Consultando empresas...');
    setProgress(null);
    setWarnings([]);
    setError(null);
    setSummary(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch('/api/prospecting', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const data = await response.json().catch(() => null);
        setError(data?.error ?? 'Nao foi possivel iniciar a prospeccao. Tente novamente.');
        setStatus('error');
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      // O corpo chega como NDJSON: uma linha por evento.
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.trim()) continue;

          let event: ProspectingEvent;
          try {
            event = JSON.parse(line) as ProspectingEvent;
          } catch {
            continue;
          }

          if (event.type === 'stage') setStageMessage(event.message);
          if (event.type === 'progress') setProgress({ processed: event.processed, total: event.total });
          if (event.type === 'warning') setWarnings((prev) => [...prev, event.message]);
          if (event.type === 'error') {
            setError(event.message);
            setStatus('error');
          }
          if (event.type === 'done') {
            setSummary(event.summary);
            setStatus('done');
            setStageMessage('Pesquisa concluida.');
            router.refresh();
          }
        }
      }

      setStatus((current) => (current === 'running' ? 'done' : current));
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        setStatus('idle');
        return;
      }
      setError('Conexao interrompida durante a pesquisa. Tente novamente.');
      setStatus('error');
    } finally {
      abortRef.current = null;
    }
  }

  const running = status === 'running';

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Field label="Segmento" htmlFor="segment" hint="Campo livre: restaurante, dentista, pet shop, contador...">
            <Input id="segment" name="segment" required minLength={2} placeholder="Restaurantes" />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Cidade" htmlFor="city">
              <Input id="city" name="city" required minLength={2} placeholder="Sao Jose dos Campos" />
            </Field>

            <Field label="Estado" htmlFor="state">
              <Input id="state" name="state" placeholder="SP" />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Pais" htmlFor="country">
              <Input id="country" name="country" defaultValue="Brasil" />
            </Field>

            <Field label="Raio" htmlFor="radiusKm" hint="Opcional. Ate 50 km.">
              <Select id="radiusKm" name="radiusKm" defaultValue="">
                <option value="">Sem raio definido</option>
                <option value="5">5 km</option>
                <option value="10">10 km</option>
                <option value="20">20 km</option>
                <option value="30">30 km</option>
                <option value="50">50 km</option>
              </Select>
            </Field>

            <Field label="Maximo de empresas" htmlFor="limit" hint="Controla o custo da API.">
              <Select id="limit" name="limit" defaultValue="60">
                <option value="20">20</option>
                <option value="40">40</option>
                <option value="60">60</option>
              </Select>
            </Field>
          </div>

          <Button type="submit" disabled={running} className="w-full sm:w-auto sm:self-start">
            {running ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Search className="size-4" aria-hidden />
            )}
            {running ? 'Procurando...' : 'ENCONTRAR LEADS'}
          </Button>
        </form>
      </Card>

      {status !== 'idle' ? (
        <Card aria-live="polite">
          <p className="text-sm font-medium text-ink">{stageMessage}</p>

          {progress && progress.total > 0 ? (
            <>
              <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-canvas">
                <div
                  className="h-full rounded-full bg-brand-600 transition-all"
                  style={{ width: `${Math.round((progress.processed / progress.total) * 100)}%` }}
                />
              </div>
              <p className="mt-2 text-xs text-ink-mute">
                {progress.processed} de {progress.total} empresas processadas
              </p>
            </>
          ) : null}

          {warnings.map((warning) => (
            <p key={warning} className="mt-2 rounded-lg bg-attention-soft px-3 py-2 text-sm text-attention">
              {warning}
            </p>
          ))}

          {error ? (
            <div className="mt-3">
              <ErrorMessage>{error}</ErrorMessage>
            </div>
          ) : null}

          {summary ? (
            <div className="mt-4 flex flex-col gap-3">
              <ul className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <li className="rounded-lg bg-canvas p-3">
                  <span className="block text-lg font-semibold text-ink">{summary.found}</span>
                  empresas encontradas
                </li>
                <li className="rounded-lg bg-canvas p-3">
                  <span className="block text-lg font-semibold text-ink">{summary.withoutWebsite}</span>
                  sem site identificado
                </li>
                <li className="rounded-lg bg-canvas p-3">
                  <span className="block text-lg font-semibold text-positive">{summary.excellent}</span>
                  excelentes oportunidades
                </li>
                <li className="rounded-lg bg-canvas p-3">
                  <span className="block text-lg font-semibold text-ink">{summary.alreadyKnown}</span>
                  ja estavam na base
                </li>
              </ul>

              <LinkButton href="/companies" variant="primary" className="sm:self-start">
                Ver resultados
              </LinkButton>
            </div>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}
