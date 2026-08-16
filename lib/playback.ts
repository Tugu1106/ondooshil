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
