import type { QueueItemRow } from '@/lib/queue';
import { orderRoundRobin } from '@/lib/queue';
import type { PlayerStateRow, TimelineRepo } from '@/lib/timeline';

/**
 * An in-memory `TimelineRepo` for the timeline tests.
 *
 * Deliberately faithful about the two things that actually matter:
 *
 * - `setCurrent` really is conditional on the expected `current_item`, so a lost race
 *   behaves here exactly as it does in Postgres.
 * - `loadQueueItem` looks up by id with **no day filter**, so the midnight-crossing test
 *   is meaningful rather than accidental.
 *
 * It also counts calls, which is how "advance at most one song per call" is asserted.
 */

let nextId = 0;

export function song(overrides: Partial<QueueItemRow> = {}): QueueItemRow {
  nextId += 1;
  return {
    id: overrides.id ?? `song-${nextId}`,
    video_id: 'aaaaaaaaaaa',
    title: `Song ${nextId}`,
    duration_sec: 180,
    added_by: 'user-a',
    show_name: false,
    status: 'pending',
    day: '2026-08-16',
    created_at: `2026-08-16T00:00:${String(nextId).padStart(2, '0')}.000Z`,
    ...overrides,
  };
}

export class FakeRepo implements TimelineRepo {
  playerState: PlayerStateRow = { current_item: null, started_at: null };
  queue: QueueItemRow[] = [];

  setCurrentCalls = 0;
  pickNextCalls = 0;
  markPlayedCalls: string[] = [];

  /** Simulates another poller winning the race, once, on the next setCurrent. */
  loseNextRace: { current_item: string | null; started_at: string | null } | null = null;

  constructor(queue: QueueItemRow[] = []) {
    this.queue = queue;
  }

  async loadPlayerState(): Promise<PlayerStateRow> {
    return { ...this.playerState };
  }

  async loadQueueItem(id: string): Promise<QueueItemRow | null> {
    return this.queue.find((item) => item.id === id) ?? null;
  }

  async pickNext(day: string): Promise<QueueItemRow | null> {
    this.pickNextCalls += 1;
    const pending = this.queue.filter((item) => item.status === 'pending' && item.day === day);
    return orderRoundRobin(pending)[0] ?? null;
  }

  async markPlayed(id: string): Promise<void> {
    this.markPlayedCalls.push(id);
    const item = this.queue.find((row) => row.id === id);
    // Conditional on 'pending', mirroring the real implementation.
    if (item && item.status === 'pending') item.status = 'played';
  }

  async setCurrent(
    expected: string | null,
    next: string | null,
    startedAt: Date | null,
  ): Promise<boolean> {
    this.setCurrentCalls += 1;

    if (this.loseNextRace) {
      this.playerState = this.loseNextRace;
      this.loseNextRace = null;
      return false;
    }

    if (this.playerState.current_item !== expected) return false;

    this.playerState = {
      current_item: next,
      started_at: startedAt ? startedAt.toISOString() : null,
    };
    return true;
  }
}
