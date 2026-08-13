'use client';

import { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button, type ButtonVariant } from './index';

/** Copia com um clique e confirma na propria interface (SPEC 28). */
export function CopyButton({
  value,
  label = 'Copiar',
  variant = 'secondary',
  className,
}: {
  value: string;
  label?: string;
  variant?: ButtonVariant;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!copied && !failed) return;
    const timer = setTimeout(() => {
      setCopied(false);
      setFailed(false);
    }, 2000);
    return () => clearTimeout(timer);
  }, [copied, failed]);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      setFailed(true);
    }
  }

  return (
    <Button type="button" variant={variant} onClick={handleCopy} className={className}>
      {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
      <span aria-live="polite">
        {copied ? 'Copiado!' : failed ? 'Nao foi possivel copiar' : label}
      </span>
    </Button>
  );
}
