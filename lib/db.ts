import 'server-only';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { env } from './env';

/**
 * The one and only database handle (spec §2).
 *
 * Supabase is used here as plain Postgres with a good dashboard: no Supabase Auth, no
 * RLS, no Realtime. Access is server-side exclusively, through the service role key,
 * which is why this module is `server-only` — importing it from a client component is a
 * build error rather than a shipped credential.
 *
 * The client is created lazily and cached per serverless instance. That is a connection
 * object, not application state: nothing that has to survive a request is kept in
 * memory, because Vercel containers are ephemeral.
 */

let cached: SupabaseClient | null = null;

export function db(): SupabaseClient {
  if (!cached) {
    cached = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }
  return cached;
}
