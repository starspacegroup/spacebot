import { svgToPng, getAvatarBase64 } from '$lib/svg-to-png.js';

const WIDTH = 1200;
const HEIGHT = 630;
const FONT = "'Inter', 'Segoe UI', system-ui, sans-serif";

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

function generateOgSvg(page = 'home', avatarDataUri = null) {
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
    <clipPath id="avatarClip">
      <circle cx="100" cy="${HEIGHT / 2 - 20}" r="40"/>
    </clipPath>
  </defs>

  <!-- Background -->
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)"/>

  <!-- Subtle decorative orbs -->
  <circle cx="950" cy="150" r="300" fill="url(#orb1)"/>
  <circle cx="200" cy="500" r="250" fill="url(#orb2)"/>

  <!-- Accent bar at top -->
  <rect x="0" y="0" width="${WIDTH}" height="4" fill="url(#accent)"/>

  <!-- Bot avatar -->
  ${avatarDataUri
    ? `<circle cx="100" cy="${HEIGHT / 2 - 20}" r="42" fill="#5610C6" opacity="0.3"/>
  <image href="${avatarDataUri}" x="${100 - 42}" y="${HEIGHT / 2 - 20 - 42}" width="84" height="84" clip-path="url(#avatarClip)" preserveAspectRatio="xMidYMid slice"/>`
    : `<circle cx="100" cy="${HEIGHT / 2 - 20}" r="40" fill="#5610C6" opacity="0.15"/>
  <text x="100" y="${HEIGHT / 2 - 10}" fill="#ffffff" font-size="36" font-weight="700" font-family="${FONT}" text-anchor="middle" dominant-baseline="middle">S</text>`}

  <!-- Title -->
  <text x="170" y="${HEIGHT / 2 - 60}" fill="#ffffff" font-size="52" font-weight="700" font-family="${FONT}" letter-spacing="-0.02em">${esc(meta.title)}</text>

  <!-- Subtitle -->
  <text x="170" y="${HEIGHT / 2}" fill="#a78bfa" font-size="24" font-weight="500" font-family="${FONT}">${esc(meta.subtitle)}</text>

  <!-- Description -->
  <text x="170" y="${HEIGHT / 2 + 50}" fill="#9ca3af" font-size="18" font-weight="400" font-family="${FONT}">${esc(meta.description)}</text>

  <!-- Discord logo -->
  <g transform="translate(${WIDTH - 280}, ${HEIGHT - 48}) scale(1.1)">
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
  const avatarDataUri = await getAvatarBase64(url.origin);
  const svg = generateOgSvg(page, avatarDataUri);

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
