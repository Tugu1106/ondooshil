import { NextResponse } from 'next/server';

import { db } from '@/lib/db';
import { envStatus } from '@/lib/env';
import { stationTimeZone, todayInStationTz } from '@/lib/time';

/**
 * Setup diagnostics: is the database reachable, and does the server agree with the room
 * about what day it is?
 *
 * Reports configuration problems as data rather than throwing, so a half-configured
 * deployment tells you which variable is missing instead of returning an opaque 500.
 * Never echoes a secret's value — only whether each one is usable.
 */

export const dynamic = 'force-dynamic';

type DatabaseReport =
  | { status: 'ok'; users: number }
  | { status: 'unconfigured' }
  | { status: 'error'; message: string };

async function checkDatabase(configured: boolean): Promise<DatabaseReport> {
  if (!configured) return { status: 'unconfigured' };

  try {
    const { count, error } = await db()
      .from('users')
      .select('id', { count: 'exact', head: true });

    if (error) return { status: 'error', message: error.message };
    return { status: 'ok', users: count ?? 0 };
  } catch (cause) {
    return { status: 'error', message: cause instanceof Error ? cause.message : String(cause) };
  }
}

export async function GET() {
  const environment = envStatus();
  const configured =
    environment.SUPABASE_URL === 'ok' && environment.SUPABASE_SERVICE_ROLE_KEY === 'ok';

  const database = await checkDatabase(configured);

  let today: string | null = null;
  let timeZone: string | null = null;
  let timeZoneError: string | null = null;
  try {
    timeZone = stationTimeZone();
    today = todayInStationTz();
  } catch (cause) {
    timeZoneError = cause instanceof Error ? cause.message : String(cause);
  }

  const healthy = database.status === 'ok' && timeZoneError === null;

  return NextResponse.json(
    {
      db: database.status,
      today,
      serverTime: new Date().toISOString(),
      timeZone,
      ...(database.status === 'ok' ? { users: database.users } : {}),
      ...(database.status === 'error' ? { dbError: database.message } : {}),
      ...(timeZoneError ? { timeZoneError } : {}),
      env: environment,
    },
    { status: healthy ? 200 : 503 },
  );
}
