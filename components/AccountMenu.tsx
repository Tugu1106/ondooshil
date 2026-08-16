'use client';

import { useEffect, useRef, useState } from 'react';

import type { PickerUser, PublicUser } from '@/lib/auth';

import styles from './AccountMenu.module.css';

/**
 * The account control, top right.
 *
 * Holds the only two things a person does to their account: reset somebody's PIN, and
 * sign out. "Reset a PIN" appears **only for the `is_owner` user** — that flag grants
 * exactly one power and this is it. It is not an admin menu, and nothing about playback
 * belongs here: there is no host, no controller, and no roles beyond this.
 */

type Props = {
  user: PublicUser;
  users: PickerUser[];
  busy: boolean;
  onSignOut: () => void;
  onResetPin: (target: PickerUser) => Promise<string | null>;
};

export default function AccountMenu({ user, users, busy, onSignOut, onResetPin }: Props) {
  const [open, setOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Close on an outside click or Escape, as a system menu does.
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const others = users.filter((candidate) => candidate.id !== user.id);
  const initial = user.name.trim().charAt(0).toUpperCase() || '?';

  return (
    <>
      <div className={styles.wrap} ref={wrapRef}>
        <button
          className={styles.trigger}
          onClick={() => setOpen((wasOpen) => !wasOpen)}
          aria-expanded={open}
          aria-haspopup="menu"
        >
          <span className={styles.avatar} aria-hidden>
            {initial}
          </span>
          {user.name}
          <span className={styles.caret} aria-hidden>
            ▾
          </span>
        </button>

        {open && (
          <div className={styles.menu} role="menu">
            <div className={styles.who}>
              <p className={styles.name}>{user.name}</p>
              <p className={styles.role}>{user.isOwner ? 'Can reset PINs' : 'Listener'}</p>
            </div>

            {user.isOwner && (
              <button
                className={styles.item}
                role="menuitem"
                disabled={busy}
                onClick={() => {
                  setNotice(null);
                  setResetting(true);
                  setOpen(false);
                }}
              >
                Reset a PIN…
              </button>
            )}

            <button className={styles.item} role="menuitem" disabled={busy} onClick={onSignOut}>
              Sign out
            </button>
          </div>
        )}
      </div>

      {resetting && (
        <div
          className={styles.backdrop}
          onClick={(event) => {
            if (event.target === event.currentTarget) setResetting(false);
          }}
        >
          <div className={styles.dialog} role="dialog" aria-modal="true" aria-label="Reset a PIN">
            <h2 className={styles.dialogTitle}>Reset a PIN</h2>
            <p className={styles.dialogHint}>
              For someone who has forgotten theirs, or claimed the wrong name. They choose a
              new PIN the next time they sign in.
            </p>

            {others.map((candidate) => (
              <div key={candidate.id} className={styles.row}>
                <span>
                  {candidate.name}
                  {!candidate.hasPin && <span className={styles.unclaimed}> · unclaimed</span>}
                </span>
                <button
                  className={styles.reset}
                  disabled={busy || !candidate.hasPin}
                  onClick={async () => setNotice(await onResetPin(candidate))}
                >
                  Reset
                </button>
              </div>
            ))}

            {notice && <p className={styles.notice}>{notice}</p>}

            <button className={styles.close} onClick={() => setResetting(false)}>
              Done
            </button>
          </div>
        </div>
      )}
    </>
  );
}
