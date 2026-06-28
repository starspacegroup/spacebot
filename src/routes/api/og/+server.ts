import { svgToPng } from '$lib/svg-to-png.js';

const WIDTH = 1200;
const HEIGHT = 630;
const FONT = "'Inter', 'Segoe UI', system-ui, sans-serif";

// SpaceBot logo (107×128 viewBox)
const SPACEBOT_LOGO_BG = 'M94.157 22.819c-10.4-14.885-30.94-19.297-45.792-9.835L22.282 29.608A29.92 29.92 0 0 0 8.764 49.65a31.5 31.5 0 0 0 3.108 20.231 30 30 0 0 0-4.477 11.183 31.9 31.9 0 0 0 5.448 24.116c10.402 14.887 30.942 19.297 45.791 9.835l26.083-16.624A29.92 29.92 0 0 0 98.235 78.35a31.53 31.53 0 0 0-3.105-20.232 30 30 0 0 0 4.474-11.182 31.88 31.88 0 0 0-5.447-24.116';
const SPACEBOT_LOGO_FG = 'M45.817 106.582a20.72 20.72 0 0 1-22.237-8.243 19.17 19.17 0 0 1-3.277-14.503 18 18 0 0 1 .624-2.435l.49-1.498 1.337.981a33.6 33.6 0 0 0 10.203 5.098l.97.294-.09.968a5.85 5.85 0 0 0 1.052 3.878 6.24 6.24 0 0 0 6.695 2.485 5.8 5.8 0 0 0 1.603-.704L69.27 76.28a5.43 5.43 0 0 0 2.45-3.631 5.8 5.8 0 0 0-.987-4.371 6.24 6.24 0 0 0-6.698-2.487 5.7 5.7 0 0 0-1.6.704l-9.953 6.345a19 19 0 0 1-5.296 2.326 20.72 20.72 0 0 1-22.237-8.243 19.17 19.17 0 0 1-3.277-14.502 17.99 17.99 0 0 1 8.13-12.052l26.081-16.623a19 19 0 0 1 5.3-2.329 20.72 20.72 0 0 1 22.237 8.243 19.17 19.17 0 0 1 3.277 14.503 18 18 0 0 1-.624 2.435l-.49 1.498-1.337-.98a33.6 33.6 0 0 0-10.203-5.1l-.97-.294.09-.968a5.86 5.86 0 0 0-1.052-3.878 6.24 6.24 0 0 0-6.696-2.485 5.8 5.8 0 0 0-1.602.704L37.73 51.72a5.42 5.42 0 0 0-2.449 3.63 5.79 5.79 0 0 0 .986 4.372 6.24 6.24 0 0 0 6.698 2.486 5.8 5.8 0 0 0 1.602-.704l9.952-6.342a19 19 0 0 1 5.295-2.328 20.72 20.72 0 0 1 22.237 8.242 19.17 19.17 0 0 1 3.277 14.503 18 18 0 0 1-8.13 12.053l-26.081 16.622a19 19 0 0 1-5.3 2.328';

// Discord Clyde logo mark (24×24 viewBox)
const DISCORD_LOGO_PATH = 'M19.27 5.33C17.94 4.71 16.5 4.26 15 4a.09.09 0 0 0-.07.03c-.18.33-.39.76-.53 1.09a16.09 16.09 0 0 0-4.8 0c-.14-.34-.36-.76-.54-1.09c-.01-.02-.04-.03-.07-.03c-1.5.26-2.93.71-4.27 1.33c-.01 0-.02.01-.03.02c-2.72 4.07-3.47 8.03-3.1 11.95c0 .02.01.04.03.05c1.8 1.32 3.53 2.12 5.24 2.65c.03.01.06 0 .07-.02c.4-.55.76-1.13 1.07-1.74c.02-.04 0-.08-.04-.09c-.57-.22-1.11-.48-1.64-.78c-.04-.02-.04-.08-.01-.11c.11-.08.22-.17.33-.25c.02-.02.05-.02.07-.01c3.44 1.57 7.15 1.57 10.55 0c.02-.01.05-.01.07.01c.11.09.22.17.33.26c.04.03.04.09-.01.11c-.52.31-1.07.56-1.64.78c-.04.01-.05.06-.04.09c.32.61.68 1.19 1.07 1.74c.03.01.06.02.09.01c1.72-.53 3.45-1.33 5.25-2.65c.02-.01.03-.03.03-.05c.44-4.53-.73-8.46-3.1-11.95c-.01-.01-.02-.02-.04-.02zM8.52 14.91c-1.03 0-1.89-.95-1.89-2.12s.84-2.12 1.89-2.12c1.06 0 1.9.96 1.89 2.12c0 1.17-.84 2.12-1.89 2.12zm6.97 0c-1.03 0-1.89-.95-1.89-2.12s.84-2.12 1.89-2.12c1.06 0 1.9.96 1.89 2.12c0 1.17-.83 2.12-1.89 2.12z';

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

  <!-- SpaceBot logo -->
  <g transform="translate(60, ${HEIGHT / 2 - 65}) scale(0.7)">
    <path fill="#7C3AED" d="${SPACEBOT_LOGO_BG}"/>
    <path fill="#ffffff" d="${SPACEBOT_LOGO_FG}"/>
  </g>

  <!-- Title -->
  <text x="170" y="${HEIGHT / 2 - 60}" fill="#ffffff" font-size="52" font-weight="700" font-family="${FONT}" letter-spacing="-0.02em">${esc(meta.title)}</text>

  <!-- Subtitle -->
  <text x="170" y="${HEIGHT / 2}" fill="#a78bfa" font-size="24" font-weight="500" font-family="${FONT}">${esc(meta.subtitle)}</text>

  <!-- Description -->
  <text x="170" y="${HEIGHT / 2 + 50}" fill="#9ca3af" font-size="18" font-weight="400" font-family="${FONT}">${esc(meta.description)}</text>

  <!-- Discord logo -->
  <g transform="translate(${WIDTH - 320}, ${HEIGHT - 80}) scale(2.5)">
    <path fill="#5865F2" d="${DISCORD_LOGO_PATH}"/>
  </g>

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

    return new Response(png as BodyInit, {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=86400, s-maxage=604800',
      },
    });
  } catch {
    // Fallback: return the SVG directly if PNG conversion fails
    return new Response(svg, {
      headers: {
        'Content-Type': 'image/svg+xml',
        'Cache-Control': 'public, max-age=86400',
      },
    });
  }
}
