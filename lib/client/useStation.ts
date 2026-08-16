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

  return { state, error, refresh, serverNow };
}

/** Seconds into the current song, from the server clock. Clamped to the song's length. */
export function positionSec(startedAt: string, durationSec: number, serverNowMs: number): number {
  const elapsed = (serverNowMs - new Date(startedAt).getTime()) / 1000;
  return Math.min(Math.max(elapsed, 0), durationSec);
}
