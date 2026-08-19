'use client';

import { useEffect, useState } from 'react';

import type { NowPlaying as NowPlayingData } from '@/lib/types';

import { formatDuration } from './Queue';
import styles from './Player.module.css';
import RevealButton from './RevealButton';

/**
 * The on-air box (spec §12).
 *
 * **The screen is the point.** It runs the full width of the box with the track details
 * underneath, rather than sharing a row with them — this is the thing people look at, and
 * a column of text beside it was taking half the space to say what one line says.
 *
 * No heading, and no empty-state sentence. When nothing is on air the screen shows dead
 * air, which says it better than a label does, and the queue box below says the rest.
 *
 * `data-on-air` marks the block that renders **whether or not anything is playing** — the
 * player lives inside it, so making it conditional would unmount the iframe. The
 * verification suite asserts on that attribute rather than on wording, which can change.
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
  /** The player. Rendered unconditionally — see the note on `.onAir`. */
  player: React.ReactNode;
  /** Mute and volume, all local to this browser. */
  controls: React.ReactNode;
};

export default function NowPlaying({
  playing,
  positionAt,
  onSkip,
  onReveal,
  revealsRemaining,
  busy,
  player,
  controls,
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
    <div className={styles.onAir} data-on-air>
      {/* Mounted and visible whether or not anything is on air. */}
      {player}

      {playing && (
        <div className={styles.details}>
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
            Shown only to the adder. There is no vote-skip and no override: everyone else
            waits it out, exactly as they would with a radio.
          */}
          {playing.canSkip && (
            <button className={styles.skip} disabled={busy} onClick={() => onSkip(playing)}>
              Skip my song
            </button>
          )}
        </div>
      )}

      {controls}
    </div>
  );
}
