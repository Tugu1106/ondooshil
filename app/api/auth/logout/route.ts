import { NextResponse } from 'next/server';

import { signOut } from '@/lib/session';

/**
 * POST /api/auth/logout
 *
 * Clears `session` and deliberately keeps `device` (spec §5), so the next visit offers
 * "You're User 3 — Continue" instead of a cold name picker. Logging out means "stop
 * authorizing actions", not "forget me".
 *
 * Use "Not you?" on the gate to switch to a different person.
 */

export async function POST() {
  await signOut();
  return NextResponse.json({ ok: true });
}
