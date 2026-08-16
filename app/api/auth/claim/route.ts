import { NextResponse } from 'next/server';

import { PIN_PATTERN, verifyPin } from '@/lib/auth';
import { apiError, readJson, readString } from '@/lib/http';
import { signIn } from '@/lib/session';

/**
 * POST /api/auth/claim — `{ userId, pin }`
 *
 * Claiming a name always costs a PIN. This is the one endpoint that legitimately takes a
 * user id from the request body, because it *is* the login step and the id is worthless
 * without the matching PIN. The PIN-free path lives in `/api/auth/continue`, which reads
 * the device cookie and accepts no body at all.
 */

export async function POST(request: Request) {
  const body = await readJson(request);
  const userId = readString(body, 'userId');
  const pin = readString(body, 'pin');

  if (!userId) {
    return apiError(400, 'bad_request', 'Pick a name first.');
  }
  if (!pin || !PIN_PATTERN.test(pin)) {
    return apiError(400, 'invalid_pin_format', 'Your PIN is 4 digits.');
  }

  const result = await verifyPin(userId, pin);

  if (!result.ok) {
    switch (result.reason) {
      case 'unknown_user':
        return apiError(404, 'unknown_user', "That name doesn't exist.");
      case 'pin_not_set':
        return apiError(409, 'pin_not_set', 'This name has no PIN yet. Set one to claim it.');
      case 'locked_out':
        return apiError(
          429,
          'locked_out',
          `Too many wrong PINs. Try again in ${Math.ceil(result.retryAfterSeconds / 60)} minutes.`,
          { retryAfterSeconds: result.retryAfterSeconds },
        );
      case 'wrong_pin':
        return apiError(401, 'wrong_pin', `Wrong PIN. ${result.attemptsRemaining} tries left.`, {
          attemptsRemaining: result.attemptsRemaining,
        });
    }
  }

  await signIn(result.user.id);
  return NextResponse.json({ user: result.user });
}
