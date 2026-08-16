'use client';

import type { QueueRow } from '@/lib/types';

import RevealButton from './RevealButton';
import styles from './Station.module.css';

/**
 * The pending queue, in round-robin order (spec §6).
 *
 * The order is deterministic, so rows never reshuffle under someone who is reading the
 * list. Remove buttons on your own rows arrive in Phase 6.
 */

export function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** Anonymous rows say nothing at all — no placeholder that could hint at a person. */
function attribution(row: QueueRow): string | null {
  if (row.isMine) return 'you';
  return row.addedByName;
}

type Props = {
  rows: QueueRow[];
  onRemove: (row: QueueRow) => void;
  onReveal: (row: QueueRow) => void;
  revealsRemaining: number;
  busy: boolean;
};

export default function UpNext({ rows, onRemove, onReveal, revealsRemaining, busy }: Props) {
  return (
    <div className={styles.card}>
      <h2 className={styles.sectionTitle}>Up next</h2>

      {rows.length === 0 ? (
        <p className={styles.empty}>Nothing queued. Paste a link above.</p>
      ) : (
        rows.map((row, index) => {
          const who = attribution(row);
          return (
            <div key={row.id} className={styles.row}>
              <span className={styles.position}>{index + 1}</span>
              <span className={styles.main}>
                <span className={styles.title}>{row.title}</span>
                {who && (
                  <span className={`${styles.meta} ${row.isMine ? styles.mine : ''}`}>{who}</span>
                )}
              </span>
              {/* Only where the adder is hidden from this viewer. */}
              {row.addedByName === null && (
                <RevealButton
                  remaining={revealsRemaining}
                  busy={busy}
                  onReveal={() => onReveal(row)}
                />
              )}
              <span className={styles.duration}>{formatDuration(row.durationSec)}</span>
              {/* Only ever on your own rows. The server enforces it regardless. */}
              {row.canRemove && (
                <button
                  className={styles.remove}
                  disabled={busy}
                  onClick={() => onRemove(row)}
                  aria-label={`Remove ${row.title}`}
                  title="Remove"
                >
                  ×
                </button>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
