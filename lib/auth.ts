import 'server-only';

import { compare, hash } from 'bcryptjs';

import { db } from './db';
import { getDevice, getSession } from './session';

/**
 * PIN handling and the lockout (spec §5).
 *
 * The rule that matters most in this file: the authenticated user id always comes from
 * the session cookie, never from a request body. `currentUser()` is the only way any
 * route learns who is calling. `/api/auth/claim` does take a `userId` in its body, but
 * that is the login step itself and it is worthless without the matching PIN.
 */

/** Exactly four digits (spec §5). */
export const PIN_PATTERN = /^\d{4}$/;

/**
 * A 4-digit PIN is only 10,000 combinations, so the online lockout below is the real
 * protection. Cost 12 exists for the offline case — if the table ever leaked, it makes
 * grinding all 10,000 hashes per user cost hours rather than minutes.
 */
const BCRYPT_COST = 12;

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

type UserRow = {
  id: string;
  name: string;
  pin_hash: string | null;
  is_owner: boolean;
  failed_attempts: number;
  locked_until: string | null;
};

/** Safe to send to the browser. Never carries `pin_hash`. */
export type PublicUser = { id: string; name: string; isOwner: boolean };

/** The name picker needs to know whether to ask for a PIN or to set one. */
export type PickerUser = { id: string; name: string; hasPin: boolean };

const USER_COLUMNS = 'id, name, pin_hash, is_owner, failed_attempts, locked_until';

function toPublic(row: UserRow): PublicUser {
  return { id: row.id, name: row.name, isOwner: row.is_owner };
}

async function findUser(userId: string): Promise<UserRow | null> {
  const { data, error } = await db()
    .from('users')
    .select(USER_COLUMNS)
    .eq('id', userId)
    .maybeSingle<UserRow>();

  if (error) throw new Error(`user lookup failed: ${error.message}`);
  return data ?? null;
}

export async function listUsersForPicker(): Promise<PickerUser[]> {
  const { data, error } = await db()
    .from('users')
    .select('id, name, pin_hash')
    .order('name');

  if (error) throw new Error(`user list failed: ${error.message}`);

  // pin_hash is reduced to a boolean here and never leaves the server.
  return (data ?? []).map((row) => ({
    id: row.id as string,
    name: row.name as string,
    hasPin: row.pin_hash !== null,
  }));
}

/** The authenticated caller, or null. The single source of identity for every route. */
export async function currentUser(): Promise<PublicUser | null> {
  const session = await getSession();
  if (!session.userId) return null;

  const row = await findUser(session.userId);
  // A session naming a deleted user is treated as no session at all.
  return row ? toPublic(row) : null;
}

/** Who last used this machine. Enough to offer "Continue", never enough to act. */
export async function deviceUser(): Promise<PublicUser | null> {
  const device = await getDevice();
  if (!device.userId) return null;

  const row = await findUser(device.userId);
  return row ? toPublic(row) : null;
}

export type VerifyResult =
  | { ok: true; user: PublicUser }
  | { ok: false; reason: 'unknown_user' }
  | { ok: false; reason: 'pin_not_set' }
  | { ok: false; reason: 'locked_out'; retryAfterSeconds: number }
  | { ok: false; reason: 'wrong_pin'; attemptsRemaining: number };

/**
 * Checks a PIN and maintains the 5-strikes / 15-minute lockout.
 *
 * On the fifth failure the counter resets and `locked_until` is set instead, so the next
 * five failures after the lockout expires start from a clean slate.
 */
export async function verifyPin(userId: string, pin: string): Promise<VerifyResult> {
  const user = await findUser(userId);
  if (!user) return { ok: false, reason: 'unknown_user' };

  const now = new Date();

  if (user.locked_until) {
    const until = new Date(user.locked_until);
    if (until > now) {
      return {
        ok: false,
        reason: 'locked_out',
        retryAfterSeconds: Math.ceil((until.getTime() - now.getTime()) / 1000),
      };
    }
  }

  if (!user.pin_hash) return { ok: false, reason: 'pin_not_set' };

  if (await compare(pin, user.pin_hash)) {
    await db()
      .from('users')
      .update({ failed_attempts: 0, locked_until: null })
      .eq('id', userId);
    return { ok: true, user: toPublic(user) };
  }

  const attempts = user.failed_attempts + 1;

  if (attempts >= MAX_FAILED_ATTEMPTS) {
    const lockedUntil = new Date(now.getTime() + LOCKOUT_MINUTES * 60_000);
    await db()
      .from('users')
      .update({ failed_attempts: 0, locked_until: lockedUntil.toISOString() })
      .eq('id', userId);
    return { ok: false, reason: 'locked_out', retryAfterSeconds: LOCKOUT_MINUTES * 60 };
  }

  await db().from('users').update({ failed_attempts: attempts }).eq('id', userId);
  return { ok: false, reason: 'wrong_pin', attemptsRemaining: MAX_FAILED_ATTEMPTS - attempts };
}

export type ClaimResult =
  | { ok: true; user: PublicUser }
  | { ok: false; reason: 'unknown_user' }
  | { ok: false; reason: 'pin_already_set' };

/**
 * First claim: sets the PIN on a user who has none.
 *
 * The update is conditional on `pin_hash` still being null, so if two people race to
 * claim the same name the loser is told the name is taken rather than silently
 * overwriting the winner's PIN. Same optimistic pattern the timeline uses in Phase 3.
 */
export async function claimPin(userId: string, pin: string): Promise<ClaimResult> {
  const user = await findUser(userId);
  if (!user) return { ok: false, reason: 'unknown_user' };
  if (user.pin_hash) return { ok: false, reason: 'pin_already_set' };

  const pinHash = await hash(pin, BCRYPT_COST);

  const { data, error } = await db()
    .from('users')
    .update({ pin_hash: pinHash, failed_attempts: 0, locked_until: null })
    .eq('id', userId)
    .is('pin_hash', null)
    .select('id, name, is_owner');

  if (error) throw new Error(`pin claim failed: ${error.message}`);
  if (!data || data.length === 0) return { ok: false, reason: 'pin_already_set' };

  return { ok: true, user: { id: user.id, name: user.name, isOwner: user.is_owner } };
}

/**
 * Owner-only PIN reset (spec §5): nulls the hash so the person sets a fresh PIN on their
 * next login. Also clears the lockout, since a forgotten PIN usually arrives with one.
 *
 * This is the *only* power `is_owner` grants. It is not an admin role and must not become
 * one — nobody owns playback.
 */
export async function clearPin(targetUserId: string): Promise<PublicUser | null> {
  const target = await findUser(targetUserId);
  if (!target) return null;

  const { error } = await db()
    .from('users')
    .update({ pin_hash: null, failed_attempts: 0, locked_until: null })
    .eq('id', targetUserId);

  if (error) throw new Error(`pin reset failed: ${error.message}`);
  return toPublic(target);
}
