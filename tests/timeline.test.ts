import { describe, expect, it } from 'vitest';

import { OVERSHOOT_COLD_START_SEC, resolveState } from '@/lib/timeline';

import { FakeRepo, song } from './fake-repo';

/**
 * The timeline engine (spec §6). Every case here corresponds to a specific bug the design
 * was written to avoid — the comments say which.
 */

const DAY = '2026-08-16';
const at = (iso: string) => new Date(iso);

describe('Case A — nothing playing', () => {
  it('stays silent when the queue is empty', async () => {
    const repo = new FakeRepo();

    const resolved = await resolveState(repo, at('2026-08-16T09:00:00Z'), DAY);

    expect(resolved.current).toBeNull();
    expect(resolved.startedAt).toBeNull();
    // Silence is correct — no fallback playlist, no filler.
    expect(repo.setCurrentCalls).toBe(0);
  });

  it('cold-starts at now() when a song is waiting', async () => {
    const first = song({ id: 'a', duration_sec: 200 });
    const repo = new FakeRepo([first]);
    const now = at('2026-08-16T09:00:00Z');

    const resolved = await resolveState(repo, now, DAY);

    expect(resolved.current?.id).toBe('a');
    expect(resolved.startedAt?.toISOString()).toBe(now.toISOString());
    expect(repo.playerState.current_item).toBe('a');
  });

  it('does not select a song queued on a different day', async () => {
    const yesterday = song({ id: 'old', day: '2026-08-15' });
    const repo = new FakeRepo([yesterday]);

    const resolved = await resolveState(repo, at('2026-08-16T09:00:00Z'), DAY);

    // Songs still pending at midnight are simply never selected again.
    expect(resolved.current).toBeNull();
  });
});

describe('Case B — still playing', () => {
  it('returns the current song and changes nothing', async () => {
    const playing = song({ id: 'a', duration_sec: 200 });
    const repo = new FakeRepo([playing, song({ id: 'b' })]);
    repo.playerState = { current_item: 'a', started_at: '2026-08-16T09:00:00.000Z' };

    const resolved = await resolveState(repo, at('2026-08-16T09:02:00Z'), DAY);

    expect(resolved.current?.id).toBe('a');
    expect(repo.setCurrentCalls).toBe(0);
    expect(repo.pickNextCalls).toBe(0);
  });

  it('treats the final second as still playing, not finished', async () => {
    const playing = song({ id: 'a', duration_sec: 200 });
    const repo = new FakeRepo([playing, song({ id: 'b' })]);
    repo.playerState = { current_item: 'a', started_at: '2026-08-16T09:00:00.000Z' };

    // elapsed 199.9s of a 200s song
    const resolved = await resolveState(repo, at('2026-08-16T09:03:19.900Z'), DAY);

    expect(resolved.current?.id).toBe('a');
    expect(repo.setCurrentCalls).toBe(0);
  });
});

describe('Case C — the song finished', () => {
  it('accumulates: the next song starts at started_at + duration, NOT now()', async () => {
    const finished = song({ id: 'a', duration_sec: 200 });
    const next = song({ id: 'b', added_by: 'user-a', created_at: '2026-08-16T00:00:02.000Z' });
    const repo = new FakeRepo([finished, next]);
    repo.playerState = { current_item: 'a', started_at: '2026-08-16T09:00:00.000Z' };

    // The poll arrives 2.5s late, as polls do.
    const resolved = await resolveState(repo, at('2026-08-16T09:03:22.500Z'), DAY);

    expect(resolved.current?.id).toBe('b');
    // Exactly 09:00:00 + 200s. Using now() here would add the poll delay to every
    // transition and compound: twenty songs later the station is a minute adrift.
    expect(resolved.startedAt?.toISOString()).toBe('2026-08-16T09:03:20.000Z');
  });

  it('marks the finished song played', async () => {
    const finished = song({ id: 'a', duration_sec: 200 });
    const repo = new FakeRepo([finished, song({ id: 'b' })]);
    repo.playerState = { current_item: 'a', started_at: '2026-08-16T09:00:00.000Z' };

    await resolveState(repo, at('2026-08-16T09:03:21Z'), DAY);

    expect(finished.status).toBe('played');
  });

  it('never overwrites a skipped song with played', async () => {
    const skipped = song({ id: 'a', duration_sec: 200, status: 'skipped' });
    const repo = new FakeRepo([skipped, song({ id: 'b' })]);
    repo.playerState = { current_item: 'a', started_at: '2026-08-16T09:00:00.000Z' };

    await resolveState(repo, at('2026-08-16T09:03:21Z'), DAY);

    expect(skipped.status).toBe('skipped');
  });

  it('goes silent when nothing is left to play', async () => {
    const finished = song({ id: 'a', duration_sec: 200 });
    const repo = new FakeRepo([finished]);
    repo.playerState = { current_item: 'a', started_at: '2026-08-16T09:00:00.000Z' };

    const resolved = await resolveState(repo, at('2026-08-16T09:03:21Z'), DAY);

    expect(resolved.current).toBeNull();
    expect(repo.playerState).toEqual({ current_item: null, started_at: null });
  });
});

