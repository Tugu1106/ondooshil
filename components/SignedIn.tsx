'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';

import type { PickerUser, PublicUser } from '@/lib/auth';
import { positionSec, useStation } from '@/lib/client/useStation';
import type { NowPlaying as NowPlayingData, StateResponse } from '@/lib/types';

import AddSongForm from './AddSongForm';
import ListenControls from './ListenControls';
import NowPlaying from './NowPlaying';
import PlayedToday from './PlayedToday';
import styles from './SignedIn.module.css';
import UpNext from './UpNext';
import YouTubePlayer from './YouTubePlayer';

/**
 * The signed-in shell and the station itself.
 *
 * Polls `/api/state` every 3 seconds and renders now playing, the player, the add box,
 * the round-robin queue, and today's history.
 *
 * The owner panel is the UI for `/api/owner/reset-pin`, the single power `is_owner`
 * grants. It is not an admin surface and must not grow into one.
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

  async function logout() {
    setBusy(true);
    await fetch('/api/auth/logout', { method: 'POST' });
    setBusy(false);
    router.refresh();
  }

  async function resetPin(target: PickerUser) {
    setBusy(true);
    setNotice(null);

    const response = await fetch('/api/owner/reset-pin', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId: target.id }),
    });

    const payload = await response.json().catch(() => null);
    setNotice(
      response.ok
        ? `${target.name} can now set a new PIN.`
        : (payload?.error?.message ?? 'Reset failed.'),
    );

    setBusy(false);
    router.refresh();
  }

  const others = users.filter((candidate) => candidate.id !== user.id);

  return (
    <main className={styles.wrap}>
      <h1 className={styles.brand}>Office Radio</h1>
      <p className={styles.tagline}>One queue, one speaker, one continuous broadcast.</p>

      <div className={styles.card}>
        <div className={styles.row}>
          <div>
            <p className={styles.prompt}>Signed in as</p>
            <p className={styles.who}>{user.name}</p>
          </div>
          <button className={styles.secondary} disabled={busy} onClick={logout}>
            Log out
          </button>
        </div>
      </div>

      <NowPlaying playing={station.state.playing} positionAt={positionAt}>
        <YouTubePlayer
          playing={station.state.playing}
          listening={listening}
          muted={muted}
          volume={volume}
          positionAt={positionAt}
          onFailed={handleFailed}
        />
      </NowPlaying>

      <ListenControls
        listening={listening}
        muted={muted}
        volume={volume}
        onListeningChange={setListening}
        onMutedChange={setMuted}
        onVolumeChange={setVolume}
      />

      {station.error && <p className={styles.placeholder}>{station.error}</p>}

      <AddSongForm onAdded={station.refresh} />

      <UpNext rows={station.state.upNext} />
      <PlayedToday rows={station.state.playedToday} />

      {user.isOwner && (
        <div className={styles.card}>
          <h2 className={styles.heading}>Reset a PIN</h2>
          <p className={styles.hint}>
            For someone who has forgotten theirs, or claimed the wrong name. They choose a
            new PIN the next time they sign in.
          </p>
          {others.map((candidate) => (
            <div key={candidate.id} className={styles.resetRow}>
              <span>
                {candidate.name}
                {!candidate.hasPin && <span className={styles.unclaimed}> · unclaimed</span>}
              </span>
              <button
                className={styles.secondary}
                disabled={busy || !candidate.hasPin}
                onClick={() => resetPin(candidate)}
              >
                Reset
              </button>
            </div>
          ))}
          {notice && <p className={styles.notice}>{notice}</p>}
        </div>
      )}
    </main>
  );
}
