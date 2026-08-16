import 'server-only';

import { db } from './db';

/**
 * Reveal tickets — read side only (spec §9).
 *
 * Phase 2 needs the counts so `/api/state` can report them honestly against a table that
 * happens to be empty. Spending a ticket (`POST /api/reveal/:id`) belongs to Phase 7.
 *
 * A reveal is private to the person who spent it and is never announced to the room.
 */

/** Three per person per day, resetting at 00:00 in the station's time zone. */
export const DAILY_REVEAL_LIMIT = 3;

/** The queue item ids this viewer has already revealed today. */
export async function revealedTodayBy(userId: string, day: string): Promise<Set<string>> {
  const { data, error } = await db()
    .from('reveals')
    .select('queue_item_id')
    .eq('user_id', userId)
    .eq('day', day);

  if (error) throw new Error(`reveal lookup failed: ${error.message}`);
  return new Set((data ?? []).map((row) => row.queue_item_id as string));
}

export function revealsRemaining(revealedCount: number): number {
  return Math.max(0, DAILY_REVEAL_LIMIT - revealedCount);
}

export type RevealResult =
  | { outcome: 'revealed'; name: string; remaining: number }
  /** Already yours, already public, or already paid for today — no ticket spent. */
  | { outcome: 'free'; name: string; remaining: number }
  | { outcome: 'unknown' }
  | { outcome: 'exhausted' };

/**
 * Spends a ticket to learn who queued a song.
 *
 * The order of the checks matters. Anything already visible — your own song, an opted-in
 * name, or one you revealed earlier today — is answered *before* the budget is consulted,
 * so re-revealing the same song stays free even after all three tickets are gone. Getting
 * that backwards would make a repeat look like a fourth reveal.
 *
 * The song is looked up by id with no day filter, so the one on air can be revealed even
 * when it started before midnight.
 */
export async function spendReveal(
  userId: string,
  queueItemId: string,
  day: string,
): Promise<RevealResult> {
  const { data: item, error: itemError } = await db()
    .from('queue')
    .select('id, added_by, show_name')
    .eq('id', queueItemId)
    .maybeSingle<{ id: string; added_by: string; show_name: boolean }>();

  if (itemError) throw new Error(`reveal lookup failed: ${itemError.message}`);
  if (!item) return { outcome: 'unknown' };

  const { data: adder, error: adderError } = await db()
    .from('users')
    .select('name')
    .eq('id', item.added_by)
    .maybeSingle<{ name: string }>();

  if (adderError) throw new Error(`adder lookup failed: ${adderError.message}`);
  if (!adder) return { outcome: 'unknown' };

  const alreadyRevealed = await revealedTodayBy(userId, day);
  const spentToday = alreadyRevealed.size;

  if (item.show_name || item.added_by === userId || alreadyRevealed.has(queueItemId)) {
    return { outcome: 'free', name: adder.name, remaining: revealsRemaining(spentToday) };
  }

  if (spentToday >= DAILY_REVEAL_LIMIT) return { outcome: 'exhausted' };

  // Upsert rather than insert: the primary key is `(user_id, queue_item_id)` with no day
  // in it, so a song revealed yesterday and revealed again today would otherwise collide.
  // A new day is a new budget, so this correctly costs a ticket and re-stamps the day.
  const { error } = await db()
    .from('reveals')
    .upsert({ user_id: userId, queue_item_id: queueItemId, day }, { onConflict: 'user_id,queue_item_id' });

  if (error) throw new Error(`reveal failed: ${error.message}`);

  return { outcome: 'revealed', name: adder.name, remaining: revealsRemaining(spentToday + 1) };
}
