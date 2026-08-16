'use client';

import { useEffect, useRef, useState } from 'react';

import { createPlayer, PLAYER_STATE, type YouTubePlayer as Player } from '@/lib/client/player';
import { DRIFT_CHECK_INTERVAL_MS, shouldSeek } from '@/lib/client/useStation';
import type { NowPlaying } from '@/lib/types';

import styles from './Player.module.css';

/**
 * The player itself (spec §7).
 *
 * Rules this component exists to keep:
 *
 * 1. The iframe stays **mounted and visible** for the life of the page. It is small and
 *    tucked into a corner, but never `display: none` — some browsers pause playback for
 *    hidden iframes, and the resulting bug looks like the station stopping at random.
 * 2. The player instance is created once. Song changes call `loadVideoById` on it; the
 *    iframe is never torn down and rebuilt between songs.
 * 3. Changes are detected by comparing the **queue item id**, never the position. A skip
 *    breaks the timeline arithmetic, so the id is the only reliable signal.
 * 4. Resuming after a local pause re-syncs to the live position. It is a radio: you rejoin
 *    the broadcast where it is now, not where you left it.
 */

type Props = {
  playing: NowPlaying | null;
  listening: boolean;
  muted: boolean;
  /** 0–100, local to this browser. Never sent to the server. */
  volume: number;
  /** Seconds into the current song, from the server clock — never `Date.now()`. */
  positionAt: (playing: NowPlaying) => number;
  onFailed: (playing: NowPlaying, code: number) => void;
};

export default function YouTubePlayer({
  playing,
  listening,
  muted,
  volume,
  positionAt,
  onFailed,
}: Props) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<Player | null>(null);
  const [ready, setReady] = useState(false);

  /** The queue item currently loaded into the player, for id-based change detection. */
  const loadedItemRef = useRef<string | null>(null);

  // Kept in refs so the player effect does not need them as dependencies — re-running it
  // would mean tearing down the iframe, which is exactly what must never happen. Written
  // in effects rather than during render, because render must stay pure.
  const playingRef = useRef(playing);
  const onFailedRef = useRef(onFailed);
  const positionAtRef = useRef(positionAt);

  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  useEffect(() => {
    onFailedRef.current = onFailed;
  }, [onFailed]);

  useEffect(() => {
    positionAtRef.current = positionAt;
  }, [positionAt]);

  /** Pull the player back onto the timeline, but only if it has drifted far enough. */
  function correctDrift(player: Player) {
    const current = playingRef.current;
    if (!current || loadedItemRef.current !== current.queueItemId) return;

    const expected = positionAtRef.current(current);
    // Seeking is audibly jarring, so a small disagreement is left alone.
    if (shouldSeek(player.getCurrentTime(), expected)) {
      player.seekTo(expected, true);
    }
  }

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
      onStateChange: (playerState) => {
        // Resuming after a local pause rejoins the live broadcast rather than continuing
        // from where it stopped. The same 2-second tolerance applies, so the seek that
        // immediately follows loadVideoById is a no-op.
        if (playerState === PLAYER_STATE.PLAYING && playerRef.current) {
          correctDrift(playerRef.current);
        }
      },
    }).then((player) => {
      if (cancelled) {
        player.destroy();
        return;
      }
      playerRef.current = player;
      setReady(true);
    });

    return () => {
      cancelled = true;
      playerRef.current?.destroy();
      playerRef.current = null;
    };
    // Empty deps on purpose: exactly one player, for the lifetime of the page.
    // `correctDrift` is captured from the first render, which is safe because it reads
    // only refs — there is no stale state for it to close over.
  }, []);

  // Load a song when the broadcast changes, or when this listener first tunes in.
  useEffect(() => {
    const player = playerRef.current;
    if (!player || !listening) return;

    if (!playing) {
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
  }, [playing, listening, positionAt, ready]);

  // Stopping listening releases the audio but keeps everything mounted.
  useEffect(() => {
    if (listening) return;
    playerRef.current?.pauseVideo();
    loadedItemRef.current = null;
  }, [listening]);

  // Local volume and mute. Entirely client-side: they never touch the server and never
  // affect anyone else's speaker.
  useEffect(() => {
    const player = playerRef.current;
    if (!player || !ready) return;

    player.setVolume(volume);
    if (muted) player.mute();
    else player.unMute();
  }, [volume, muted, ready]);

  /**
   * Drift correction (spec §7). Keyed on the queue item id rather than the `playing`
   * object: that object is a fresh value on every 3-second poll, so depending on it would
   * restart this 30-second interval before it ever fired.
   */
  const playingId = playing?.queueItemId ?? null;

  useEffect(() => {
    if (!listening || playingId === null || !ready) return;

    const timer = setInterval(() => {
      const player = playerRef.current;
      if (player) correctDrift(player);
    }, DRIFT_CHECK_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [listening, playingId, ready]);

  return (
    <div className={styles.stage} aria-hidden>
      {/* Visible, never display:none. */}
      <div ref={mountRef} className={styles.frame} />
    </div>
  );
}
