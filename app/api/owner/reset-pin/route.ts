import { NextResponse } from 'next/server';

import { clearPin, currentUser } from '@/lib/auth';
import { apiError, readJson, readString } from '@/lib/http';

/**
 * POST /api/owner/reset-pin — `{ userId }`
 *
 * Nulls someone's PIN so they set a fresh one on next login. Needed because people forget
 * PINs, and because a mis-tapped name on day one would otherwise lock a PIN onto the
 * wrong person permanently.
 *
 * The caller is identified from the session cookie, never from the body — the body's
 * `userId` is the *target*, and the two must not be confused.
 *
 * `is_owner` grants this and nothing else. It is not an admin role (spec §1).
 */

export async function POST(request: Request) {
  const caller = await currentUser();
  if (!caller) {
    return apiError(401, 'not_authenticated', 'Sign in first.');
  }
  if (!caller.isOwner) {
    return apiError(403, 'not_owner', 'Only the owner can reset a PIN.');
  }

  const body = await readJson(request);
  const targetUserId = readString(body, 'userId');
  if (!targetUserId) {
    return apiError(400, 'bad_request', 'Say whose PIN to reset.');
  }

  const target = await clearPin(targetUserId);
  if (!target) {
    return apiError(404, 'unknown_user', "That name doesn't exist.");
  }

  return NextResponse.json({ user: target });
}
