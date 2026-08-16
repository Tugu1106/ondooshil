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
