import { NextResponse } from 'next/server';

import { PIN_PATTERN, claimPin } from '@/lib/auth';
import { apiError, readJson, readString } from '@/lib/http';
import { signIn } from '@/lib/session';

/**
 * POST /api/auth/set-pin — `{ userId, pin }`
 *
 * First claim only. Works exclusively on a user whose `pin_hash` is null, so it can never
 * overwrite an existing PIN — that path belongs to the owner's reset.
 *
 * This endpoint is necessarily unauthenticated: on first claim there is no prior
 * credential to check. That is inherent to the design (spec §5) and acceptable for a
 * private room of six known people. The recovery path if someone claims the wrong name is
 * the owner's reset, which is exactly why that exists.
 */

export async function POST(request: Request) {
  const body = await readJson(request);
  const userId = readString(body, 'userId');
  const pin = readString(body, 'pin');

  if (!userId) {
    return apiError(400, 'bad_request', 'Pick a name first.');
  }
  if (!pin || !PIN_PATTERN.test(pin)) {
    return apiError(400, 'invalid_pin_format', 'Choose a PIN of exactly 4 digits.');
  }

  const result = await claimPin(userId, pin);

  if (!result.ok) {
    switch (result.reason) {
      case 'unknown_user':
        return apiError(404, 'unknown_user', "That name doesn't exist.");
      case 'pin_already_set':
        return apiError(
          409,
          'pin_already_set',
          'That name already has a PIN. Enter it, or ask the owner to reset it.',
        );
    }
  }

  await signIn(result.user.id);
  return NextResponse.json({ user: result.user });
}
