'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';

import type { PickerUser, PublicUser } from '@/lib/auth';
import { positionSec, useStation } from '@/lib/client/useStation';
import type { NowPlaying as NowPlayingData, QueueRow, Sky, StateResponse } from '@/lib/types';

import AccountMenu from './AccountMenu';
import AddSongForm from './AddSongForm';
import NowPlaying from './NowPlaying';
import Queue from './Queue';
import styles from './SignedIn.module.css';
import SpeakerToggle from './SpeakerToggle';
import ThemePicker from './ThemePicker';
import WeatherReadout from './WeatherReadout';
import YouTubePlayer from './YouTubePlayer';

/**
 * The signed-in page.
 *
 * Two panels. The left one is the station: the song on air, and below it the day's queue
 * as one continuous list. The right one is for adding a song — a different job, so a
 * different panel.
 *
 * Account actions live in the menu at the top right, which is the only place `is_owner`
 * surfaces at all. There is no admin area, because there is no admin.
 */

type Props = {
  user: PublicUser;
  users: PickerUser[];
  initialState: StateResponse;
  /** What it is doing outside. Server-rendered, then refreshed slowly by the readout. */
  sky: Sky;
};

export default function SignedIn({ user, users, initialState, sky }: Props) {
  const router = useRouter();
  const station = useStation(initialState);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  /**
   * The one playback control, local to this browser. Opens muted: browsers refuse to
   * autoplay audio without a user gesture, and unmuting is that gesture. There is no
   * separate "listening" flag — one truth about whether this speaker is on, so the button
   * cannot disagree with what the room can hear.
   */
  const [muted, setMuted] = useState(true);
  const [volume, setVolume] = useState(70);

  const { serverNow, refresh } = station;

  const positionAt = useCallback(
    (playing: NowPlayingData) => positionSec(playing.startedAt, playing.durationSec, serverNow()),
    [serverNow],
  );

  /**
   * The video will not play here. Mark it failed and let the server advance — never
   * retry. Non-embeddable uploads are common, and without this the station silently dies
   * mid-morning looking exactly like a queue bug.
   */
  const handleFailed = useCallback(
    async (playing: NowPlayingData) => {
      await fetch(`/api/queue/${playing.queueItemId}/failed`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ videoId: playing.videoId }),
      }).catch(() => undefined);
      await refresh();
    },
    [refresh],
  );

  /** Adder-only, and silent: nothing here or anywhere records who pressed it. */
  const handleSkip = useCallback(
    async (playing: NowPlayingData) => {
      setBusy(true);
      await fetch(`/api/queue/${playing.queueItemId}/skip`, { method: 'POST' }).catch(
        () => undefined,
      );
      await refresh();
      setBusy(false);
    },
    [refresh],
  );

  /**
   * Spend a ticket. Private: the answer comes back only to this browser, and the refresh
   * that follows re-serialises the row with the name now visible to this viewer alone.
   */
  const handleReveal = useCallback(
    async (row: { id: string }) => {
      setBusy(true);
      const response = await fetch(`/api/reveal/${row.id}`, { method: 'POST' });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        setNotice(payload?.error?.message ?? 'Could not reveal that one.');
      }
      await refresh();
      setBusy(false);
    },
    [refresh],
  );

  const handleRemove = useCallback(
    async (row: QueueRow) => {
      setBusy(true);
      const response = await fetch(`/api/queue/${row.id}`, { method: 'DELETE' });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        setNotice(payload?.error?.message ?? 'Could not remove that one.');
      }
      await refresh();
      setBusy(false);
    },
    [refresh],
  );

  const handleSignOut = useCallback(async () => {
    setBusy(true);
    await fetch('/api/auth/logout', { method: 'POST' });
    setBusy(false);
    router.refresh();
  }, [router]);

  /** Owner only. Returns the line to show inside the dialog. */
  const handleResetPin = useCallback(
    async (target: PickerUser): Promise<string | null> => {
      setBusy(true);
      const response = await fetch('/api/owner/reset-pin', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: target.id }),
      });
      const payload = await response.json().catch(() => null);
      setBusy(false);
      router.refresh();

      return response.ok
        ? `${target.name} can now set a new PIN.`
        : (payload?.error?.message ?? 'Reset failed.');
    },
    [router],
  );

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.brand}>Title</h1>

        <WeatherReadout initial={sky} />

        {/* Theme first, then the account: appearance is changed far more often. */}
        <div className={styles.controls}>
          <ThemePicker />

          <AccountMenu
            user={user}
            users={users}
            busy={busy}
            onSignOut={handleSignOut}
            onResetPin={handleResetPin}
          />
        </div>
      </header>

      {station.error && <p className={styles.error}>{station.error}</p>}
      {notice && <p className={styles.notice}>{notice}</p>}

      <div className={styles.layout}>
        {/* The song on air, and under it the day's queue. */}
        <section className={styles.panel}>
          <NowPlaying
            playing={station.state.playing}
            positionAt={positionAt}
            onSkip={handleSkip}
            onReveal={(playing) => handleReveal({ id: playing.queueItemId })}
            revealsRemaining={station.state.me.revealsRemaining}
            busy={busy}
            player={
              <YouTubePlayer
                playing={station.state.playing}
                muted={muted}
                volume={volume}
                positionAt={positionAt}
                onFailed={handleFailed}
              />
            }
            controls={
              <SpeakerToggle
                muted={muted}
                volume={volume}
                onMutedChange={setMuted}
                onVolumeChange={setVolume}
              />
            }
          />

          <Queue
            played={station.state.playedToday}
            upNext={station.state.upNext}
            onRemove={handleRemove}
            onReveal={handleReveal}
            revealsRemaining={station.state.me.revealsRemaining}
            busy={busy}
          />
        </section>

        <aside className={`${styles.panel} ${styles.addPanel}`}>
          <h2 className={styles.panelTitle}>Add a song</h2>
          <AddSongForm onAdded={refresh} />
        </aside>
      </div>
    </main>
  );
}
