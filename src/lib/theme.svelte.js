/**
 * Theme store and utilities for managing light/dark mode
 * Supports: 'light', 'dark', 'system'
 */

import { browser } from "$app/environment";

/** @type {'light' | 'dark' | 'system'} */
let preference = $state("system");

/** @type {'light' | 'dark'} */
let resolved = $state("light");

// Initialize on browser
if (browser) {
  const stored = localStorage.getItem("theme");
  if (stored === "light" || stored === "dark" || stored === "system") {
    preference = stored;
  }
  resolved = getResolvedTheme(preference);

  // Listen for system theme changes
  const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
  mediaQuery.addEventListener("change", (e) => {
    if (preference === "system") {
      resolved = e.matches ? "dark" : "light";
      applyTheme(resolved);
    }
  });
}

/**
 * Get the resolved theme based on preference
 * @param {'light' | 'dark' | 'system'} pref
 * @returns {'light' | 'dark'}
 */
function getResolvedTheme(pref) {
  if (pref === "system") {
    if (browser) {
      return window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
    }
    return "light";
  }
  return pref;
}

/**
 * Apply theme to the document
 * @param {'light' | 'dark'} theme
 */
function applyTheme(theme) {
  if (browser) {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  }
}

/**
 * Set the theme preference
 * @param {'light' | 'dark' | 'system'} newPreference
 */
export function setTheme(newPreference) {
  preference = newPreference;
  resolved = getResolvedTheme(newPreference);

  if (browser) {
    if (newPreference === "system") {
      localStorage.removeItem("theme");
    } else {
      localStorage.setItem("theme", newPreference);
    }
    applyTheme(resolved);
  }
}

/**
 * Toggle between light and dark (sets explicit preference, not system)
 */
export function toggleTheme() {
  const newTheme = resolved === "dark" ? "light" : "dark";
  setTheme(newTheme);
}

/**
 * Get the current theme preference
 * @returns {'light' | 'dark' | 'system'}
 */
export function getPreference() {
  return preference;
}

/**
 * Get the resolved theme (actual applied theme)
 * @returns {'light' | 'dark'}
 */
export function getResolved() {
  return resolved;
}

/**
 * Theme store object for reactive access
 */
export const theme = {
  get preference() {
    return preference;
  },
  get resolved() {
    return resolved;
  },
  get isDark() {
    return resolved === "dark";
  },
  set: setTheme,
  toggle: toggleTheme,
};
