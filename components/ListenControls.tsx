'use client';

import styles from './Player.module.css';

/**
 * The 🔊 Listen gesture and the local controls (spec §7).
 *
 * The page opens **not listening**. Browsers block audio without a user gesture, so this
 * click is what starts playback — but it earns its place twice over: six browsers
 * streaming YouTube is six times the bandwidth for audio only one speaker outputs, which
 * is noticeable on shared office internet. Defaulting to watching the queue rather than
 * streaming it means only one or two people ever turn audio on.
 *
 * Everything here is local. Mute and volume never touch the server and never affect
 * anyone else. There is no global pause, play, or seek — you cannot pause a radio, you
 * can only mute your own speaker.
 */

type Props = {
  listening: boolean;
  muted: boolean;
  volume: number;
  onListeningChange: (listening: boolean) => void;
  onMutedChange: (muted: boolean) => void;
  onVolumeChange: (volume: number) => void;
};

export default function ListenControls({
  listening,
  muted,
  volume,
  onListeningChange,
  onMutedChange,
  onVolumeChange,
}: Props) {
  if (!listening) {
    return (
      <div className={styles.controls}>
        <button className={styles.listen} onClick={() => onListeningChange(true)}>
          🔊 Listen
        </button>
        <p className={styles.hint}>
          One machine in the room plays out loud. The rest just watch the queue.
        </p>
      </div>
    );
  }

  return (
    <div className={styles.controls}>
      <button className={styles.stop} onClick={() => onListeningChange(false)}>
        Stop listening
      </button>

      <button
        className={styles.stop}
        onClick={() => onMutedChange(!muted)}
        aria-pressed={muted}
      >
        {muted ? '🔇 Muted' : '🔊 Sound on'}
      </button>

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

      <p className={styles.hint}>Only your speaker. Nobody else hears this change.</p>
    </div>
  );
}
