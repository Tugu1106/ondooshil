'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { PickerUser, PublicUser } from '@/lib/auth';

import styles from './AuthGate.module.css';

/**
 * The three-branch gate from spec §5:
 *
 *   valid session          → never reaches this component
 *   device cookie present  → "You're {name} — Continue", plus a small "Not you?"
 *   neither                → name picker → PIN entry, or first-claim PIN setup
 *
 * The Continue button posts to `/api/auth/continue`, which takes no body: this component
 * cannot name who to continue as, by design.
 */

type Mode = 'continue' | 'picker' | 'pin' | 'setpin';

type Props = {
  deviceUser: PublicUser | null;
  users: PickerUser[];
};

export default function AuthGate({ deviceUser, users }: Props) {
  const router = useRouter();

  const [mode, setMode] = useState<Mode>(deviceUser ? 'continue' : 'picker');
  const [selected, setSelected] = useState<PickerUser | null>(null);
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function post(url: string, body?: unknown) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: body ? { 'content-type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        setError(payload?.error?.message ?? 'Something went wrong. Try again.');
        setPin('');
        setConfirmPin('');
        return;
      }

      // The page is a server component; refresh re-runs it with the new cookies.
      router.refresh();
    } catch {
      setError('Network problem. Try again.');
    } finally {
      setBusy(false);
    }
  }

  function choose(user: PickerUser) {
    setSelected(user);
    setPin('');
    setConfirmPin('');
    setError(null);
    setMode(user.hasPin ? 'pin' : 'setpin');
  }

  function backToPicker() {
    setSelected(null);
    setPin('');
    setConfirmPin('');
    setError(null);
    setMode('picker');
  }

  const digitsOnly = (value: string) => value.replace(/\D/g, '').slice(0, 4);

  return (
    <main className={styles.wrap}>
      <h1 className={styles.brand}>Office Radio</h1>
      <p className={styles.tagline}>One queue, one speaker, one continuous broadcast.</p>

      <div className={styles.card}>
        {error && <p className={styles.error}>{error}</p>}

        {mode === 'continue' && deviceUser && (
          <>
            <p className={styles.prompt}>You&rsquo;re</p>
            <p className={styles.who}>{deviceUser.name}</p>
            <button
              className={styles.primary}
              disabled={busy}
              onClick={() => post('/api/auth/continue')}
            >
              {busy ? 'One moment…' : 'Continue'}
            </button>
            <button className={styles.link} disabled={busy} onClick={backToPicker}>
              Not you?
            </button>
          </>
        )}

        {mode === 'picker' && (
          <>
            <h2 className={styles.heading}>Who are you?</h2>
            <div className={styles.names}>
              {users.map((user) => (
                <button
                  key={user.id}
                  className={styles.name}
                  disabled={busy}
                  onClick={() => choose(user)}
                >
                  <span>{user.name}</span>
                  {!user.hasPin && <span className={styles.tag}>unclaimed</span>}
                </button>
              ))}
            </div>
            {deviceUser && (
              <button
                className={styles.link}
                disabled={busy}
                onClick={() => {
                  setError(null);
                  setMode('continue');
                }}
              >
                Back
              </button>
            )}
          </>
        )}

        {mode === 'pin' && selected && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void post('/api/auth/claim', { userId: selected.id, pin });
            }}
          >
            <h2 className={styles.heading}>{selected.name}</h2>
            <div className={styles.pinRow}>
              <label className={styles.label} htmlFor="pin">
                Enter your 4-digit PIN
              </label>
              <input
                id="pin"
                className={styles.pin}
                type="password"
                inputMode="numeric"
                autoComplete="off"
                autoFocus
                value={pin}
                onChange={(event) => setPin(digitsOnly(event.target.value))}
              />
            </div>
            <button className={styles.primary} disabled={busy || pin.length !== 4}>
              {busy ? 'Checking…' : 'Sign in'}
            </button>
            <button type="button" className={styles.link} disabled={busy} onClick={backToPicker}>
              Pick a different name
            </button>
          </form>
        )}

        {mode === 'setpin' && selected && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (pin !== confirmPin) {
                setError("Those PINs don't match.");
                setConfirmPin('');
                return;
              }
              void post('/api/auth/set-pin', { userId: selected.id, pin });
            }}
          >
            <h2 className={styles.heading}>Claim {selected.name}</h2>
            <div className={styles.pinRow}>
              <label className={styles.label} htmlFor="newPin">
                Choose a 4-digit PIN
              </label>
              <input
                id="newPin"
                className={styles.pin}
                type="password"
                inputMode="numeric"
                autoComplete="off"
                autoFocus
                value={pin}
                onChange={(event) => setPin(digitsOnly(event.target.value))}
              />
              <label className={styles.label} htmlFor="confirmPin">
                Type it again
              </label>
              <input
                id="confirmPin"
                className={styles.pin}
                type="password"
                inputMode="numeric"
                autoComplete="off"
                value={confirmPin}
                onChange={(event) => setConfirmPin(digitsOnly(event.target.value))}
              />
            </div>
            <button
              className={styles.primary}
              disabled={busy || pin.length !== 4 || confirmPin.length !== 4}
            >
              {busy ? 'Claiming…' : 'Claim this name'}
            </button>
            <button type="button" className={styles.link} disabled={busy} onClick={backToPicker}>
              Pick a different name
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
