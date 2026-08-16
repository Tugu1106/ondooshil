'use client';

import { useEffect, useState } from 'react';

import type { NowPlaying as NowPlayingData } from '@/lib/types';

import { formatDuration } from './UpNext';
import styles from './Player.module.css';
import RevealButton from './RevealButton';

/**
 * The now-playing display (spec §12): title, progress, and the adder's name only when the
 * viewer is entitled to it — the server already decided that, so `addedByName` is simply
 * shown or not.
 *
 * The progress bar ticks locally once a second off the server clock. It is a readout, not
 * a control: there is no seek bar, because there is no global seek.
 */

type Props = {
  playing: NowPlayingData | null;
  positionAt: (playing: NowPlayingData) => number;
  onSkip: (playing: NowPlayingData) => void;
  onReveal: (playing: NowPlayingData) => void;
  revealsRemaining: number;
  busy: boolean;
  children: React.ReactNode;
};

export default function NowPlaying({
  playing,
  positionAt,
  onSkip,
  onReveal,
  revealsRemaining,
  busy,
  children,
}: Props) {
  const [, tick] = useState(0);

  // Re-render once a second so the bar advances. Cheap, and unrelated to the 3s poll.
  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 1_000);
    return () => clearInterval(timer);
  }, []);

  const position = playing ? positionAt(playing) : 0;
  const percent = playing ? Math.min(100, (position / playing.durationSec) * 100) : 0;

  return (
    <div className={styles.card}>
      <h2 className={styles.sectionTitle}>Now playing</h2>

      <div className={styles.layout}>
        <div className={styles.details}>
          {playing ? (
            <>
              <p className={styles.title}>{playing.title}</p>
              <p className={styles.by}>
                {playing.addedByName ?? 'anonymous'}
                {playing.addedByName === null && (
                  <>
                    {' '}
                    <RevealButton
                      remaining={revealsRemaining}
                      busy={busy}
                      onReveal={() => onReveal(playing)}
                    />
                  </>
                )}
              </p>
              <div className={styles.progress}>
                <div className={styles.bar} style={{ width: `${percent}%` }} />
              </div>
              <div className={styles.times}>
                <span>{formatDuration(Math.floor(position))}</span>
                <span>{formatDuration(playing.durationSec)}</span>
              </div>
              {/*
                Shown only to the adder. There is no vote-skip and no override: everyone
                else waits it out, exactly as they would with a radio.
              */}
              {playing.canSkip && (
                <button className={styles.skip} disabled={busy} onClick={() => onSkip(playing)}>
                  Skip my song
                </button>
              )}
            </>
          ) : (
            // Silence is the correct empty state. No filler, no fallback playlist.
            <p className={styles.silent}>Off air — the queue is empty.</p>
          )}
        </div>

        {/* The player mounts here and stays mounted, playing or not. */}
        {children}
      </div>
    </div>
  );
}
