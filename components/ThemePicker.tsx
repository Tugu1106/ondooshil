'use client';

import { useEffect, useRef, useState } from 'react';

import styles from './ThemePicker.module.css';

/**
 * The theme picker, to the left of the account control.
 *
 * **Placeholder.** Only `weather` is built — it is the live sky in `components/Sky.tsx`.
 * The other five are named here so the shape of the choice exists before the work does,
 * and so the surface that will carry them is already in the header rather than being
 * retrofitted around whatever gets built first.
 *
 * Choosing one writes `data-theme` on `<html>`, which is the hook every future theme
 * should hang off: a stylesheet keyed on `:root[data-theme='cyberpunk']` needs no
 * component changes at all. Until those exist, the attribute changes and nothing else
 * does — that is expected, not a bug.
 *
 * Controlled, because the choice also decides which background layer `SignedIn` renders —
 * two copies of that state would be two things that can disagree.
 *
 * Not persisted. A reload returns to Weather. Worth adding once the themes are all real;
 * not worth the hydration handling before that.
 */

export const THEMES = [
  { id: 'weather', label: 'Weather', note: 'Live sky over Ulaanbaatar' },
  { id: 'iridescent', label: 'Iridescent', note: 'Holographic, prismatic' },
  { id: 'cyberpunk', label: 'Cyberpunk', note: 'Neon on black' },
  { id: 'cozy', label: 'Cozy', note: 'Warm, low light' },
  { id: 'dark', label: 'Dark', note: 'Plain and quiet' },
  { id: 'responsive', label: 'Responsive', note: 'Reacts to what is playing' },
] as const;

export type ThemeId = (typeof THEMES)[number]['id'];

export const DEFAULT_THEME: ThemeId = 'weather';

type Props = {
  value: ThemeId;
  onChange: (theme: ThemeId) => void;
};

export default function ThemePicker({ value: theme, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  /*
   * The hook for every theme that does not exist yet. Written in an effect rather than
   * during render — touching the document while rendering is exactly the impurity React
   * 19 rejects elsewhere in this app.
   */
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // Close on an outside click or Escape, as the account menu beside it does.
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

  const current = THEMES.find((candidate) => candidate.id === theme) ?? THEMES[0];

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <button
        className={styles.trigger}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <span className={styles.swatch} data-theme={current.id} aria-hidden />
        {current.label}
        <span className={styles.caret} aria-hidden>
          ▾
        </span>
      </button>

      {open && (
        <div className={styles.menu} role="menu">
          {THEMES.map((option) => (
            <button
              key={option.id}
              className={styles.item}
              role="menuitemradio"
              aria-checked={option.id === theme}
              onClick={() => {
                onChange(option.id);
                setOpen(false);
              }}
            >
              <span className={styles.swatch} data-theme={option.id} aria-hidden />

              <span className={styles.itemText}>
                <span className={styles.itemLabel}>{option.label}</span>
                <span className={styles.itemNote}>{option.note}</span>
              </span>

              <span className={styles.tick} aria-hidden>
                {option.id === theme ? '✓' : ''}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
