import { readFileSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	OG_CARDS,
	SITE_URL,
	isOgCardKey,
	ogImageUrl,
	socialFor,
	type OgCardKey,
} from '../lib/seo/social.js';

describe('share cards', () => {
	it('every card has short text that fits the 1200 px image', () => {
		for (const [key, card] of Object.entries(OG_CARDS)) {
			expect(card.title.length, `${key} title`).toBeGreaterThan(0);
			expect(card.title.length, `${key} title`).toBeLessThanOrEqual(28);
			expect(card.subtitle.length, `${key} subtitle`).toBeLessThanOrEqual(48);
			expect(card.description.length, `${key} description`).toBeLessThanOrEqual(90);
		}
	});

	it('only names in the table are cards', () => {
		expect(isOgCardKey('status')).toBe(true);
		for (const bad of ['__proto__', 'constructor', 'toString', 'nope', '', null, 7]) {
			expect(isOgCardKey(bad)).toBe(false);
		}
		expect(ogImageUrl('status')).toBe(`${SITE_URL}/og/status.png`);
	});
});

describe('which card a page gets', () => {
	const cases: [string, OgCardKey][] = [
		['/', 'home'],
		['/status', 'status'],
		['/status/', 'status'],
		['/servers', 'servers'],
		['/docs', 'docs'],
		['/docs/dev', 'devdocs'],
		['/privacy', 'privacy'],
		['/terms', 'terms'],
		['/leaderboards', 'leaderboards'],
		['/ideas', 'ideas'],
		['/vote', 'vote'],
		['/support', 'support'],
		['/invite', 'invite'],
		['/login', 'login'],
		['/admin', 'dashboard'],
		['/admin/123/stats', 'dashboard'],
		['/account/runners', 'dashboard'],
	];
	for (const [path, card] of cases) {
		it(`${path} gets the ${card} card with its own title`, () => {
			const s = socialFor(path);
			expect(s.card).toBe(card);
			expect(s.own).toBe(false);
			expect(s.title.length).toBeGreaterThan(0);
			expect(s.description.length).toBeGreaterThan(0);
		});
	}

	it('/status is about the status page, not the home page', () => {
		const s = socialFor('/status');
		expect(s.title).toBe('SpaceBot Status');
		expect(s.description).toMatch(/status/i);
	});

	it('pages built from data write their own tags', () => {
		for (const path of ['/servers/1009583217948491928', '/docs/dev/api', '/profile/1/2']) {
			expect(socialFor(path).own, path).toBe(true);
		}
		expect(socialFor('/servers').own).toBe(false);
		expect(socialFor('/docs/dev').own).toBe(false);
	});

	it('a page nobody described still gets a real card', () => {
		const s = socialFor('/something-new');
		expect(s.card).toBe('home');
		expect(s.own).toBe(false);
		expect(Object.hasOwn(OG_CARDS, s.card)).toBe(true);
	});

	it('every public page in the sitemap has its own card, not the fallback', async () => {
		const { buildSitemap } = await import('../lib/server/sitemap.js');
		const paths = [...buildSitemap(SITE_URL).matchAll(/<loc>([^<]*)<\/loc>/g)].map(
			(m) => new URL(m[1]).pathname
		);
		expect(paths.length).toBeGreaterThan(5);
		for (const p of paths) {
			if (p === '/') continue;
			expect(socialFor(p).card, p).not.toBe('home');
		}
	});
});

describe('the card images', () => {
	it('every card has a 1200×630 PNG in static/og (run scripts/generate-og-cards.ts)', () => {
		for (const key of Object.keys(OG_CARDS)) {
			const file = `static/og/${key}.png`;
			expect(existsSync(file), file).toBe(true);
			const png = readFileSync(file);
			expect(png.subarray(1, 4).toString(), file).toBe('PNG');
			expect(png.readUInt32BE(16), `${file} width`).toBe(1200);
			expect(png.readUInt32BE(20), `${file} height`).toBe(630);
		}
	});

	it('the old /api/og address redirects to a card, and never draws request text', async () => {
		const { GET } = await import('../routes/api/og/+server.js');
		const go = (q: string) => {
			try {
				GET({ url: new URL(`https://x.test/api/og${q}`) } as any);
			} catch (e: any) {
				return { status: e.status as number, to: e.location as string };
			}
			throw new Error('expected a redirect');
		};
		expect(go('?page=status')).toEqual({ status: 301, to: '/og/status.png' });
		expect(go('?page=nope')).toEqual({ status: 301, to: '/og/home.png' });
		expect(go('')).toEqual({ status: 301, to: '/og/home.png' });
		expect(go('?page=status&title=EVIL').to).toBe('/og/status.png');
		expect(go('?page=../../etc/passwd').to).toBe('/og/home.png');
	});
});

describe('the card template', () => {
	it('wraps text evenly and never ends on a lone short word', async () => {
		const { wrap } = await import('../lib/seo/og-svg.js');
		expect(wrap('How we collect, use, and protect your data.', 40)).toEqual([
			'How we collect, use,',
			'and protect your data.',
		]);
		expect(wrap('Terms of Service', 16)).toEqual(['Terms of Service']);
		expect(wrap('Vote for SpaceBot', 15)).toEqual(['Vote for', 'SpaceBot']);
		expect(wrap('', 20)).toEqual([]);
		for (const line of wrap('a '.repeat(60), 30)) expect(line.length).toBeLessThanOrEqual(30);
	});

	it('draws every card with its words and a drawing, and escapes the text', async () => {
		const { ogSvg } = await import('../lib/seo/og-svg.js');
		for (const [key, card] of Object.entries(OG_CARDS)) {
			const svg = ogSvg(key as OgCardKey, card, 'data:image/png;base64,AAAA');
			expect(svg.startsWith('<svg'), key).toBe(true);
			expect(svg, key).toContain('spacebot.starspace.group');
			expect(svg, key).not.toContain('undefined');
			expect(svg, key).not.toContain('NaN');
		}
		const evil = ogSvg('home', { title: '<b>"&', subtitle: 'x', description: 'y' }, 'data:,');
		expect(evil).not.toContain('<b>');
		expect(evil).toContain('&lt;b&gt;&quot;&amp;');
	});
});

describe('who writes the meta description', () => {
	it('the layout writes it only for pages that do not write their own', () => {
		// These pages have a <meta name="description"> of their own (translated), so a second would duplicate it.
		for (const p of ['/', '/servers', '/docs', '/docs/dev', '/privacy', '/terms']) {
			expect(socialFor(p).ownDescription, p).toBe(true);
		}
		// These have none, so the layout writes one (Lighthouse flagged /support for lacking it).
		for (const p of [
			'/status',
			'/support',
			'/vote',
			'/invite',
			'/ideas',
			'/leaderboards',
			'/login',
		]) {
			expect(socialFor(p).ownDescription, p).toBe(false);
			expect(socialFor(p).description.length, p).toBeGreaterThan(20);
		}
	});
});
