/**
 * Server Theme Module
 * 
 * Extracts the dominant hue from a Discord guild's icon and sets CSS --hue,
 * which drives the entire monochrome palette (backgrounds, text, borders,
 * accents) in both light and dark themes.
 * 
 * All color derivation happens in CSS via hsl(var(--hue), …). This module
 * only needs to set a single custom property.
 */

import { browser } from "$app/environment";

/** @type {string|null} Current guild ID whose theme is applied */
let _currentGuildId = null;

/** @type {Map<string, number>} Cache of extracted hues per guild */
const hueCache = new Map();

// Reactive version counter so Svelte components can react to changes
let _version = $state(0);

/**
 * Reactive server theme state.
 */
export const serverTheme = {
  get guildId() {
    void _version;
    return _currentGuildId;
  },
  get applied() {
    void _version;
    return _currentGuildId !== null;
  }
};

/**
 * Convert RGB to HSL.
 * @param {number} r - Red (0-255)
 * @param {number} g - Green (0-255)
 * @param {number} b - Blue (0-255)
 * @returns {{h: number, s: number, l: number}}
 */
function rgbToHsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      case b:
        h = ((r - g) / d + 4) / 6;
        break;
    }
  }

  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  };
}

/**
 * Compute relative luminance of an HSL color (for contrast checking).
 * @param {number} h - Hue (0-360)
 * @param {number} s - Saturation (0-100)
 * @param {number} l - Lightness (0-100)
 * @returns {number} Relative luminance (0-1)
 */
function getRelativeLuminance(h, s, l) {
  s /= 100;
  l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
  };
  const r = f(0), g = f(8), b = f(4);
  const toLinear = (c) => c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/**
 * Extract the dominant hue from an image URL via Canvas sampling.
 * @param {string} imageUrl
 * @returns {Promise<number|null>} Hue (0-360) or null on failure
 */
async function extractDominantHue(imageUrl) {
  if (!browser) return null;

  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";

    const timeout = setTimeout(() => {
      console.warn("[ServerTheme] Icon load timed out after 8s");
      resolve(null);
    }, 8000);

    img.onload = () => {
      clearTimeout(timeout);
      try {
        const size = 64;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, size, size);

        const imageData = ctx.getImageData(0, 0, size, size);
        const pixels = imageData.data;

        /** @type {Map<number, {h: number, s: number, l: number, weight: number, count: number}>} */
        const buckets = new Map();

        for (let i = 0; i < pixels.length; i += 4) {
          const r = pixels[i];
          const g = pixels[i + 1];
          const b = pixels[i + 2];
          const a = pixels[i + 3];

          if (a < 100) continue;

          const hsl = rgbToHsl(r, g, b);

          // Skip near-black, near-white, or very grey pixels
          if (hsl.l < 8 || hsl.l > 92 || hsl.s < 10) continue;

          // Bucket by hue (15° intervals)
          const bucketKey = Math.round(hsl.h / 15) * 15;

          const lightnessBoost = 1 - Math.abs(hsl.l - 50) / 50;
          const weight = (hsl.s / 100) * (0.3 + 0.7 * lightnessBoost);

          const existing = buckets.get(bucketKey);
          if (existing) {
            existing.h = (existing.h * existing.count + hsl.h) / (existing.count + 1);
            existing.s = (existing.s * existing.count + hsl.s) / (existing.count + 1);
            existing.l = (existing.l * existing.count + hsl.l) / (existing.count + 1);
            existing.weight += weight;
            existing.count++;
          } else {
            buckets.set(bucketKey, { h: hsl.h, s: hsl.s, l: hsl.l, weight, count: 1 });
          }
        }

        if (buckets.size === 0) {
          console.warn("[ServerTheme] No colour buckets — icon may be grey/dark/light");
          resolve(null);
          return;
        }

        const sorted = [...buckets.values()].sort((a, b) => b.weight - a.weight);
        const best = sorted[0];
        const hue = Math.round(best.h) % 360;

        console.log(`[ServerTheme] Dominant hue: ${hue}° (s=${Math.round(best.s)}% l=${Math.round(best.l)}% from ${best.count} pixels)`);
        resolve(hue);
      } catch (err) {
        console.error("[ServerTheme] Canvas extraction failed:", err);
        resolve(null);
      }
    };

    img.onerror = () => {
      clearTimeout(timeout);
      console.error("[ServerTheme] Failed to load icon image");
      resolve(null);
    };

    img.src = imageUrl;
  });
}

