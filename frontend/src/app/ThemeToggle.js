'use client';

import { useEffect, useState } from 'react';
import styles from './page.module.css';

// Sun icon: circle + rays. Shown when the active theme is dark (or unknown).
function SunIcon() {
  return (
    <svg
      width={18}
      height={18}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="M4.9 4.9l1.4 1.4" />
      <path d="M17.7 17.7l1.4 1.4" />
      <path d="M4.9 19.1l1.4-1.4" />
      <path d="M17.7 6.3l1.4-1.4" />
    </svg>
  );
}

// Crescent moon. Shown when the active theme is light (action: switch to dark).
function MoonIcon() {
  return (
    <svg
      width={18}
      height={18}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z" />
    </svg>
  );
}

export default function ThemeToggle() {
  // Starts as null so the very first client render matches the server markup.
  // The real theme is read from the DOM in an effect, never during render —
  // reading document during render is what produces hydration mismatches.
  const [theme, setTheme] = useState(null);

  useEffect(() => {
    // The inline script in <head> already set data-theme before first paint.
    setTheme(document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
  }, []);

  const handleClick = () => {
    const next = theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('theme', next);
    } catch (e) {
      // Storage can be unavailable (private mode, blocked cookies) — the
      // in-memory switch still works for this session.
    }
    setTheme(next);
  };

  // Stable placeholder until the effect resolves the active theme.
  const label =
    theme === null
      ? 'Đổi chế độ sáng tối'
      : theme === 'light'
        ? 'Chuyển sang chế độ tối'
        : 'Chuyển sang chế độ sáng';

  return (
    <button
      type="button"
      className={styles.themeToggle}
      onClick={handleClick}
      aria-label={label}
      title={label}
    >
      {theme === 'light' ? <MoonIcon /> : <SunIcon />}
    </button>
  );
}
