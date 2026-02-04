/**
 * Theme store and utilities for managing light/dark mode
 * Supports: 'light', 'dark', 'system'
 * 
 * NOTE: This module is designed to be compatible with browser extensions
 * that use SES (Secure ECMAScript) lockdown, such as MetaMask.
 */

import { browser } from "$app/environment";

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
 * @param {'light' | 'dark'} themeValue
 */
function applyTheme(themeValue) {
  if (browser) {
    document.documentElement.dataset.theme = themeValue;
    document.documentElement.style.colorScheme = themeValue;
  }
}

// Use simple non-reactive variables for the actual values
// This avoids SES lockdown conflicts with Svelte's $state proxy
let _preference = "system";
let _resolved = "light";
let _initialized = false;

/**
 * Initialize theme from localStorage (called lazily)
 */
function ensureInitialized() {
  if (_initialized) return;
  _initialized = true;
  
  if (browser) {
    const stored = localStorage.getItem("theme");
    if (stored === "light" || stored === "dark" || stored === "system") {
      _preference = stored;
    }
    _resolved = getResolvedTheme(_preference);
    applyTheme(_resolved);
    
    // Listen for system theme changes
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    mediaQuery.addEventListener("change", (e) => {
      if (_preference === "system") {
        _resolved = e.matches ? "dark" : "light";
        applyTheme(_resolved);
        // Trigger reactive update
        themeVersion++;
      }
    });
  }
}

// A simple counter to trigger reactive updates when theme changes
// Using $state only for this simple primitive avoids SES conflicts
let themeVersion = $state(0);

/**
 * Set the theme preference
 * @param {'light' | 'dark' | 'system'} newPreference
 */
export function setTheme(newPreference) {
  ensureInitialized();
  _preference = newPreference;
  _resolved = getResolvedTheme(newPreference);

  if (browser) {
    if (newPreference === "system") {
      localStorage.removeItem("theme");
    } else {
      localStorage.setItem("theme", newPreference);
    }
    applyTheme(_resolved);
  }
  
  // Trigger reactive update
  themeVersion++;
}

/**
 * Toggle between light and dark (sets explicit preference, not system)
 */
export function toggleTheme() {
  ensureInitialized();
  const newTheme = _resolved === "dark" ? "light" : "dark";
  setTheme(newTheme);
}

/**
 * Get the current theme preference
 * @returns {'light' | 'dark' | 'system'}
 */
export function getPreference() {
  ensureInitialized();
  return _preference;
}

/**
 * Get the resolved theme (actual applied theme)
 * @returns {'light' | 'dark'}
 */
export function getResolved() {
  ensureInitialized();
  return _resolved;
}

/**
 * Theme store object for reactive access
 * Reading any property will trigger re-render when theme changes
 */
export const theme = {
  get preference() {
    ensureInitialized();
    // Access themeVersion to create reactive dependency
    void themeVersion;
    return _preference;
  },
  get resolved() {
    ensureInitialized();
    void themeVersion;
    return _resolved;
  },
  get isDark() {
    ensureInitialized();
    void themeVersion;
    return _resolved === "dark";
  },
  set: setTheme,
  toggle: toggleTheme,
};
