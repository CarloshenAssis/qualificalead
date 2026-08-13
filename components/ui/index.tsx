import type { ComponentProps, ReactNode } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

/** Primitivos visuais compartilhados (SPEC 31/32). Area de toque minima de 44px. */

const BUTTON_BASE =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60';

const BUTTON_VARIANTS = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700',
  positive: 'bg-positive text-white hover:brightness-95',
  secondary: 'border border-line bg-surface text-ink hover:bg-canvas',
  ghost: 'text-ink-soft hover:bg-canvas',
  danger: 'border border-danger/30 bg-danger-soft text-danger hover:brightness-95',
} as const;

export type ButtonVariant = keyof typeof BUTTON_VARIANTS;

export function Button({
  variant = 'primary',
  className,
  ...props
}: ComponentProps<'button'> & { variant?: ButtonVariant }) {
  return <button className={cn(BUTTON_BASE, BUTTON_VARIANTS[variant], className)} {...props} />;
}

export function LinkButton({
  variant = 'secondary',
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: ButtonVariant }) {
  return <Link className={cn(BUTTON_BASE, BUTTON_VARIANTS[variant], className)} {...props} />;
}

export function ExternalLinkButton({
  variant = 'secondary',
  className,
  ...props
}: ComponentProps<'a'> & { variant?: ButtonVariant }) {
  return (
    <a
      className={cn(BUTTON_BASE, BUTTON_VARIANTS[variant], className)}
      target="_blank"
      rel="noopener noreferrer"
      {...props}
    />
  );
}

export function Card({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn('rounded-xl border border-line bg-surface p-4 sm:p-5', className)}
      {...props}
    />
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="text-base font-semibold text-ink">{children}</h2>
      {action}
    </div>
  );
}

export function Badge({
  tone = 'neutral',
  className,
  ...props
}: ComponentProps<'span'> & { tone?: 'neutral' | 'brand' | 'positive' | 'attention' | 'danger' }) {
  const tones = {
    neutral: 'bg-canvas text-ink-soft border-line',
    brand: 'bg-brand-50 text-brand-700 border-brand-100',
    positive: 'bg-positive-soft text-positive border-positive/20',
    attention: 'bg-attention-soft text-attention border-attention/20',
    danger: 'bg-danger-soft text-danger border-danger/20',
  } as const;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium',
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}

export function Field({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium text-ink-soft">
        {label}
      </label>
      {children}
      {hint ? <p className="text-xs text-ink-mute">{hint}</p> : null}
    </div>
  );
}

const CONTROL =
  'min-h-11 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink placeholder:text-ink-mute';

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input className={cn(CONTROL, className)} {...props} />;
}

export function Select({ className, ...props }: ComponentProps<'select'>) {
  return <select className={cn(CONTROL, 'pr-8', className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea className={cn(CONTROL, 'min-h-24 py-2 leading-relaxed', className)} {...props} />;
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <Card className="flex flex-col items-center gap-2 py-10 text-center">
      <p className="text-sm font-semibold text-ink">{title}</p>
      <p className="max-w-md text-sm text-ink-mute">{description}</p>
      {action ? <div className="mt-2">{action}</div> : null}
    </Card>
  );
}

export function ErrorMessage({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
      {children}
    </p>
  );
}

export function Stat({ label, value, tone }: { label: string; value: number | string; tone?: 'brand' | 'positive' | 'attention' }) {
  const toneClass = {
    brand: 'text-brand-700',
    positive: 'text-positive',
    attention: 'text-attention',
  };

  return (
    <Card className="flex flex-col gap-1">
      <span className="text-xs font-medium uppercase tracking-wide text-ink-mute">{label}</span>
      <span className={cn('text-2xl font-semibold text-ink', tone && toneClass[tone])}>{value}</span>
    </Card>
  );
}
