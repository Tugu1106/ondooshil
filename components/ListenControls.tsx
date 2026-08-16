'use client';

import styles from './Player.module.css';

/**
 * The 🔊 Listen gesture (spec §7).
 *
 * The page opens **not listening**. Browsers block audio without a user gesture, so this
 * click is what starts playback — but it earns its place twice over: six browsers
 * streaming YouTube is six times the bandwidth for audio only one speaker outputs, which
 * is noticeable on shared office internet. Defaulting to watching the queue rather than
 * streaming it means only one or two people ever turn audio on.
 *
 * This is a local control. It never touches the server and never affects anyone else.
 * There is no global pause — you cannot pause a radio, only mute your own speaker.
 */

type Props = {
  listening: boolean;
  onChange: (listening: boolean) => void;
};

export default function ListenControls({ listening, onChange }: Props) {
  return (
    <div className={styles.controls}>
      {listening ? (
        <>
          <button className={styles.stop} onClick={() => onChange(false)}>
            Stop listening
          </button>
          <p className={styles.hint}>This speaker is on. Everyone else can stay silent.</p>
        </>
      ) : (
        <>
          <button className={styles.listen} onClick={() => onChange(true)}>
            🔊 Listen
          </button>
          <p className={styles.hint}>
            One machine in the room plays out loud. The rest just watch the queue.
          </p>
        </>
      )}
    </div>
  );
}
