'use client';

import { useCallback, useEffect, useRef } from 'react';

import type { QueueRow } from '@/lib/types';

import RevealButton from './RevealButton';
import styles from './Station.module.css';

/**
 * The queue — the whole day in one list (spec §12).
 *
 * Past songs, then the next one, then everything still to come. The list **rests with the
 * next song against the top edge**: that is the one position that matters, so it is the
 * one the list always returns to. The past is parked just above, reachable by scrolling
 * up; take the pointer away and it settles back on its own.
 *
 * A single list rather than a "played" section and an "up next" section, because it is a
 * single thing — a day of the station, read downward.
 */

/**
 * How long the list waits after the pointer leaves before settling back. Long enough that
 * a swipe or a wandering cursor does not fight the reader, short enough to feel deliberate.
 */
const SETTLE_MS = 400;

export function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** Skipped and failed carry **no attribution** — naming the skipper would leak authorship. */
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

/** Anonymous rows say nothing at all — no placeholder that could hint at a person. */
function attribution(row: QueueRow): string | null {
  if (row.isMine) return 'you';
  return row.addedByName;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

type Props = {
  /** Today's history, newest first, as the API returns it. */
  played: QueueRow[];
  /** Round-robin ordered, the first row being what plays next. */
  upNext: QueueRow[];
  onRemove: (row: QueueRow) => void;
  onReveal: (row: QueueRow) => void;
  revealsRemaining: number;
  busy: boolean;
};

export default function Queue({
  played,
  upNext,
  onRemove,
  onReveal,
  revealsRemaining,
  busy,
}: Props) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const insideRef = useRef(false);
  const settledOnce = useRef(false);

  // Oldest first, so the day reads downward: what has been, then what is coming.
  const rows = [...[...played].reverse(), ...upNext];

  // The next song, or — when nothing is queued — the last thing that played, so the list
  // still has somewhere to rest.
  const anchorIndex = upNext.length > 0 ? played.length : rows.length - 1;
  const anchorId = rows[anchorIndex]?.id ?? null;

  const settle = useCallback((smooth: boolean) => {
    const list = listRef.current;
    const anchor = anchorRef.current;
    if (!list || !anchor) return;

    // `offsetTop` is measured against the list, which is the positioned ancestor.
    list.scrollTo({
      top: anchor.offsetTop,
      behavior: smooth && !prefersReducedMotion() ? 'smooth' : 'auto',
    });
  }, []);

  /**
   * Re-settle whenever the anchor changes — the station advanced, or a song was added or
   * removed. Instant on the first pass so the list is never painted in the wrong place,
   * and skipped entirely while someone is in there reading.
   */
  useEffect(() => {
    const smooth = settledOnce.current;
    settledOnce.current = true;
    if (insideRef.current) return;
    settle(smooth);
  }, [anchorId, settle]);

  useEffect(() => {
    return () => {
      if (settleTimer.current) clearTimeout(settleTimer.current);
    };
  }, []);

  function handleEnter() {
    insideRef.current = true;
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = null;
  }

  function handleLeave() {
    insideRef.current = false;
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => settle(true), SETTLE_MS);
  }

  if (rows.length === 0) {
    return <p className={styles.empty}>Nothing today yet. Paste a link to start the station.</p>;
  }

  return (
    <div
      ref={listRef}
      className={styles.queue}
      onPointerEnter={handleEnter}
      onPointerLeave={handleLeave}
      aria-label="Queue"
    >
      {rows.map((row, index) => {
        const past = index < played.length;
        const note = statusNote(row);
        const who = attribution(row);
        const meta = [who, note].filter(Boolean).join(' · ');

        return (
          <div
            key={row.id}
            ref={index === anchorIndex ? anchorRef : null}
            className={`${styles.card} ${past ? styles.past : ''}`}
          >
            <span className={styles.cardMain}>
              <span className={`${styles.title} ${note ? styles.struck : ''}`}>{row.title}</span>
              <span className={styles.cardMeta}>
                {!past && index === anchorIndex && <span className={styles.next}>Next</span>}
                {meta && <span className={row.isMine ? styles.mine : undefined}>{meta}</span>}
                <span className={styles.duration}>{formatDuration(row.durationSec)}</span>
              </span>
            </span>

            {/* Only where the adder is hidden from this viewer. */}
            {row.addedByName === null && (
              <RevealButton
                remaining={revealsRemaining}
                busy={busy}
                onReveal={() => onReveal(row)}
              />
            )}

            {/* Only ever on your own pending rows. The server enforces it regardless. */}
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
      })}

      {/* Slack below the last card, so it can still reach the top edge and be rested on. */}
      <div className={styles.tail} aria-hidden />
    </div>
  );
}