describe('the overshoot rule', () => {
  it('chains when the overshoot is under 30 seconds', async () => {
    const finished = song({ id: 'a', duration_sec: 200 });
    const next = song({ id: 'b', added_by: 'user-a', created_at: '2026-08-16T00:00:02.000Z' });
    const repo = new FakeRepo([finished, next]);
    repo.playerState = { current_item: 'a', started_at: '2026-08-16T09:00:00.000Z' };

    // 29s overshoot — a late poll, not an empty room.
    const resolved = await resolveState(repo, at('2026-08-16T09:03:49Z'), DAY);

    expect(resolved.startedAt?.toISOString()).toBe('2026-08-16T09:03:20.000Z');
  });

  it('cold-starts when the overshoot is over 30 seconds', async () => {
    const finished = song({ id: 'a', duration_sec: 200 });
    const next = song({ id: 'b', added_by: 'user-a', created_at: '2026-08-16T00:00:02.000Z' });
    const repo = new FakeRepo([finished, next]);
    repo.playerState = { current_item: 'a', started_at: '2026-08-16T09:00:00.000Z' };

    const now = at('2026-08-16T09:04:00Z'); // 40s overshoot
    const resolved = await resolveState(repo, now, DAY);

    expect(resolved.startedAt?.toISOString()).toBe(now.toISOString());
  });

  it('loses exactly one song to a one-hour lunch break, not the whole queue', async () => {
    // The bug this rule exists to prevent: without it, the server computes that fifteen
    // songs "played" to an empty room and silently burns the entire queue.
    const playing = song({ id: 'a', duration_sec: 200, added_by: 'user-a' });
    const rest = Array.from({ length: 15 }, (_, index) =>
      song({
        id: `q${index}`,
        added_by: 'user-a',
        duration_sec: 200,
        created_at: `2026-08-16T00:01:${String(index).padStart(2, '0')}.000Z`,
      }),
    );
    const repo = new FakeRepo([playing, ...rest]);
    repo.playerState = { current_item: 'a', started_at: '2026-08-16T09:00:00.000Z' };

    // Everyone leaves for lunch. One poll when they return, an hour later.
    const resolved = await resolveState(repo, at('2026-08-16T10:00:00Z'), DAY);

    expect(resolved.current?.id).toBe('q0');
    const stillPending = repo.queue.filter((item) => item.status === 'pending');
    // Only the song that was playing is gone; all fifteen survive.
    expect(stillPending).toHaveLength(15);
  });

  it('exposes the threshold as a constant so the rule is not a magic number', () => {
    expect(OVERSHOOT_COLD_START_SEC).toBe(30);
  });
});

describe('advance at most one song per call', () => {
  it('steps once even when several songs are already overdue', async () => {
    // Three 60s songs and a 5-minute-old start: a looping implementation would burn all
    // of them in this single call.
    const playing = song({ id: 'a', duration_sec: 60, added_by: 'user-a' });
    const second = song({
      id: 'b',
      duration_sec: 60,
      added_by: 'user-a',
      created_at: '2026-08-16T00:01:00.000Z',
    });
    const third = song({
      id: 'c',
      duration_sec: 60,
      added_by: 'user-a',
      created_at: '2026-08-16T00:02:00.000Z',
    });
    const repo = new FakeRepo([playing, second, third]);
    repo.playerState = { current_item: 'a', started_at: '2026-08-16T09:00:00.000Z' };

    await resolveState(repo, at('2026-08-16T09:05:00Z'), DAY);

    expect(repo.setCurrentCalls).toBe(1);
    expect(repo.markPlayedCalls).toEqual(['a']);
    expect(repo.queue.filter((item) => item.status === 'played')).toHaveLength(1);
  });
});

