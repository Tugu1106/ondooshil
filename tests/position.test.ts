import { describe, expect, it } from 'vitest';

import { positionSec } from '@/lib/client/useStation';

/**
 * Playhead maths (spec §7).
 *
 * The input is always the *server* clock — `clientNow + offset` — never the browser's own
 * `Date.now()`. A laptop 40 seconds adrift is the bug this arrangement exists to prevent,
 * and the last test is the one that proves the offset actually does its job.
 */

const STARTED = '2026-08-16T09:00:00.000Z';
const ms = (iso: string) => new Date(iso).getTime();

describe('positionSec', () => {
  it('is zero at the moment a song starts', () => {
    expect(positionSec(STARTED, 200, ms(STARTED))).toBe(0);
  });

  it('tracks elapsed time', () => {
    expect(positionSec(STARTED, 200, ms('2026-08-16T09:01:30.000Z'))).toBe(90);
  });

  it('puts a listener joining mid-song at the live position, not the start', () => {
    // Tuning in mid-song is normal. Waiting for the next track would make the app look
    // broken on open.
    expect(positionSec(STARTED, 200, ms('2026-08-16T09:02:44.000Z'))).toBe(164);
  });

  it('never exceeds the song length', () => {
    expect(positionSec(STARTED, 200, ms('2026-08-16T09:10:00.000Z'))).toBe(200);
  });

  it('never goes negative if the start time is slightly in the future', () => {
    // Possible right after a transition, when the accumulated start is a moment ahead.
    expect(positionSec(STARTED, 200, ms('2026-08-15T08:59:59.000Z'))).toBe(0);
  });

  it('keeps sub-second precision', () => {
    expect(positionSec(STARTED, 200, ms('2026-08-16T09:00:01.500Z'))).toBe(1.5);
  });

  it('a 40-second clock skew is cancelled by the offset', () => {
    // The machine's clock reads 40s ahead of the world.
    const skewMs = 40_000;
    const trueNow = ms('2026-08-16T09:01:00.000Z');
    const clientClock = trueNow + skewMs;

    // offset = serverTime - clientTime, captured once from /api/state.
    const offset = trueNow - clientClock;
    const serverNow = clientClock + offset;

    expect(positionSec(STARTED, 200, serverNow)).toBe(60);
    // Using the raw client clock instead would put this listener 40 seconds ahead of the room.
    expect(positionSec(STARTED, 200, clientClock)).toBe(100);
  });
});
