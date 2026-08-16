import 'server-only';

import { db } from './db';
import type { QueueStatus } from './types';

/**
 * Queue reads, writes, and the round-robin ordering (spec §6).
 *
 * Everyone's 1st pending song plays, then everyone's 2nd, and so on, ties broken by who
 * pasted first. One person adding collapses to plain FIFO, so someone alone at 8am is
 * never throttled; two people alternate. If Bat pastes 15 songs and Sara pastes 1, Sara's
 * plays second.
 *
 * There is deliberately NO cap on pending songs. A cap is context-blind — it blocks Bat's
 * 6th song at 8am when there is nobody to be fair to. Round-robin only constrains someone
 * when another person actually wants a turn.
 */

export type QueueItemRow = {
  id: string;
  video_id: string;
  title: string;
  duration_sec: number;
  added_by: string;
  show_name: boolean;
  status: QueueStatus;
  day: string;
  created_at: string;
};

const QUEUE_COLUMNS =
  'id, video_id, title, duration_sec, added_by, show_name, status, day, created_at';

/** Deterministic ordering within a turn: paste time, then id so ties never reshuffle. */
function byCreation(a: QueueItemRow, b: QueueItemRow): number {
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Round-robin ordering. Pure, so it can be unit tested without a database — which is why
 * it lives here in TypeScript rather than in SQL. The reference definition from spec §6 is:
 *
 *   SELECT * FROM (
 *     SELECT *, ROW_NUMBER() OVER (PARTITION BY added_by ORDER BY created_at) AS turn
 *     FROM queue WHERE status = 'pending' AND day = $today
 *   ) t
 *   ORDER BY turn, created_at;
 *
 * This produces the identical order. Row counts are one day of a six-person office, so
 * doing it in memory costs nothing.
 */
export function orderRoundRobin(pending: QueueItemRow[]): QueueItemRow[] {
  const turnsTaken = new Map<string, number>();

  const numbered = [...pending].sort(byCreation).map((item) => {
    const turn = (turnsTaken.get(item.added_by) ?? 0) + 1;
    turnsTaken.set(item.added_by, turn);
    return { item, turn };
  });

  return numbered
    .sort((a, b) => (a.turn !== b.turn ? a.turn - b.turn : byCreation(a.item, b.item)))
    .map(({ item }) => item);
}

/**
 * Every queue row for one day, all statuses.
 *
 * The day filter is the daily reset (spec §6): songs still pending at midnight are simply
 * never selected again, and history stays for debugging. Note this filter belongs to the
 * queue *list* and to `pickNext()` — never to resolving `player_state.current_item`, which
 * is always looked up by id so a song crossing midnight finishes.
 */
export async function listDay(day: string): Promise<QueueItemRow[]> {
  const { data, error } = await db()
    .from('queue')
    .select(QUEUE_COLUMNS)
    .eq('day', day)
    .returns<QueueItemRow[]>();

  if (error) throw new Error(`queue list failed: ${error.message}`);
  return data ?? [];
}

export type NewSong = {
  videoId: string;
  title: string;
  durationSec: number;
  addedBy: string;
  showName: boolean;
  day: string;
};

/** Duplicates are allowed by design (spec §10). Do not deduplicate. */
export async function insertSong(song: NewSong): Promise<QueueItemRow> {
  const { data, error } = await db()
    .from('queue')
    .insert({
      video_id: song.videoId,
      title: song.title,
      duration_sec: song.durationSec,
      added_by: song.addedBy,
      show_name: song.showName,
      day: song.day,
      status: 'pending',
    })
    .select(QUEUE_COLUMNS)
    .single<QueueItemRow>();

  if (error) throw new Error(`queue insert failed: ${error.message}`);
  if (!data) throw new Error('queue insert returned no row');
  return data;
}
