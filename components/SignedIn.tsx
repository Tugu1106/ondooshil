'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';

import type { PickerUser, PublicUser } from '@/lib/auth';
import { positionSec, useStation } from '@/lib/client/useStation';
import type { NowPlaying as NowPlayingData, QueueRow, StateResponse } from '@/lib/types';

import AccountMenu from './AccountMenu';
import AddSongForm from './AddSongForm';
import ListenControls from './ListenControls';
import NowPlaying from './NowPlaying';
import PlayedToday from './PlayedToday';
import styles from './SignedIn.module.css';
import UpNext from './UpNext';
import YouTubePlayer from './YouTubePlayer';

/**
 * The signed-in page.
 *
 * Two panels. The left one is the whole broadcast in a single container, read top to
 * bottom as time runs: what has played, what is on air, what is coming. The right one is
 * for adding a song — a different job, so a different panel.
 *
 * Account actions live in the menu at the top right, which is the only place `is_owner`
 * surfaces at all. There is no admin area, because there is no admin.
 */

type Props = {
  user: PublicUser;
  users: PickerUser[];
  initialState: StateResponse;
};

export default function SignedIn({ user, users, initialState }: Props) {
  const router = useRouter();
  const station = useStation(initialState);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // Local only. Never sent to the server, never affects anyone else's speaker.
  const [listening, setListening] = useState(false);
  const [muted, setMuted] = useState(false);
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
        <div>
          <h1 className={styles.brand}>Office Radio</h1>
          <p className={styles.tagline}>One queue, one speaker, one continuous broadcast.</p>
        </div>

        <AccountMenu
          user={user}
          users={users}
          busy={busy}
          onSignOut={handleSignOut}
          onResetPin={handleResetPin}
        />
      </header>

      {station.error && <p className={styles.error}>{station.error}</p>}
      {notice && <p className={styles.notice}>{notice}</p>}

      <div className={styles.layout}>
        {/* Past, present and future — one container, read downward. */}
        <section className={styles.panel}>
          <PlayedToday
            rows={station.state.playedToday}
            onReveal={handleReveal}
            revealsRemaining={station.state.me.revealsRemaining}
            busy={busy}
          />

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
                listening={listening}
                muted={muted}
                volume={volume}
                positionAt={positionAt}
                onFailed={handleFailed}
              />
            }
            controls={
              <ListenControls
                listening={listening}
                muted={muted}
                volume={volume}
                onListeningChange={setListening}
                onMutedChange={setMuted}
                onVolumeChange={setVolume}
              />
            }
          />

          <UpNext
            rows={station.state.upNext}
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
