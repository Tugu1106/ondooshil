'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import type { StateResponse } from '@/lib/types';

/**
 * Polls `/api/state` every 3 seconds and owns the server clock offset.
 *
 * Six clients at one request every three seconds is roughly two requests a second — far
 * below anything worth optimising, and it avoids an entire class of subscription
 * lifecycle bugs that Realtime would introduce.
 *
 * The first payload is rendered on the server and handed in as `initialState`, so there
 * is no empty flash and no fetch on mount.
 *
 * Phase 5 adds a `setTimeout` scheduled exactly at each transition, after which this 3s
 * poll stops being the primary mechanism and becomes the safety net for *unpredictable*
 * changes: skips, removals, and songs added after a silence.
 */

export const POLL_INTERVAL_MS = 3_000;

export type Station = {
  state: StateResponse;
  error: string | null;
  refresh: () => Promise<void>;
  /**
   * The server's clock, as best this browser can tell. **Never use `Date.now()` directly
   * for playhead maths** — a laptop 40 seconds out produces a bug that looks completely
   * inexplicable.
   */
  serverNow: () => number;
};

export function useStation(initialState: StateResponse): Station {
  const [state, setState] = useState<StateResponse>(initialState);
  const [error, setError] = useState<string | null>(null);

  const alive = useRef(true);

  /**
   * `serverTime - clientTime`, computed once and then frozen (spec §7).
   *
   * Seeded on mount from the server-rendered payload — accurate to however long hydration
   * took — then replaced once by the first live fetch, where the only error is half a
   * request round trip. After that it never moves, so the playhead cannot wander because
   * of a re-render.
   *
   * Both writes happen in effects, never during render: React treats render as pure, and
   * `Date.now()` is not. Until the mount effect runs, `serverNow()` falls back to the raw
   * client clock — which only affects the very first painted frame of the progress bar,
   * since nothing loads a video before the Listen click.
   */
  const offset = useRef<number | null>(null);
  const offsetFromFetch = useRef(false);

  const seedServerTime = initialState.serverTime;
  useEffect(() => {
    if (offset.current === null) {
      offset.current = new Date(seedServerTime).getTime() - Date.now();
    }
  }, [seedServerTime]);

  const serverNow = useCallback(() => Date.now() + (offset.current ?? 0), []);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/state', { cache: 'no-store' });
      if (!alive.current) return;

      if (!response.ok) {
        setError('Lost touch with the station.');
        return;
      }

      const next = (await response.json()) as StateResponse;

      if (!offsetFromFetch.current) {
        offset.current = new Date(next.serverTime).getTime() - Date.now();
        offsetFromFetch.current = true;
      }

      setState(next);
      setError(null);
    } catch {
      if (alive.current) setError('Lost touch with the station.');
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    const timer = setInterval(() => void refresh(), POLL_INTERVAL_MS);

    return () => {
      alive.current = false;
      clearInterval(timer);
    };
  }, [refresh]);

  /**
   * Fetch at the exact moment the current song ends, rather than waiting for the next
   * poll (spec §7). Re-armed whenever the broadcast changes — including on a skip, which
   * is why the effect keys off the queue item id and not the position.
   *
   * With this in place the 3s poll above exists only to catch *unpredictable* changes:
   * skips, removals, and songs added after a period of silence.
   */
  const playingId = state.playing?.queueItemId ?? null;
  const playingStartedAt = state.playing?.startedAt ?? null;
  const playingDuration = state.playing?.durationSec ?? null;

  useEffect(() => {
    if (playingId === null || playingStartedAt === null || playingDuration === null) return;

    const delay = transitionDelayMs(
      positionSec(playingStartedAt, playingDuration, serverNow()),
      playingDuration,
    );

    const timer = setTimeout(() => void refresh(), delay);
    return () => clearTimeout(timer);
  }, [playingId, playingStartedAt, playingDuration, refresh, serverNow]);

  return { state, error, refresh, serverNow };
}

/** Seconds into the current song, from the server clock. Clamped to the song's length. */
export function positionSec(startedAt: string, durationSec: number, serverNowMs: number): number {
  const elapsed = (serverNowMs - new Date(startedAt).getTime()) / 1000;
  return Math.min(Math.max(elapsed, 0), durationSec);
}

/**
 * Past this much disagreement between the player and the timeline, seek (spec §7).
 *
 * Under it, do nothing: a seek is audibly jarring, and being a second out matters not at
 * all when only one machine in the room is unmuted.
 */
export const DRIFT_TOLERANCE_SEC = 2;

/** How often to compare the player against the timeline. */
export const DRIFT_CHECK_INTERVAL_MS = 30_000;

/**
 * A hair past the song's end, so the server sees `elapsed >= duration` and advances.
 * Firing exactly on the boundary risks landing a rounding error short and doing nothing.
 */
const TRANSITION_MARGIN_MS = 250;

export function shouldSeek(actualSec: number, expectedSec: number): boolean {
  return Math.abs(actualSec - expectedSec) > DRIFT_TOLERANCE_SEC;
}

/**
 * How long until the current song ends.
 *
 * The client already knows the start time and the duration, so it knows exactly when the
 * next transition happens — waiting for the 3-second poll to notice would make every
 * transition up to three seconds late.
 */
export function transitionDelayMs(positionSecs: number, durationSec: number): number {
  return Math.max(0, (durationSec - positionSecs) * 1000) + TRANSITION_MARGIN_MS;
}
