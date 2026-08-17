import { NextResponse } from 'next/server';

import { loadSky } from '@/lib/weather';

/**
 * The sky over the office.
 *
 * Deliberately **not** folded into `/api/state`. That route is the hot path — every
 * listener hits it every three seconds — and the weather changes on the order of an hour.
 * Keeping them apart means the background can be refreshed lazily without adding an
 * outbound request to the station's poll.
 *
 * No session required: it is the same public forecast for everyone in the room, and it
 * carries nothing about anybody. `loadSky` never throws, so this never 500s.
 */
export async function GET() {
  return NextResponse.json(await loadSky());
}
