'use client';

import styles from './Player.module.css';

/**
 * The only playback control there is (spec §7).
 *
 * You cannot pause a radio. The player is already running — from page load, through every
 * transition — and this does not start or stop it. It only decides whether *this*
 * machine's speaker is audible, which is why turning it on is instant rather than a fresh
 * buffer. Nothing here touches the server, and nothing here affects anyone else.
 *
 * The page opens muted because muted autoplay is the one kind browsers permit without a
 * user gesture. Unmuting *is* that gesture, so this button is what makes sound legal.
 */

type Props = {
  muted: boolean;
  volume: number;
  onMutedChange: (muted: boolean) => void;
  onVolumeChange: (volume: number) => void;
};

export default function SpeakerToggle({ muted, volume, onMutedChange, onVolumeChange }: Props) {
  return (
    <div className={styles.controls}>
      <button
        className={muted ? styles.listen : styles.stop}
        onClick={() => onMutedChange(!muted)}
        aria-pressed={!muted}
      >
        {muted ? '🔇 Speaker off' : '🔊 Speaker on'}
      </button>

      {!muted && (
        <label className={styles.volume}>
          <span className={styles.srOnly}>Volume</span>
          <input
            type="range"
            min={0}
            max={100}
            value={volume}
            onChange={(event) => onVolumeChange(Number(event.target.value))}
          />
        </label>
      )}

      {!muted && <p className={styles.hint}>This machine is the room speaker.</p>}
    </div>
  );
}
