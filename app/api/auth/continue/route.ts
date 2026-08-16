import { NextResponse } from 'next/server';

import { deviceUser } from '@/lib/auth';
import { apiError } from '@/lib/http';
import { signIn } from '@/lib/session';

/**
 * POST /api/auth/continue — no body
 *
 * The PIN-free path: "You're User 3 — Continue". Spec §5 folds this into `/api/auth/claim`
 * as an optional `pin`, but it is split out here deliberately.
 *
 * This is the only endpoint that grants a session without a PIN, so it must be incapable
 * of being pointed at somebody else. Taking no input at all — reading the identity purely
 * from the encrypted device cookie — makes impersonation structurally impossible rather
 * than dependent on getting a branch right. Any body sent is ignored.
 */

export async function POST() {
  const user = await deviceUser();

  if (!user) {
    return apiError(401, 'no_device', "This machine doesn't remember anyone. Pick your name.");
  }

  await signIn(user.id);
  return NextResponse.json({ user });
}
