/**
 * Draw every share card to `static/og/<name>.png`. Run it after changing a card in
 * `src/lib/seo/social.ts`, the template in `src/lib/seo/og-svg.ts` or the mark, and commit the PNGs:
 *
 *   bun scripts/generate-og-cards.ts
 *
 * Cards are drawn here, not on request, because Cloudflare Workers will not compile WebAssembly
 * from bytes at runtime. The Inter fonts (regular, medium, semibold, bold) are fetched from Google Fonts.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg, initWasm } from '@resvg/resvg-wasm';
import { OG_CARDS, OG_WIDTH, type OgCardKey } from '../src/lib/seo/social.ts';
import { ogSvg } from '../src/lib/seo/og-svg.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const FONT_CSS = 'https://fonts.googleapis.com/css?family=Inter:400,500,600,700';

await initWasm(readFileSync(join(root, 'node_modules/@resvg/resvg-wasm/index_bg.wasm')));
// With no browser user agent, Google Fonts answers with plain TrueType files, one per weight.
const css = await (await fetch(FONT_CSS)).text();
const fontUrls = [...css.matchAll(/src: url\((https:[^)]+\.ttf)\)/g)].map((m) => m[1]);
if (fontUrls.length < 4) throw new Error(`Expected 4 Inter font files, found ${fontUrls.length}`);
const fonts = await Promise.all(
	fontUrls.map(async (url) => {
		const res = await fetch(url);
		if (!res.ok) throw new Error(`Could not fetch ${url}: ${res.status}`);
		return new Uint8Array(await res.arrayBuffer());
	})
);

const mark =
	'data:image/png;base64,' +
	readFileSync(join(root, 'src/lib/assets/spacebot-mark.png')).toString('base64');

const outDir = join(root, 'static/og');
mkdirSync(outDir, { recursive: true });

for (const [key, card] of Object.entries(OG_CARDS)) {
	const resvg = new Resvg(ogSvg(key as OgCardKey, card, mark), {
		fitTo: { mode: 'width', value: OG_WIDTH },
		font: { fontBuffers: fonts, defaultFontFamily: 'Inter' },
	});
	const png = resvg.render().asPng();
	writeFileSync(join(outDir, `${key}.png`), png);
	console.log(`static/og/${key}.png  ${(png.length / 1024).toFixed(0)} KB`);
}
