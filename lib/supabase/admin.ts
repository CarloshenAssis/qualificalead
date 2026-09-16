import 'server-only';
import { createClient } from '@supabase/supabase-js';

/** Service client for authenticated provider callbacks only. Never import in client code. */
export function createAdminClient(env: NodeJS.ProcessEnv = process.env) {
  const url = env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase service configuration is missing');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
