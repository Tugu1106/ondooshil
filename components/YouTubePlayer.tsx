'use client';

import { useEffect, useRef } from 'react';

import { createPlayer, type YouTubePlayer as Player } from '@/lib/client/player';
import type { NowPlaying } from '@/lib/types';

import styles from './Player.module.css';

/**
 * The player itself (spec §7).
 *
 * Three rules this component exists to keep:
 *
 * 1. The iframe stays **mounted and visible** for the life of the page. It is small and
 *    tucked into a corner, but never `display: none` — some browsers pause playback for
 *    hidden iframes, and the resulting bug looks like the station stopping at random.
 * 2. The player instance is created once. Song changes call `loadVideoById` on it; the
 *    iframe is never torn down and rebuilt between songs.
 * 3. Changes are detected by comparing the **queue item id**, never the position. A skip
 *    breaks the timeline arithmetic, so the id is the only reliable signal.
 */

type Props = {
  playing: NowPlaying | null;
  listening: boolean;
  /** Seconds into the current song, from the server clock — never `Date.now()`. */
  positionAt: (playing: NowPlaying) => number;
  onFailed: (playing: NowPlaying, code: number) => void;
};

export default function YouTubePlayer({ playing, listening, positionAt, onFailed }: Props) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<Player | null>(null);

  /** The queue item currently loaded into the player, for id-based change detection. */
  const loadedItemRef = useRef<string | null>(null);

  // Kept in refs so the player effect does not need them as dependencies — re-running it
  // would mean tearing down the iframe, which is exactly what must never happen. Written
  // in effects rather than during render, because render must stay pure.
  const playingRef = useRef(playing);
  const onFailedRef = useRef(onFailed);

  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  useEffect(() => {
    onFailedRef.current = onFailed;
  }, [onFailed]);

  useEffect(() => {
    let cancelled = false;
    const mount = mountRef.current;
    if (!mount) return;

    void createPlayer(mount, {
      onError: (code) => {
        // Codes 101 and 150 mean embedding is disabled; others are just as fatal. Report
        // and let the server advance. Never retry — a retry loop stalls the station.
        const current = playingRef.current;
        if (current) onFailedRef.current(current, code);
      },
    }).then((player) => {
      if (cancelled) {
        player.destroy();
        return;
      }
      playerRef.current = player;
    });

    return () => {
      cancelled = true;
      playerRef.current?.destroy();
      playerRef.current = null;
    };
    // Empty deps on purpose: exactly one player, for the lifetime of the page.
  }, []);

  // Load a song when the broadcast changes, or when this listener first tunes in.
  useEffect(() => {
    const player = playerRef.current;
    if (!player || !listening) return;

    if (!playing) {
      // Silence. Stop, but keep the iframe and the instance alive.
      if (loadedItemRef.current !== null) {
        player.stopVideo();
        loadedItemRef.current = null;
      }
      return;
    }

    if (loadedItemRef.current === playing.queueItemId) return;

    // Join wherever the broadcast already is — tuning in mid-song is normal, and waiting
    // for the next track would make the app look broken on open.
    player.loadVideoById({
      videoId: playing.videoId,
      startSeconds: positionAt(playing),
    });
    loadedItemRef.current = playing.queueItemId;
  }, [playing, listening, positionAt]);

  // Stopping listening should release the audio but keep everything mounted.
  useEffect(() => {
    if (listening) return;
    playerRef.current?.pauseVideo();
    loadedItemRef.current = null;
  }, [listening]);

  return (
    <div className={styles.stage} aria-hidden>
      {/* Visible, never display:none. */}
      <div ref={mountRef} className={styles.frame} />
    </div>
  );
}
