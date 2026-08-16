import { describe, expect, it } from 'vitest';

import {
  DRIFT_CHECK_INTERVAL_MS,
  DRIFT_TOLERANCE_SEC,
  shouldSeek,
  transitionDelayMs,
} from '@/lib/client/useStation';

/**
 * Sync decisions (spec §7): when to seek, and when the next transition is due.
 *
 * True frame-accurate sync is not achievable — each browser runs an independent player,
 * so this is simulated sync via a shared clock. It only has to be close enough that the
 * now-playing display is right and handing the speaker to someone else feels continuous.
 */

describe('shouldSeek', () => {
  it('leaves a small disagreement alone', () => {
    // Seeking is audibly jarring and not worth it for a second.
    expect(shouldSeek(100, 101)).toBe(false);
    expect(shouldSeek(101, 100)).toBe(false);
    expect(shouldSeek(100, 100)).toBe(false);
  });

  it('does nothing at exactly the tolerance', () => {
    expect(shouldSeek(100, 100 + DRIFT_TOLERANCE_SEC)).toBe(false);
    expect(shouldSeek(100, 100 - DRIFT_TOLERANCE_SEC)).toBe(false);
  });

  it('corrects once past it, in either direction', () => {
    expect(shouldSeek(100, 105)).toBe(true);
    expect(shouldSeek(105, 100)).toBe(true);
  });

  it('checks every 30 seconds', () => {
    expect(DRIFT_CHECK_INTERVAL_MS).toBe(30_000);
    expect(DRIFT_TOLERANCE_SEC).toBe(2);
  });
});

describe('transitionDelayMs', () => {
  it('fires just after the song ends, not up to 3 seconds later', () => {
    // A listener 30s into a 200s song waits the remaining 170s, plus a hair so the server
    // sees elapsed >= duration and advances.
    const delay = transitionDelayMs(30, 200);
    expect(delay).toBeGreaterThan(170_000);
    expect(delay).toBeLessThan(170_500);
  });

  it('fires almost immediately for a song already at its end', () => {
    expect(transitionDelayMs(200, 200)).toBeLessThan(500);
  });

  it('never schedules into the past', () => {
    // Possible if a poll lands after the song should already have ended.
    expect(transitionDelayMs(260, 200)).toBeGreaterThanOrEqual(0);
  });

  it('waits the whole song for someone arriving at a cold start', () => {
    const delay = transitionDelayMs(0, 19);
    expect(delay).toBeGreaterThan(19_000);
    expect(delay).toBeLessThan(19_500);
  });
});
