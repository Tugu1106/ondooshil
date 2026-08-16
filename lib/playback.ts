import 'server-only';

import { db } from './db';
import { advancePast } from './timeline';
import { supabaseTimelineRepo } from './timeline-repo';

/**
 * Recovery from a video that will not play (spec §7).
 *
 * Non-embeddable and region-blocked uploads are common enough that without this the
 * station silently dies mid-morning and looks like a queue bug. So: mark it `failed`,
 * advance immediately, never retry.
 */

export type FailResult =
  | { outcome: 'advanced' }
  /** Someone else already moved on — the report was for a song that is no longer current. */
  | { outcome: 'stale' };

/**
 * Marks the currently playing item `failed` and moves to the next song.
 *
 * Guarded three ways, because any authenticated client can call this and a bad video is
 * the only thing that should trigger it:
 *
 * - the item must actually be `player_state.current_item`
 * - the reported `videoId` must match that row, so a racing or replayed request cannot
 *   kill a different song
 * - the status update is conditional on `pending`, so a song already skipped or played
 *   is not relabelled
 */
export async function markFailedAndAdvance(
  itemId: string,
  videoId: string,
  now: Date,
  day: string,
): Promise<FailResult> {
  const repo = supabaseTimelineRepo();

  const state = await repo.loadPlayerState();
  if (state.current_item !== itemId) return { outcome: 'stale' };

  const item = await repo.loadQueueItem(itemId);
  if (!item || item.video_id !== videoId) return { outcome: 'stale' };

  const { error } = await db()
    .from('queue')
    .update({ status: 'failed' })
    .eq('id', itemId)
    .eq('status', 'pending');

  if (error) throw new Error(`marking failed: ${error.message}`);

  await advancePast(repo, itemId, now, day);
  return { outcome: 'advanced' };
}

export type SkipResult =
  | { outcome: 'skipped' }
  | { outcome: 'unknown' }
  | { outcome: 'not_yours' }
  | { outcome: 'not_playing' };

/**
 * Skips the currently playing song. **Only its adder may do this** (spec §8).
 *
 * Nothing about who skipped is recorded or returned. Only the adder can skip, so naming
 * the skipper anywhere would reveal that they queued the anonymous song — for free,
 * completely bypassing the reveal-ticket system. The queue just moves on.
 *
 * A skip starts the next song at `now()`: the skipped one did not run its length, so an
 * accumulating transition would place the next start in the past.
 */
export async function skipCurrent(
  itemId: string,
  userId: string,
  now: Date,
  day: string,
): Promise<SkipResult> {
  const repo = supabaseTimelineRepo();

  const state = await repo.loadPlayerState();
  if (state.current_item !== itemId) return { outcome: 'not_playing' };

  const item = await repo.loadQueueItem(itemId);
  if (!item) return { outcome: 'unknown' };
  if (item.added_by !== userId) return { outcome: 'not_yours' };

  const { error } = await db()
    .from('queue')
    .update({ status: 'skipped' })
    .eq('id', itemId)
    .eq('status', 'pending');

  if (error) throw new Error(`marking skipped: ${error.message}`);

  await advancePast(repo, itemId, now, day);
  return { outcome: 'skipped' };
}

export type RemoveResult =
  | { outcome: 'removed' }
  | { outcome: 'unknown' }
  | { outcome: 'not_yours' }
  | { outcome: 'not_pending' }
  | { outcome: 'on_air' };

/**
 * Removes a pending song. Only its adder, and only while it is still waiting (spec §8).
 *
 * The song that is on air is refused even though its status is still `pending` — that is
 * what skip is for, and `player_state.current_item` is a foreign key onto this row, so
 * deleting it would fail at the database anyway.
 *
 * Any reveal tickets spent on the row go with it. They have to: `reveals.queue_item_id`
 * is a foreign key. The side effect is that whoever paid to unmask this song gets their
 * ticket back, which seems the fairer way round given the song will never play.
 */
export async function removePending(itemId: string, userId: string): Promise<RemoveResult> {
  const repo = supabaseTimelineRepo();

  const item = await repo.loadQueueItem(itemId);
  if (!item) return { outcome: 'unknown' };
  if (item.added_by !== userId) return { outcome: 'not_yours' };
  if (item.status !== 'pending') return { outcome: 'not_pending' };

  const state = await repo.loadPlayerState();
  if (state.current_item === itemId) return { outcome: 'on_air' };

  const { error: revealError } = await db().from('reveals').delete().eq('queue_item_id', itemId);
  if (revealError) throw new Error(`clearing reveals: ${revealError.message}`);

  const { error } = await db()
    .from('queue')
    .delete()
    .eq('id', itemId)
    .eq('status', 'pending');

  if (error) throw new Error(`removing song: ${error.message}`);
  return { outcome: 'removed' };
}
