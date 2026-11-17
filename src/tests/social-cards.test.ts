import { describe, expect, it, vi } from 'vitest';
import {
	OG_CARDS,
	SITE_URL,
	isOgCardKey,
	ogImageUrl,
	socialFor,
	type OgCardKey,
} from '../lib/seo/social.js';

const svgSeen: string[] = [];
vi.mock('$lib/svg-to-png.js', () => ({
	svgToPng: async (svg: string) => {
		svgSeen.push(svg);
		return new Uint8Array([137, 80, 78, 71]);
	},
}));

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
		expect(ogImageUrl('status')).toBe(`${SITE_URL}/api/og?page=status`);
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

describe('/api/og', () => {
	it('draws a table card for a known name and the home card for anything else', async () => {
		const { GET } = await import('../routes/api/og/+server.js');
		const draw = async (q: string) => {
			svgSeen.length = 0;
			const res = await GET({ url: new URL(`https://x.test/api/og${q}`) } as any);
			expect(res.headers.get('content-type')).toBe('image/png');
			return svgSeen[0];
		};
		expect(await draw('?page=status')).toContain('Service Status');
		expect(await draw('?page=nope')).toContain('The powerful Discord bot platform');
		expect(await draw('')).toContain('The powerful Discord bot platform');
	});

	it('never prints text taken from the request', async () => {
		const { GET } = await import('../routes/api/og/+server.js');
		svgSeen.length = 0;
		await GET({
			url: new URL('https://x.test/api/og?page=status&title=EVIL&description=EVIL%20TEXT'),
		} as any);
		expect(svgSeen[0]).not.toContain('EVIL');
	});
});
