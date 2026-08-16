import type { QueueItemRow } from './queue';

/**
 * The timeline — the core of the system (spec §6).
 *
 * `player_state.current_item` + `player_state.started_at` define the broadcast. Everything
 * else is derived. Clients do not decide what plays; they read this and seek themselves
 * into position, which is what makes "no admin" possible: the schedule is deterministic,
 * so nobody needs authority over it.
 *
 * This module is deliberately pure — no database import, no `server-only` — and takes its
 * clock and its storage as parameters. Every edge case below is therefore testable
 * without a database, a browser, or waiting three minutes for a song to end.
 */

/**
 * Beyond this much overshoot, a transition cold-starts at `now()` instead of chaining
 * from the previous song's scheduled end (spec §6, rule 2).
 *
 * Without it, the office comes back from a one-hour lunch and the server computes that
 * fifteen songs "played" to an empty room, silently burning the whole queue. Thirty
 * seconds distinguishes "a poll arrived slightly late" from "nobody was here". At most one
 * song is lost to a gap.
 */
export const OVERSHOOT_COLD_START_SEC = 30;

export type PlayerStateRow = {
  current_item: string | null;
  started_at: string | null;
};

export interface TimelineRepo {
  loadPlayerState(): Promise<PlayerStateRow>;

  /**
   * By id, with **no day filter** — this is what lets a song that started before midnight
   * finish after it (spec §6). The day filter belongs to the queue list and `pickNext`.
   */
  loadQueueItem(id: string): Promise<QueueItemRow | null>;

  /** The round-robin winner among today's pending songs, or null for silence. */
  pickNext(day: string): Promise<QueueItemRow | null>;

  /** Marks a finished song `played`. Must not clobber an already-`skipped` row. */
  markPlayed(id: string): Promise<void>;

  /**
   * The optimistic conditional update:
   *
   *   UPDATE player_state SET current_item = $next, started_at = $ts
   *   WHERE id = 1 AND current_item = $expected
   *
   * Returns false when zero rows changed, meaning another request advanced first.
   */
  setCurrent(
    expected: string | null,
    next: string | null,
    startedAt: Date | null,
  ): Promise<boolean>;
}

export type Resolved = {
  current: QueueItemRow | null;
  startedAt: Date | null;
};

const SILENCE: Resolved = { current: null, startedAt: null };

/** Reads whatever the broadcast currently is, without changing anything. */
async function readCurrent(repo: TimelineRepo): Promise<Resolved> {
  const state = await repo.loadPlayerState();
  if (!state.current_item || !state.started_at) return SILENCE;

  const item = await repo.loadQueueItem(state.current_item);
  if (!item) return SILENCE;

  return { current: item, startedAt: new Date(state.started_at) };
}

/**
 * Attempts one advance. If another request got there first the update affects zero rows,
 * and we re-read and report *their* state rather than retrying — retrying is how a queue
 * gets silently burned by a thundering herd of pollers.
 */
async function advance(
  repo: TimelineRepo,
  expected: string | null,
  next: QueueItemRow | null,
  startedAt: Date | null,
): Promise<Resolved> {
  const won = await repo.setCurrent(expected, next?.id ?? null, startedAt);
  if (!won) return readCurrent(repo);

  return next ? { current: next, startedAt } : SILENCE;
}

/**
 * Called on every `/api/state` request. Advances **at most one song** — never loops.
 * Successive 3-second polls handle successive songs naturally, and a bounded single step
 * is what makes the overshoot rule easy to reason about (spec §6, rule 3).
 */
export async function resolveState(
  repo: TimelineRepo,
  now: Date,
  day: string,
): Promise<Resolved> {
  const state = await repo.loadPlayerState();

  // Case A: nothing playing — try a cold start.
  if (!state.current_item) {
    const next = await repo.pickNext(day);
    if (!next) return SILENCE; // Silence is correct. There is no fallback playlist.
    return advance(repo, null, next, now);
  }

  // Can't-happen state: a current item with no start time. Clear it conditionally and let
  // the next poll cold-start rather than inventing a playhead.
  if (!state.started_at) {
    return advance(repo, state.current_item, null, null);
  }

  const item = await repo.loadQueueItem(state.current_item);
  if (!item) {
    // current_item points at a row that no longer exists. Clear and go silent.
    return advance(repo, state.current_item, null, null);
  }

  const startedAt = new Date(state.started_at);
  const elapsedSec = (now.getTime() - startedAt.getTime()) / 1000;

  // Case B: still playing.
  if (elapsedSec < item.duration_sec) {
    return { current: item, startedAt };
  }

  // Case C: the current song has finished.
  await repo.markPlayed(item.id);

  const overshootSec = elapsedSec - item.duration_sec;
  const next = await repo.pickNext(day);

  if (!next) return advance(repo, item.id, null, null); // go silent

  const nextStartedAt =
    overshootSec < OVERSHOOT_COLD_START_SEC
      ? // Normal back-to-back transition. `started_at + duration` is exact; using now()
        // would add the poll delay to every transition and compound across the day.
        new Date(startedAt.getTime() + item.duration_sec * 1000)
      : // A gap happened — lunch, or everyone closed their tabs.
        now;

  return advance(repo, item.id, next, nextStartedAt);
}
