'use client';

import { useCallback, useEffect, useState } from 'react';

import type { Sky as SkyData } from '@/lib/types';

import styles from './Sky.module.css';

/**
 * The background: what it is actually doing outside the office window, right now.
 *
 * The room shares one speaker, one queue and one playhead — and one window. So the page
 * shares the weather too. It is the same trick as the station itself: something everyone
 * present can see at once, that nobody has to operate.
 *
 * Two axes decide the palette, and they compose rather than multiply:
 *
 * - **`phase`** (night / dawn / day / dusk) sets the sky it is painted on. This matters
 *   more than the weather — an overcast noon and an overcast midnight share a forecast and
 *   nothing else.
 * - **`condition`** tints the drifting film over it and decides whether anything falls.
 *
 * Everything is a transform or an opacity on a handful of large layers, so it stays on the
 * compositor. This page already runs a YouTube iframe and polls every three seconds; the
 * background is not allowed to be the expensive part.
 */

/** Weather does not move quickly, and neither should this. */
const REFRESH_MS = 15 * 60 * 1000;

type Props = {
  /** Server-rendered, so the first paint is already the right sky — no flash of default. */
  initial: SkyData;
};

export default function Sky({ initial }: Props) {
  const [sky, setSky] = useState(initial);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/weather');
      if (response.ok) setSky((await response.json()) as SkyData);
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

  const falls = sky.condition === 'rain' || sky.condition === 'storm' ? 'rain' : null;
  const snows = sky.condition === 'snow' ? 'snow' : null;

  return (
    <div
      className={styles.sky}
      data-phase={sky.phase}
      data-condition={sky.condition}
      aria-hidden
    >
      {/* The film. Three slow, large, overlapping washes — the iridescence lives here. */}
      <div className={`${styles.wash} ${styles.washA}`} />
      <div className={`${styles.wash} ${styles.washB}`} />
      <div className={`${styles.wash} ${styles.washC}`} />

      {/* Thin prismatic banding, which is what separates iridescence from a soft gradient. */}
      <div className={styles.prism} />

      {(falls || snows) && <div className={falls ? styles.rain : styles.snow} />}

      {/* Holds the panels readable no matter how bright the sky gets. */}
      <div className={styles.veil} />
    </div>
  );
}
