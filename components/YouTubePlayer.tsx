'use client';

import { useEffect, useRef, useState } from 'react';

import { createPlayer, PLAYER_STATE, type YouTubePlayer as Player } from '@/lib/client/player';
import { DRIFT_CHECK_INTERVAL_MS, shouldSeek } from '@/lib/client/useStation';
import type { NowPlaying } from '@/lib/types';

import styles from './Player.module.css';

/**
 * The player (spec §7).
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
 *
 * **There is exactly one control: mute.** `muted` is the single source of truth for
 * whether this machine is streaming. There is no separate "am I listening" flag, because
 * two pieces of state describing one thing is precisely how a button ends up claiming
 * sound is playing while the room hears silence.
 *
 * And because a radio cannot be paused, anything that pauses this player — a throttled
 * background tab, the browser suspending an iframe — is a fault to recover from, not an
 * instruction to obey. The player resumes itself and re-seeks to the live position.
 */

type Props = {
  playing: NowPlaying | null;
  muted: boolean;
  /** 0–100, local to this browser. Never sent to the server. */
  volume: number;
  /** Seconds into the current song, from the server clock — never `Date.now()`. */
  positionAt: (playing: NowPlaying) => number;
  onFailed: (playing: NowPlaying, code: number) => void;
};

export default function YouTubePlayer({ playing, muted, volume, positionAt, onFailed }: Props) {
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
  const mutedRef = useRef(muted);

  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  useEffect(() => {
    onFailedRef.current = onFailed;
  }, [onFailed]);

  useEffect(() => {
    positionAtRef.current = positionAt;
  }, [positionAt]);

  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

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
        const player = playerRef.current;
        if (!player || mutedRef.current) return;

        if (playerState === PLAYER_STATE.PLAYING) {
          // Covers a resume after any interruption: rejoin the broadcast where it is now,
          // not where it stopped. The 2-second tolerance makes the check that follows an
          // ordinary load a no-op.
          correctDrift(player);
          return;
        }

        if (playerState === PLAYER_STATE.PAUSED) {
          // Nobody asked for this — the controls are hidden. A background tab or a
          // suspended iframe did it, so recover rather than sitting there silently.
          player.playVideo();
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

  /**
   * Load the current song when the broadcast changes, or when this machine unmutes.
   *
   * While muted nothing is loaded at all, so a silent tab streams no video. The click
   * that unmutes is also the user gesture browsers require before audio may play.
   */
  useEffect(() => {
    const player = playerRef.current;
    if (!player || !ready) return;

    if (muted || !playing) {
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
  }, [playing, muted, positionAt, ready]);

  // Volume is local and applies only while audible.
  useEffect(() => {
    const player = playerRef.current;
    if (!player || !ready) return;
    player.setVolume(volume);
  }, [volume, ready]);

  /**
   * Coming back to a backgrounded tab: its timers were throttled, so the playhead is
   * stale and the browser may have suspended the iframe. Re-sync and make sure it is
   * still running.
   */
  useEffect(() => {
    if (muted) return;

    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      const player = playerRef.current;
      if (!player || loadedItemRef.current === null) return;
      player.playVideo();
      correctDrift(player);
    };

    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [muted]);

  /**
   * Drift correction (spec §7). Keyed on the queue item id rather than the `playing`
   * object: that object is a fresh value on every 3-second poll, so depending on it would
   * restart this 30-second interval before it ever fired.
   */
  const playingId = playing?.queueItemId ?? null;

  useEffect(() => {
    if (muted || playingId === null || !ready) return;

    const timer = setInterval(() => {
      const player = playerRef.current;
      if (player) correctDrift(player);
    }, DRIFT_CHECK_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [muted, playingId, ready]);

  return (
    <div className={styles.stage} aria-hidden>
      {/* Visible, never display:none. */}
      <div ref={mountRef} className={styles.frame} />
    </div>
  );
}
