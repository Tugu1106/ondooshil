'use client';

import { useSky } from '@/lib/client/useSky';
import type { Sky as SkyData } from '@/lib/types';

import styles from './Sky.module.css';

/**
 * The background: what it is actually doing outside the office window, right now.
 *
 * The room shares one speaker, one queue and one playhead — and one window. So the page
 * shares the weather too. It is the same trick as the station itself: something everyone
 * present can see at once, that nobody has to operate.
 *
 * The sky is drawn in layers, back to front: the base gradient (set by where the sun is),
 * the sun or moon on its arc, cloud cover, the iridescent film, prismatic banding,
 * whatever is falling, and finally a veil that holds the panels readable.
 *
 * **Hue alone is not enough.** An early version only re-tinted the film per condition, and
 * a clear day was unrecognisable as one — there was no sun in the sky. Weather has to be
 * depicted, not merely suggested, or nobody reads it as weather.
 *
 * Everything animated is a transform or an opacity on a handful of large layers, so it
 * stays on the compositor. This page already runs a YouTube iframe and polls every three
 * seconds; the background is not allowed to be the expensive part.
 */

type Props = {
  /** Server-rendered, so the first paint is already the right sky — no flash of default. */
  initial: SkyData;
};

export default function Sky({ initial }: Props) {
  const sky = useSky(initial);

  /*
   * The sun's arc. `sunProgress` is computed server-side precisely so this needs no clock
   * of its own — the same reason the playhead reads `serverTime` rather than `Date.now()`.
   * Null means the sun is down, and the moon takes a fixed high seat instead.
   */
  const up = sky.sunProgress !== null;
  const progress = sky.sunProgress ?? 0.5;
  const left = 8 + progress * 84;
  const top = 72 - Math.sin(progress * Math.PI) * 56;

  const falling =
    sky.condition === 'rain' || sky.condition === 'storm'
      ? styles.rain
      : sky.condition === 'snow'
        ? styles.snow
        : null;

  return (
    <div className={styles.sky} data-phase={sky.phase} data-condition={sky.condition} aria-hidden>
      {/* The sun on its arc, or the moon once it is down. Dimmed by cloud, not hidden. */}
      <div
        className={up ? styles.sun : styles.moon}
        style={up ? { left: `${left}%`, top: `${top}%` } : undefined}
      />

      {/* Cloud cover. Opacity is set per condition, so clear leaves it invisible. */}
      <div className={`${styles.cloud} ${styles.cloudA}`} />
      <div className={`${styles.cloud} ${styles.cloudB}`} />
      <div className={`${styles.cloud} ${styles.cloudC}`} />

      {/* The film. Three slow, large, overlapping washes — the iridescence lives here. */}
      <div className={`${styles.wash} ${styles.washA}`} />
      <div className={`${styles.wash} ${styles.washB}`} />
      <div className={`${styles.wash} ${styles.washC}`} />

      {/* Thin prismatic banding, which is what separates iridescence from a soft gradient. */}
      <div className={styles.prism} />

      {falling && <div className={falling} />}

      {/* Holds the panels readable no matter how bright the sky gets. */}
      <div className={styles.veil} />
    </div>
  );
}
