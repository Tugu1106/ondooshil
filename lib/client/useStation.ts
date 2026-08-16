'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import type { StateResponse } from '@/lib/types';

/**
 * Polls `/api/state` every 3 seconds.
 *
 * Six clients at one request every three seconds is roughly two requests a second — far
 * below anything worth optimising, and it avoids an entire class of subscription
 * lifecycle bugs that Realtime would introduce.
 *
 * The first payload is rendered on the server and handed in as `initialState`, so there
 * is no empty flash and no fetch on mount.
 *
 * Phase 2 scope is the poll alone. Phase 4 adds the server clock offset, and Phase 5 adds
 * a `setTimeout` scheduled exactly at each transition — at which point this 3s poll stops
 * being the primary mechanism and becomes the safety net that catches only
 * *unpredictable* changes: skips, removals, and songs added after a silence.
 */

export const POLL_INTERVAL_MS = 3_000;

export type Station = {
  state: StateResponse;
  error: string | null;
  /** Fetch immediately — call after any mutation instead of waiting for the next tick. */
  refresh: () => Promise<void>;
};

export function useStation(initialState: StateResponse): Station {
  const [state, setState] = useState<StateResponse>(initialState);
  const [error, setError] = useState<string | null>(null);

  // Survives re-renders so a response arriving after unmount is dropped.
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/state', { cache: 'no-store' });
      if (!alive.current) return;

      if (!response.ok) {
        setError('Lost touch with the station.');
        return;
      }

      setState((await response.json()) as StateResponse);
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

  return { state, error, refresh };
}
