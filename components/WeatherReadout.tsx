'use client';

import { useSky } from '@/lib/client/useSky';
import type { Sky as SkyData } from '@/lib/types';

import styles from './WeatherReadout.module.css';

/**
 * The weather, in words.
 *
 * The background alone does not carry it. Someone looking at a blue wash has no way to
 * tell whether the app knows it is 20 degrees and clear outside or is simply blue — and a
 * background that *might* be decorative reads as decorative. Saying it plainly is what
 * turns the sky from a texture into a fact about Ulaanbaatar.
 *
 * Shares `useSky` with the background, so the words and the picture can never disagree.
 */

const ICONS: Record<SkyData['condition'], string> = {
  clear: '☀',
  cloudy: '⛅',
  overcast: '☁',
  fog: '≡',
  rain: '☂',
  snow: '❄',
  storm: '⚡',
};

/** Clear at midnight is not sunny. The icon should not claim otherwise. */
function iconFor(sky: SkyData): string {
  if (sky.phase === 'night' && (sky.condition === 'clear' || sky.condition === 'cloudy')) {
    return '☾';
  }
  return ICONS[sky.condition];
}

type Props = {
  initial: SkyData;
};

export default function WeatherReadout({ initial }: Props) {
  const sky = useSky(initial);

  return (
    <p className={styles.readout} data-live={sky.live}>
      <span className={styles.icon} aria-hidden>
        {iconFor(sky)}
      </span>

      {sky.temperature !== null && <span className={styles.temp}>{sky.temperature}°C</span>}

      <span className={styles.label}>{sky.label}</span>

      {/* Below a walking pace it is not worth the words. */}
      {sky.windKph !== null && sky.windKph >= 12 && (
        <span className={styles.wind}>wind {sky.windKph} km/h</span>
      )}

      <span className={styles.place}>Ulaanbaatar</span>
    </p>
  );
}
