'use client';

import { useEffect, useRef, useState } from 'react';

import styles from './ThemePicker.module.css';

/**
 * The theme picker, to the left of the account control.
 *
 * **Placeholder.** Only `weather` is built — it is the live sky in `components/Sky.tsx`.
 * The rest are named here so the shape of the choice exists before the work does, and so
 * the surface that will carry them is already in the header rather than being retrofitted
 * around whatever gets built first.
 *
 * Split into two groups because they are two different decisions. **Regular** is choosing
 * a comfortable place to read from. **Unusual** is choosing a mood, and some of those are
 * not even static — Weather follows the sky outside, Responsive would follow whatever is
 * on air. One flat list makes the strange ones look like ordinary alternatives to Dark,
 * which they are not.
 *
 * Choosing one writes `data-theme` on `<html>`, which is the hook every future theme
 * should hang off: a stylesheet keyed on `:root[data-theme='cyberpunk']` needs no
 * component changes at all. Until those exist, the attribute changes and nothing else
 * does — that is expected, not a bug.
 *
 * Not persisted. A reload returns to Weather. Worth adding once the themes are all real;
 * not worth the hydration handling before that.
 */

export const THEME_GROUPS = [
  {
    name: 'Regular',
    themes: [
      { id: 'light', label: 'Light', note: 'Plain and bright' },
      { id: 'dark', label: 'Dark', note: 'Plain and quiet' },
      { id: 'cozy', label: 'Cozy', note: 'Warm, low light' },
    ],
  },
  {
    name: 'Unusual',
    themes: [
      { id: 'weather', label: 'Weather', note: 'Live sky over Ulaanbaatar' },
      { id: 'iridescent', label: 'Iridescent', note: 'Holographic, prismatic' },
      { id: 'heaven', label: 'Heaven', note: 'Bright, weightless, above the cloud' },
      { id: 'fantasy', label: 'Fantasy', note: 'Storybook, enchanted' },
      { id: 'cyberpunk', label: 'Cyberpunk', note: 'Neon on black' },
      { id: 'responsive', label: 'Responsive', note: 'Reacts to what is playing' },
    ],
  },
] as const;

export type ThemeId = (typeof THEME_GROUPS)[number]['themes'][number]['id'];

type ThemeOption = { id: ThemeId; label: string; note: string };

export const DEFAULT_THEME: ThemeId = 'weather';

/** Flat, for the one lookup that has to search across both groups. */
const ALL_THEMES: readonly ThemeOption[] = THEME_GROUPS.flatMap(
  (group) => group.themes as readonly ThemeOption[],
);

export default function ThemePicker() {
  const [theme, setTheme] = useState<ThemeId>(DEFAULT_THEME);
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

  const current = ALL_THEMES.find((candidate) => candidate.id === theme) ?? ALL_THEMES[0];

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
          {THEME_GROUPS.map((group) => (
            <div key={group.name} role="group" aria-label={group.name} className={styles.group}>
              <p className={styles.groupName}>{group.name}</p>

              {group.themes.map((option) => (
                <button
                  key={option.id}
                  className={styles.item}
                  role="menuitemradio"
                  aria-checked={option.id === theme}
                  onClick={() => {
                    setTheme(option.id);
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
          ))}
        </div>
      )}
    </div>
  );
}
