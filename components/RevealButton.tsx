'use client';

import styles from './Station.module.css';

/**
 * The reveal control (spec §9, §12).
 *
 * Shown only on rows whose adder is hidden from this viewer. It carries the remaining
 * budget so the cost is visible before it is paid, and disables at zero rather than
 * failing after the click.
 *
 * Spending one is private. Nothing tells the room a reveal happened, and the count shown
 * here is the viewer's own — it never describes anybody else.
 */

type Props = {
  remaining: number;
  busy: boolean;
  onReveal: () => void;
};

export default function RevealButton({ remaining, busy, onReveal }: Props) {
  const spent = remaining <= 0;

  return (
    <button
      className={styles.reveal}
      disabled={busy || spent}
      onClick={onReveal}
      title={spent ? 'No reveals left today' : `Reveal who added this — ${remaining} left today`}
    >
      {spent ? 'no reveals left' : `reveal · ${remaining} left`}
    </button>
  );
}
