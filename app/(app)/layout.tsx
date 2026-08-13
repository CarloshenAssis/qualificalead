import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Target } from 'lucide-react';
import { BottomNav, Sidebar } from '@/components/nav/AppNav';
import { getUser } from '@/lib/supabase/server';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser();
  if (!user) redirect('/login');

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-10 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <Link href="/dashboard" className="flex items-center gap-2 font-semibold text-ink">
            <Target className="size-5 text-brand-600" aria-hidden />
            LeadHunter
          </Link>
          <span className="max-w-40 truncate text-sm text-ink-mute" title={user.email ?? ''}>
            {user.email}
          </span>
        </div>
      </header>

      <div className="mx-auto flex max-w-6xl gap-6 px-4 py-6">
        <aside className="hidden w-52 shrink-0 md:block">
          <div className="sticky top-20">
            <Sidebar />
          </div>
        </aside>

        <main className="min-w-0 flex-1">{children}</main>
      </div>

      <BottomNav />
    </div>
  );
}
