'use client';

import { useEffect, useState } from 'react';

import styles from './Station.module.css';

/**
 * The add box (spec §12).
 *
 * Anonymous by default — "Show my name" is opt-in, and unticked after every add so a
 * single decision never silently carries over to the next song.
 *
 * Success clears itself after {@link SUCCESS_MS}, and does not name the song. The queue
 * below already shows what was added; a confirmation that repeats the title and then sits
 * there until the next add is a receipt for something the user can already see.
 *
 * Failures do **not** auto-clear — those you need time to read and act on.
 */

/** How long the confirmation stays up. Long enough to notice, short enough not to linger. */
const SUCCESS_MS = 1800;

type Props = {
  onAdded: () => void | Promise<void>;
};

export default function AddSongForm({ onAdded }: Props) {
  const [url, setUrl] = useState('');
  const [showName, setShowName] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!success) return;
    const timer = setTimeout(() => setSuccess(null), SUCCESS_MS);
    return () => clearTimeout(timer);
  }, [success]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!url.trim() || busy) return;

    setBusy(true);
    setFailure(null);
    setSuccess(null);

    try {
      const response = await fetch('/api/queue', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url, showName }),
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        setFailure(payload?.error?.message ?? 'Could not add that one.');
        return;
      }

      setSuccess('Added to the queue');
      setUrl('');
      setShowName(false);
      await onAdded();
    } catch {
      setFailure('Network problem. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={submit}>
        <input
          className={styles.url}
          type="url"
          inputMode="url"
          autoComplete="off"
          placeholder="Paste a YouTube link"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
        />

      <label className={styles.checkbox}>
        <input
          type="checkbox"
          checked={showName}
          onChange={(event) => setShowName(event.target.checked)}
        />
        Show my name
      </label>

      <button className={styles.add} disabled={busy || !url.trim()}>
        {busy ? 'Checking…' : 'Add to the queue'}
      </button>

      {failure && <p className={`${styles.message} ${styles.failure}`}>{failure}</p>}
      {success && <p className={`${styles.message} ${styles.success}`}>{success}</p>}
    </form>
  );
}