describe('concurrency', () => {
  it('reports the winner’s state instead of retrying when it loses the race', async () => {
    const finished = song({ id: 'a', duration_sec: 200 });
    const mine = song({ id: 'b', added_by: 'user-a', created_at: '2026-08-16T00:00:02.000Z' });
    const theirs = song({ id: 'c', added_by: 'user-b', created_at: '2026-08-16T00:00:03.000Z' });
    const repo = new FakeRepo([finished, mine, theirs]);
    repo.playerState = { current_item: 'a', started_at: '2026-08-16T09:00:00.000Z' };

    // Another poller advanced to 'c' a moment ago.
    repo.loseNextRace = { current_item: 'c', started_at: '2026-08-16T09:03:20.000Z' };

    const resolved = await resolveState(repo, at('2026-08-16T09:03:21Z'), DAY);

    expect(resolved.current?.id).toBe('c');
    expect(resolved.startedAt?.toISOString()).toBe('2026-08-16T09:03:20.000Z');
    // One attempt, then accept the outcome. Retrying is how a queue gets burned.
    expect(repo.setCurrentCalls).toBe(1);
  });

  it('does not cold-start over a song another poller just started', async () => {
    const waiting = song({ id: 'a' });
    const repo = new FakeRepo([waiting]);
    repo.playerState = { current_item: null, started_at: null };
    repo.loseNextRace = { current_item: 'a', started_at: '2026-08-16T09:00:00.000Z' };

    const resolved = await resolveState(repo, at('2026-08-16T09:00:02Z'), DAY);

    expect(resolved.current?.id).toBe('a');
    expect(resolved.startedAt?.toISOString()).toBe('2026-08-16T09:00:00.000Z');
  });
});

describe('the midnight boundary', () => {
  it('lets a song that started before midnight finish after it', async () => {
    // 23:58 Ulaanbaatar = 15:58Z. A 5-minute song runs past midnight into the new day.
    const crossing = song({ id: 'late', duration_sec: 300, day: '2026-08-15' });
    const repo = new FakeRepo([crossing]);
    repo.playerState = { current_item: 'late', started_at: '2026-08-15T15:58:00.000Z' };

    // Two minutes later it is already tomorrow in the office.
    const resolved = await resolveState(repo, at('2026-08-15T16:00:00Z'), '2026-08-16');

    // The current item is resolved by id with no day filter, so it keeps playing.
    expect(resolved.current?.id).toBe('late');
    expect(repo.setCurrentCalls).toBe(0);
  });

  it('does not pick yesterday’s leftovers once that song ends', async () => {
    const crossing = song({ id: 'late', duration_sec: 300, day: '2026-08-15' });
    const leftover = song({ id: 'stale', day: '2026-08-15' });
    const repo = new FakeRepo([crossing, leftover]);
    repo.playerState = { current_item: 'late', started_at: '2026-08-15T15:58:00.000Z' };

    const resolved = await resolveState(repo, at('2026-08-15T16:03:01Z'), '2026-08-16');

    // A fresh station every morning.
    expect(resolved.current).toBeNull();
    expect(leftover.status).toBe('pending');
  });
});

describe('damaged state', () => {
  it('clears a current_item whose row has vanished', async () => {
    const repo = new FakeRepo([]);
    repo.playerState = { current_item: 'ghost', started_at: '2026-08-16T09:00:00.000Z' };

    const resolved = await resolveState(repo, at('2026-08-16T09:00:01Z'), DAY);

    expect(resolved.current).toBeNull();
    expect(repo.playerState.current_item).toBeNull();
  });

  it('clears a current_item that has no start time', async () => {
    const repo = new FakeRepo([song({ id: 'a' })]);
    repo.playerState = { current_item: 'a', started_at: null };

    const resolved = await resolveState(repo, at('2026-08-16T09:00:01Z'), DAY);

    expect(resolved.current).toBeNull();
    expect(repo.playerState.current_item).toBeNull();
  });
});
