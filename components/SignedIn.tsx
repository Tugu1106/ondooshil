'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { PickerUser, PublicUser } from '@/lib/auth';
import { useStation } from '@/lib/client/useStation';
import type { StateResponse } from '@/lib/types';

import AddSongForm from './AddSongForm';
import PlayedToday from './PlayedToday';
import styles from './SignedIn.module.css';
import UpNext from './UpNext';

/**
 * The signed-in shell and the station itself.
 *
 * Polls `/api/state` every 3 seconds and renders the add box, the round-robin queue, and
 * today's history. Now playing, the Listen button and the player arrive in Phases 4 and 5.
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

      <div className={styles.card}>
        <p className={styles.placeholder}>
          {station.error ?? 'Now playing, the Listen button and the player arrive next.'}
        </p>
      </div>

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
