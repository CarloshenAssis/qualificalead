'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Building2, KanbanSquare, LayoutDashboard, Search, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';

const ITEMS = [
  { href: '/dashboard', label: 'Painel', icon: LayoutDashboard },
  { href: '/prospecting', label: 'Prospectar', icon: Search },
  { href: '/companies', label: 'Empresas', icon: Building2 },
  { href: '/pipeline', label: 'Pipeline', icon: KanbanSquare },
  { href: '/settings', label: 'Ajustes', icon: Settings },
] as const;

function useActive(href: string) {
  const pathname = usePathname();
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavLink({
  href,
  label,
  icon: Icon,
  variant,
}: {
  href: string;
  label: string;
  icon: typeof Search;
  variant: 'sidebar' | 'bottom';
}) {
  const active = useActive(href);

  if (variant === 'bottom') {
    return (
      <Link
        href={href}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'flex min-h-14 flex-1 flex-col items-center justify-center gap-1 text-xs font-medium',
          active ? 'text-brand-700' : 'text-ink-mute',
        )}
      >
        <Icon className="size-5" aria-hidden />
        {label}
      </Link>
    );
  }

  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium',
        active ? 'bg-brand-50 text-brand-700' : 'text-ink-soft hover:bg-canvas',
      )}
    >
      <Icon className="size-5" aria-hidden />
      {label}
    </Link>
  );
}

/** Barra lateral no desktop (SPEC 30). */
export function Sidebar() {
  return (
    <nav aria-label="Navegacao principal" className="flex flex-col gap-1">
      {ITEMS.map((item) => (
        <NavLink key={item.href} {...item} variant="sidebar" />
      ))}
    </nav>
  );
}

/** Navegacao inferior no celular, com alvos grandes (SPEC 30/32). */
export function BottomNav() {
  return (
    <nav
      aria-label="Navegacao principal"
      className="fixed inset-x-0 bottom-0 z-20 flex border-t border-line bg-surface md:hidden"
    >
      {ITEMS.map((item) => (
        <NavLink key={item.href} {...item} variant="bottom" />
      ))}
    </nav>
  );
}
