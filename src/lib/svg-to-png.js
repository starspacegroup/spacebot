/**
 * SVG to PNG conversion using resvg-wasm.
 * 
 * Works in both Cloudflare Workers and local Node/Bun environments.
 * Loads the WASM binary from static assets and fetches the Inter font
 * from Google Fonts CDN on first use (cached in memory thereafter).
 */

import { Resvg, initWasm } from '@resvg/resvg-wasm';
import { log } from '$lib/log.js';

let wasmInitialized = false;
let cachedFontData = null;

const FONT_URL = 'https://fonts.gstatic.com/s/inter/v18/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuLyfMZhrib2Bg-4.ttf';

/**
 * Initialize the resvg WASM module.
 * @param {string} origin - The origin URL to fetch the WASM binary from (e.g. http://localhost:4269)
 */
async function ensureInit(origin) {
  if (wasmInitialized) return;

  try {
    const wasmUrl = `${origin}/resvg_bg.wasm`;
    const resp = await fetch(wasmUrl);
    if (!resp.ok) {
      throw new Error(`Failed to fetch WASM: ${resp.status}`);
    }
    const wasmBuffer = await resp.arrayBuffer();
    await initWasm(wasmBuffer);
    wasmInitialized = true;
    log.info('[SVG-PNG] resvg WASM initialized');
  } catch (err) {
    log.error('[SVG-PNG] Failed to initialize resvg WASM:', err);
    throw err;
  }
}

/**
 * Load the Inter font for text rendering.
 */
async function loadFont() {
  if (cachedFontData) return cachedFontData;

  try {
    const resp = await fetch(FONT_URL);
    if (!resp.ok) {
      throw new Error(`Failed to fetch font: ${resp.status}`);
    }
    cachedFontData = new Uint8Array(await resp.arrayBuffer());
    log.info(`[SVG-PNG] Font loaded (${cachedFontData.length} bytes)`);
    return cachedFontData;
  } catch (err) {
    log.warn('[SVG-PNG] Failed to load font, text may not render:', err);
    return null;
  }
}

/**
 * Convert an SVG string to a PNG buffer.
 * @param {string} svgString - Complete SVG document
 * @param {string} origin - Origin URL for loading WASM (e.g. http://localhost:4269)
 * @param {Object} [options] - Rendering options
 * @param {number} [options.width=800] - Output width in pixels
 * @returns {Promise<Uint8Array>} PNG image data
 */
export async function svgToPng(svgString, origin, options = {}) {
  await ensureInit(origin);
  const fontData = await loadFont();

  const resvgOptions = {
    fitTo: {
      mode: 'width',
      value: options.width || 800,
    },
    font: {
      fontBuffers: fontData ? [fontData] : [],
      defaultFontFamily: 'Inter',
    },
    background: '#1e1e1e',
  };

  const resvg = new Resvg(svgString, resvgOptions);
  const rendered = resvg.render();
  const png = rendered.asPng();
  return png;
}

let cachedAvatarBase64 = null;

/**
 * Fetch the bot avatar PNG and return it as a data URI (cached in memory).
 * @param {string} origin - Origin URL (e.g. http://localhost:4269)
 * @returns {Promise<string|null>} data:image/png;base64,... or null on failure
 */
export async function getAvatarBase64(origin) {
  if (cachedAvatarBase64) return cachedAvatarBase64;
  try {
    const resp = await fetch(`${origin}/favicon-192.png`);
    if (!resp.ok) return null;
    const buffer = await resp.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    cachedAvatarBase64 = `data:image/png;base64,${btoa(binary)}`;
    return cachedAvatarBase64;
  } catch {
    return null;
  }
}
