'use client';

import styles from './Player.module.css';

/**
 * The only playback control there is (spec §7).
 *
 * You cannot pause a radio. The broadcast runs whether or not anyone is listening, so
 * this does not start or stop it — it only decides whether *this* machine's speaker is
 * audible. Nothing here touches the server, and nothing here affects anyone else.
 *
 * The page opens muted, for two reasons that happen to agree:
 *
 * - Browsers refuse to autoplay audio without a user gesture. Unmuting *is* that gesture,
 *   so this button is what makes sound legal in the first place.
 * - While muted the tab streams nothing, so five silent laptops cost the office
 *   connection nothing and only the machine driving the speaker pulls video.
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

      <p className={styles.hint}>
        {muted
          ? 'The station is playing regardless. Turn this on for the room.'
          : 'This machine is the room speaker.'}
      </p>
    </div>
  );
}
