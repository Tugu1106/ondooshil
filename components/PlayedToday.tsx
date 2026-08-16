'use client';

import type { QueueRow } from '@/lib/types';

import styles from './Station.module.css';
import { formatDuration } from './UpNext';

/**
 * Today's history, so people who were away can see what they missed (spec §12).
 *
 * Skipped and failed songs are struck through but carry **no attribution for the skip**.
 * Only the adder can skip their own song, so "skipped by Bat" would give away that Bat
 * queued the anonymous track — for free, bypassing the whole reveal system (spec §8).
 */

type Props = {
  rows: QueueRow[];
};

function statusNote(row: QueueRow): string | null {
  switch (row.status) {
    case 'skipped':
      return 'skipped';
    case 'failed':
      return "couldn't play";
    default:
      return null;
  }
}

export default function PlayedToday({ rows }: Props) {
  return (
    <div className={styles.card}>
      <h2 className={styles.sectionTitle}>Played today</h2>

      {rows.length === 0 ? (
        <p className={styles.empty}>Nothing yet today.</p>
      ) : (
        rows.map((row) => {
          const note = statusNote(row);
          const who = row.isMine ? 'you' : row.addedByName;
          const meta = [who, note].filter(Boolean).join(' · ');

          return (
            <div key={row.id} className={styles.row}>
              <span className={styles.main}>
                <span className={`${styles.title} ${note ? styles.struck : ''}`}>{row.title}</span>
                {meta && (
                  <span className={`${styles.meta} ${row.isMine ? styles.mine : ''}`}>{meta}</span>
                )}
              </span>
              <span className={styles.duration}>{formatDuration(row.durationSec)}</span>
            </div>
          );
        })
      )}
    </div>
  );
}