/**
 * Apply a hue to the CSS custom properties.
 * Also checks whether button text should be dark for bright accent hues.
 * @param {number} hue - Hue angle (0-360)
 */
function applyHue(hue) {
  if (!browser) return;

  const root = document.documentElement;
  root.style.setProperty("--hue", String(hue));

  // --- Contrast check for button text ---
  // Light-mode accent: hsl(hue, 80%, 55%)
  // If the accent is too bright for white text, switch to dark text.
  // WCAG AA requires contrast >= 4.5:1. White luminance = 1.0.
  // Contrast = 1.05 / (L + 0.05) >= 4.5  →  L <= 0.183
  const accentLum = getRelativeLuminance(hue, 80, 55);
  if (accentLum > 0.18) {
    root.style.setProperty("--color-primary-button-text", "var(--color-text)");
  } else {
    root.style.removeProperty("--color-primary-button-text");
  }

  console.log(`[ServerTheme] Applied --hue: ${hue} (accent lum: ${accentLum.toFixed(3)}, btn-text: ${accentLum > 0.18 ? "dark" : "white"})`);
}

/**
 * Remove all server theme overrides, restoring the default palette.
 */
function clearHue() {
  if (!browser) return;

  const root = document.documentElement;
  root.style.removeProperty("--hue");
  root.style.removeProperty("--color-primary-button-text");

  // Remove legacy injected <style> from the old implementation
  const legacyStyle = document.getElementById("server-theme-style");
  if (legacyStyle) legacyStyle.remove();
}

/**
 * Apply the server's accent colour derived from its Discord icon.
 * Caches extracted hues so repeat visits are instant.
 *
 * @param {string} guildId - The Discord guild ID
 * @param {string|null} iconHash - The guild's icon hash (null = no icon)
 */
export async function applyServerTheme(guildId, iconHash) {
  if (!browser) return;

  // Already applied for this guild
  if (_currentGuildId === guildId) return;

  console.log(`[ServerTheme] Applying theme for guild ${guildId}, icon: ${iconHash}`);

  if (!iconHash) {
    console.log("[ServerTheme] No icon hash — clearing theme");
    clearServerTheme();
    return;
  }

  // Check cache
  const cached = hueCache.get(guildId);
  if (cached !== undefined) {
    console.log(`[ServerTheme] Using cached hue: ${cached}°`);
    _currentGuildId = guildId;
    applyHue(cached);
    _version++;
    return;
  }

  // Build icon URL
  const ext = iconHash.startsWith("a_") ? "gif" : "png";
  const iconUrl = `https://cdn.discordapp.com/icons/${guildId}/${iconHash}.${ext}?size=64`;
  console.log(`[ServerTheme] Extracting hue from: ${iconUrl}`);

  const hue = await extractDominantHue(iconUrl);
  if (hue !== null) {
    hueCache.set(guildId, hue);
    _currentGuildId = guildId;
    applyHue(hue);
    _version++;
  } else {
    console.warn("[ServerTheme] Could not extract hue from icon");
  }
}

/**
 * Clear the server theme and restore the default palette.
 */
export function clearServerTheme() {
  if (!browser) return;
  if (_currentGuildId === null) return;

  console.log("[ServerTheme] Clearing server theme, restoring defaults");
  _currentGuildId = null;
  clearHue();
  _version++;
}

/**
 * Pre-extract and cache hues for a list of guilds in the background.
 * Called once on layout mount so that switching between servers is instant.
 *
 * @param {Array<{id: string, icon: string|null}>} guilds
 */
export function preloadGuildHues(guilds) {
  if (!browser) return;

  const toLoad = guilds.filter(g => g.icon && !hueCache.has(g.id));
  if (toLoad.length === 0) return;

  console.log(`[ServerTheme] Preloading hues for ${toLoad.length} guild(s)`);

  // Stagger loads slightly so we don't fire 20 image requests at once
  toLoad.forEach((guild, i) => {
    setTimeout(async () => {
      if (hueCache.has(guild.id)) return; // another call may have filled it
      const ext = guild.icon.startsWith("a_") ? "gif" : "png";
      const url = `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.${ext}?size=64`;
      const hue = await extractDominantHue(url);
      if (hue !== null) {
        hueCache.set(guild.id, hue);
        console.log(`[ServerTheme] Preloaded guild ${guild.id} → hue ${hue}°`);
      }
    }, i * 150); // 150ms apart
  });
}
