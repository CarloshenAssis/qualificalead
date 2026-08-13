import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { isSupabaseConfigured, publicEnv } from '@/lib/env';

const PUBLIC_PREFIXES = ['/login', '/signup', '/auth', '/setup'];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Renova a sessao do Supabase e protege as rotas da aplicacao (SPEC 4/33).
 */
export async function updateSession(request: NextRequest) {
  if (!isSupabaseConfigured()) {
    // Sem configuracao nao ha como autenticar: manda para a tela de setup.
    if (request.nextUrl.pathname === '/setup') return NextResponse.next({ request });
    const url = request.nextUrl.clone();
    url.pathname = '/setup';
    return NextResponse.redirect(url);
  }

  let response = NextResponse.next({ request });
  const env = publicEnv();

  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  // Rotas de API respondem 401 em JSON: redirecionar para HTML quebraria o
  // `fetch` do cliente quando a sessao expira no meio de uma prospeccao.
  if (!user && pathname.startsWith('/api/')) {
    return NextResponse.json(
      { error: 'Sessao expirada. Faca login novamente.' },
      { status: 401 },
    );
  }

  if (!user && !isPublicPath(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  if (user && (pathname === '/login' || pathname === '/signup')) {
    const url = request.nextUrl.clone();
    url.pathname = '/dashboard';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return response;
}
