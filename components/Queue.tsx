'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import type { NowPlaying, QueueRow } from '@/lib/types';

import RevealButton from './RevealButton';
import styles from './Station.module.css';

/**
 * The queue — the whole day in one list (spec §12).
 *
 * Past songs, the one on air, then everything still to come. The list **rests with one
 * past song against the top edge and the current song directly under it**: enough history
 * visible to show where you are, without burying what is playing. The rest of the past is
 * parked above, reachable by scrolling up; take the pointer away and it settles back.
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

/**
 * The song on air as a queue row.
 *
 * `/api/state` deliberately keeps it out of `upNext` — which song is current is owned by
 * `player_state`, not by the queue — so the timeline is reassembled here rather than by
 * changing a contract that is stable from Phase 2 onward.
 *
 * `isMine` comes from `canSkip`, which is true only for the adder, so no identity is
 * invented. `canRemove` is false because the server refuses to delete the song on air
 * (409 `on_air`); skip is the way past it.
 */
function playingAsRow(playing: NowPlaying): QueueRow {
  return {
    id: playing.queueItemId,
    videoId: playing.videoId,
    title: playing.title,
    durationSec: playing.durationSec,
    status: 'playing',
    addedByName: playing.addedByName,
    isMine: playing.canSkip,
    canRemove: false,
    revealed: false,
  };
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

type Props = {
  /** Today's history, newest first, as the API returns it. */
  played: QueueRow[];
  /** The song on air, or null for silence. */
  playing: NowPlaying | null;
  /** Round-robin ordered, and never contains the song on air. */
  upNext: QueueRow[];
  onRemove: (row: QueueRow) => void;
  onReveal: (row: QueueRow) => void;
  revealsRemaining: number;
  busy: boolean;
};

export default function Queue({
  played,
  playing,
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

  /** Whether the list is scrolled all the way up, so the hint can stand down. */
  const [atTop, setAtTop] = useState(false);

  // Oldest first, so the day reads downward: what has been, what is, what is coming.
  const history = [...played].reverse();
  const rows = [...history, ...(playing ? [playingAsRow(playing)] : []), ...upNext];

  /*
   * What the list is about: the song on air, or the next one when nothing is, or simply
   * the end of the day. One row above it sits at the top edge, which is what keeps a
   * single past song in view.
   */
  const focusIndex = playing !== null || upNext.length > 0 ? history.length : rows.length - 1;
  const anchorIndex = Math.max(0, focusIndex - 1);
  const anchorId = rows[anchorIndex]?.id ?? null;
  const playingId = playing?.queueItemId ?? null;

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

  function handleScroll() {
    // React bails on an identical value, so this does not re-render on every scroll tick.
    setAtTop((listRef.current?.scrollTop ?? 0) <= 2);
  }

  if (rows.length === 0) {
    return <p className={styles.empty}>Nothing today yet. Paste a link to start the station.</p>;
  }

  return (
    <div className={styles.queueBox}>
      {/*
        There is history above the fold and nothing else would say so — the list opens
        part-scrolled, which looks like the top. Stands down once you reach it.
      */}
      {history.length > 0 && (
        <p className={styles.pastHint} data-quiet={atTop}>
          ↑ Earlier today
        </p>
      )}

      <div
        ref={listRef}
        className={styles.queue}
        onPointerEnter={handleEnter}
        onPointerLeave={handleLeave}
        onScroll={handleScroll}
        aria-label="Queue"
      >
        {rows.map((row, index) => {
          const past = index < history.length;
          const isPlaying = row.id === playingId;
          const isNext = !past && !isPlaying && index === focusIndex + (playing ? 1 : 0);
          const note = statusNote(row);
          const who = attribution(row);
          const meta = [who, note].filter(Boolean).join(' · ');

          return (
            <div
              key={row.id}
              ref={index === anchorIndex ? anchorRef : null}
              className={`${styles.card} ${past ? styles.past : ''} ${
                isPlaying ? styles.playing : ''
              }`}
            >
              {/* Marks where the station actually is in the day. */}
              {isPlaying && (
                <span className={styles.cursor} aria-hidden>
                  ▶
                </span>
              )}

              <span className={styles.cardMain}>
                <span className={`${styles.title} ${note ? styles.struck : ''}`}>{row.title}</span>
                <span className={styles.cardMeta}>
                  {isNext && <span className={styles.next}>Next</span>}
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
    </div>
  );
}
