import 'server-only';

import { db } from './db';
import { orderRoundRobin, type QueueItemRow } from './queue';
import type { PlayerStateRow, TimelineRepo } from './timeline';

/**
 * The Supabase-backed `TimelineRepo`.
 *
 * Kept apart from `lib/timeline.ts` so the engine itself stays free of any database
 * import and can be unit tested against a fake.
 */

const QUEUE_COLUMNS =
  'id, video_id, title, duration_sec, added_by, show_name, status, day, created_at';

export function supabaseTimelineRepo(): TimelineRepo {
  return {
    async loadPlayerState(): Promise<PlayerStateRow> {
      const { data, error } = await db()
        .from('player_state')
        .select('current_item, started_at')
        .eq('id', 1)
        .single<PlayerStateRow>();

      if (error) throw new Error(`player_state read failed: ${error.message}`);
      return data ?? { current_item: null, started_at: null };
    },

    async loadQueueItem(id: string): Promise<QueueItemRow | null> {
      // By id only. Adding a day filter here would cut off a song crossing midnight.
      const { data, error } = await db()
        .from('queue')
        .select(QUEUE_COLUMNS)
        .eq('id', id)
        .maybeSingle<QueueItemRow>();

      if (error) throw new Error(`queue item read failed: ${error.message}`);
      return data ?? null;
    },

    async pickNext(day: string): Promise<QueueItemRow | null> {
      const { data, error } = await db()
        .from('queue')
        .select(QUEUE_COLUMNS)
        .eq('day', day)
        .eq('status', 'pending')
        .returns<QueueItemRow[]>();

      if (error) throw new Error(`pickNext failed: ${error.message}`);
      return orderRoundRobin(data ?? [])[0] ?? null;
    },

    async markPlayed(id: string): Promise<void> {
      // Conditional on 'pending' so a concurrent skip is never overwritten with 'played'.
      const { error } = await db()
        .from('queue')
        .update({ status: 'played' })
        .eq('id', id)
        .eq('status', 'pending');

      if (error) throw new Error(`markPlayed failed: ${error.message}`);
    },

    async setCurrent(
      expected: string | null,
      next: string | null,
      startedAt: Date | null,
    ): Promise<boolean> {
      const update = db()
        .from('player_state')
        .update({ current_item: next, started_at: startedAt?.toISOString() ?? null })
        .eq('id', 1);

      // `WHERE current_item = $expected` — and `IS NULL` when nothing was playing, since
      // SQL equality never matches null.
      const conditional = expected === null ? update.is('current_item', null) : update.eq('current_item', expected);

      const { data, error } = await conditional.select('current_item');

      if (error) throw new Error(`setCurrent failed: ${error.message}`);

      // Zero rows means somebody else advanced first.
      return (data?.length ?? 0) > 0;
    },
  };
}
