import { svgToPng } from '$lib/svg-to-png.js';

const WIDTH = 1200;
const HEIGHT = 630;
const FONT = "'Inter', 'Segoe UI', system-ui, sans-serif";

const PAGE_META = {
  home: {
    title: 'SpaceBot',
    subtitle: 'The powerful Discord bot platform you control',
    description: 'Custom commands · Automations · AI Assistant · Analytics · Integrations',
  },
  docs: {
    title: 'Documentation',
    subtitle: 'SpaceBot',
    description: 'Learn how to set up and use custom commands, automations, integrations, the REST API, and more.',
  },
  privacy: {
    title: 'Privacy Policy',
    subtitle: 'SpaceBot',
    description: 'How we collect, use, and protect your data.',
  },
  terms: {
    title: 'Terms of Service',
    subtitle: 'SpaceBot',
    description: 'Rules and guidelines for using SpaceBot.',
  },
};

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function generateOgSvg(page = 'home') {
  const meta = PAGE_META[page] || PAGE_META.home;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0D0B1A"/>
      <stop offset="100%" stop-color="#1a1333"/>
    </linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#5610C6"/>
      <stop offset="100%" stop-color="#7c3aed"/>
    </linearGradient>
    <linearGradient id="orb1" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#5610C6" stop-opacity="0.15"/>
      <stop offset="100%" stop-color="#5610C6" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="orb2" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#7c3aed" stop-opacity="0.1"/>
      <stop offset="100%" stop-color="#7c3aed" stop-opacity="0"/>
    </linearGradient>
  </defs>

  <!-- Background -->
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)"/>

  <!-- Subtle decorative orbs -->
  <circle cx="950" cy="150" r="300" fill="url(#orb1)"/>
  <circle cx="200" cy="500" r="250" fill="url(#orb2)"/>

  <!-- Accent bar at top -->
  <rect x="0" y="0" width="${WIDTH}" height="4" fill="url(#accent)"/>

  <!-- Logo circle placeholder + text -->
  <circle cx="100" cy="${HEIGHT / 2 - 20}" r="40" fill="#5610C6" opacity="0.15"/>
  <text x="100" y="${HEIGHT / 2 - 10}" fill="#ffffff" font-size="36" font-weight="700" font-family="${FONT}" text-anchor="middle" dominant-baseline="middle">S</text>

  <!-- Title -->
  <text x="170" y="${HEIGHT / 2 - 60}" fill="#ffffff" font-size="52" font-weight="700" font-family="${FONT}" letter-spacing="-0.02em">${esc(meta.title)}</text>

  <!-- Subtitle -->
  <text x="170" y="${HEIGHT / 2}" fill="#a78bfa" font-size="24" font-weight="500" font-family="${FONT}">${esc(meta.subtitle)}</text>

  <!-- Description -->
  <text x="170" y="${HEIGHT / 2 + 50}" fill="#9ca3af" font-size="18" font-weight="400" font-family="${FONT}">${esc(meta.description)}</text>

  <!-- Bottom domain -->
  <text x="${WIDTH - 60}" y="${HEIGHT - 30}" fill="#6b7280" font-size="16" font-weight="500" font-family="${FONT}" text-anchor="end">spacebot.starspace.group</text>

  <!-- Bottom accent line -->
  <rect x="60" y="${HEIGHT - 60}" width="100" height="3" rx="1.5" fill="url(#accent)" opacity="0.5"/>
</svg>`;
}

/** @type {import('./$types').RequestHandler} */
export async function GET({ url }) {
  const page = url.searchParams.get('page') || 'home';
  const svg = generateOgSvg(page);

  try {
    const png = await svgToPng(svg, url.origin, { width: WIDTH });

    return new Response(png, {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=86400, s-maxage=604800',
      },
    });
  } catch (err) {
    // Fallback: return the SVG directly if PNG conversion fails
    return new Response(svg, {
      headers: {
        'Content-Type': 'image/svg+xml',
        'Cache-Control': 'public, max-age=86400',
      },
    });
  }
}
