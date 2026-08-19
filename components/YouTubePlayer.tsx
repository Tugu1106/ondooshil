'use client';

import { useEffect, useRef, useState } from 'react';

import { createPlayer, PLAYER_STATE, type YouTubePlayer as Player } from '@/lib/client/player';
import { DRIFT_CHECK_INTERVAL_MS, shouldSeek } from '@/lib/client/useStation';
import type { NowPlaying } from '@/lib/types';

import styles from './Player.module.css';

/**
 * The player (spec §7).
 *
 * **The broadcast runs here whether or not anyone can hear it.** The iframe loads and
 * plays from the moment the page opens, muted, and keeps going through every transition.
 * `muted` only decides whether this machine's speaker is audible — it never starts or
 * stops the stream. That is the whole point: a radio does not switch off because you
 * turned the volume down, and there is nothing to re-buffer when you turn it back up.
 *
 * Muted autoplay is the one kind browsers permit without a user gesture, so the station
 * can start on its own; unmuting is the gesture, and that is what needs the click.
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
 * 4. Anything that pauses the player — a throttled background tab, a suspended iframe, a
 *    blocked autoplay attempt — is a fault to recover from, not an instruction to obey.
 */

type Props = {
  playing: NowPlaying | null;
  /** Speaker only. Never gates loading or playback. */
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

  /*
   * Whether the player has actually reached PLAYING for the item currently loaded.
   *
   * Between `loadVideoById` and the first frame, YouTube shows its own poster — the big
   * play button and the share buttons — for a second or three. `controls: 0` does not
   * suppress that, because it is the pre-playback state rather than the transport bar. So
   * the screen stays covered until playback is genuinely under way.
   *
   * Set false only on a *load*, never on a pause or a buffer: a mid-song stall must not
   * flash a cover over a station that is already running.
   */
  const [live, setLive] = useState(false);

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
        const player = playerRef.current;
        if (!player || loadedItemRef.current === null) return;

        if (playerState === PLAYER_STATE.PLAYING) {
          // Playing for real — the poster is gone, so the screen can be uncovered.
          setLive(true);
          // Covers a resume after any interruption: rejoin the broadcast where it is now,
          // not where it stopped. The 2-second tolerance makes the check that follows an
          // ordinary load a no-op.
          correctDrift(player);
          return;
        }

        // Nobody asked for either of these — the transport controls are hidden. A
        // background tab, a suspended iframe, or an autoplay attempt that did not take.
        if (playerState === PLAYER_STATE.PAUSED || playerState === PLAYER_STATE.CUED) {
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
   * Load whatever is on air. Deliberately independent of `muted`: the stream runs from
   * page load onward, so unmuting is instant rather than a fresh buffer.
   */
  useEffect(() => {
    const player = playerRef.current;
    if (!player || !ready) return;

    if (!playing) {
      // Silence between songs. Stop, but keep the instance and the iframe alive.
      if (loadedItemRef.current !== null) {
        player.stopVideo();
        loadedItemRef.current = null;
        setLive(false);
      }
      return;
    }

    if (loadedItemRef.current === playing.queueItemId) return;

    // Join wherever the broadcast already is — tuning in mid-song is normal, and waiting
    // for the next track would make the app look broken on open.
    // Cover the screen again for the new song, until it is genuinely playing.
    setLive(false);

    player.loadVideoById({
      videoId: playing.videoId,
      startSeconds: positionAt(playing),
      // The frame is 160×90 and most listeners are muted, so ask for the smallest stream.
      // It looks identical at this size and costs the office connection far less.
      suggestedQuality: 'small',
    });
    loadedItemRef.current = playing.queueItemId;
  }, [playing, positionAt, ready]);

  /** The speaker. This is the only thing the toggle touches. */
  useEffect(() => {
    const player = playerRef.current;
    if (!player || !ready) return;

    player.setVolume(volume);
    if (muted) player.mute();
    else player.unMute();
  }, [muted, volume, ready]);

  /**
   * Coming back to a backgrounded tab: its timers were throttled, so the playhead is
   * stale and the browser may have suspended the iframe.
   */
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      const player = playerRef.current;
      if (!player || loadedItemRef.current === null) return;
      player.playVideo();
      correctDrift(player);
    };

    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  /**
   * Drift correction (spec §7). Keyed on the queue item id rather than the `playing`
   * object: that object is a fresh value on every 3-second poll, so depending on it would
   * restart this 30-second interval before it ever fired.
   */
  const playingId = playing?.queueItemId ?? null;

  useEffect(() => {
    if (playingId === null || !ready) return;

    const timer = setInterval(() => {
      const player = playerRef.current;
      if (player) correctDrift(player);
    }, DRIFT_CHECK_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [playingId, ready]);

  return (
    <div className={styles.stage} aria-hidden>
      {/* Visible, never display:none. */}
      <div ref={mountRef} className={styles.frame} />

      {/*
        Two covers, both siblings laid *over* the player and never a change to it — the
        iframe stays mounted, sized and visible underneath, so the rule above is untouched.

        Nothing on air: dead air, which is purely visual. Silence stays silent.
        On air but not yet started: a plain screen, hiding YouTube's poster and its play
        and share buttons until the song is actually running.
      */}
      {!playing && (
        <div className={styles.deadAir}>
          <span className={styles.tally}>Off air</span>
        </div>
      )}

      {playing && !live && <div className={styles.tuning} />}
    </div>
  );
}
