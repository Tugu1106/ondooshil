'use client';

import { useCallback, useEffect, useState } from 'react';

import type { Sky } from '@/lib/types';

/**
 * Keeps the sky current.
 *
 * Server-seeded then polled, mirroring `useStation` — the first paint is already the right
 * weather, with no flash of a default. The interval is slow on purpose: `/api/state` is
 * the hot path at one request per listener every three seconds, and the weather is not.
 */

/** Weather does not move quickly, and neither should this. */
const REFRESH_MS = 15 * 60 * 1000;

export function useSky(initial: Sky): Sky {
  const [sky, setSky] = useState(initial);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/weather');
      if (response.ok) setSky((await response.json()) as Sky);
    } catch {
      // Keep the sky we have. It is a background.
    }
  }, []);

  useEffect(() => {
    const timer = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  // A tab left open overnight would otherwise still be showing yesterday afternoon.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refresh]);

  return sky;
}
