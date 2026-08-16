'use client';

import { useState } from 'react';

import styles from './Station.module.css';

/**
 * The add box (spec §12).
 *
 * Anonymous by default — "Show my name" is opt-in, and unticked after every add so a
 * single decision never silently carries over to the next song.
 */

type Props = {
  onAdded: () => void | Promise<void>;
};

export default function AddSongForm({ onAdded }: Props) {
  const [url, setUrl] = useState('');
  const [showName, setShowName] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

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

      setSuccess(`Queued: ${payload?.added?.title ?? 'your song'}`);
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
    <div className={styles.card}>
      <h2 className={styles.sectionTitle}>Add a song</h2>

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

        <div className={styles.controls}>
          <label className={styles.checkbox}>
            <input
              type="checkbox"
              checked={showName}
              onChange={(event) => setShowName(event.target.checked)}
            />
            Show my name
          </label>

          <button className={styles.add} disabled={busy || !url.trim()}>
            {busy ? 'Checking…' : 'Add'}
          </button>
        </div>

        {failure && <p className={`${styles.message} ${styles.failure}`}>{failure}</p>}
        {success && <p className={`${styles.message} ${styles.success}`}>{success}</p>}
      </form>
    </div>
  );
}
