/**
 * Draw every share card to `static/og/<name>.png`. Run it after changing a card in
 * `src/lib/seo/social.ts`, the template in `src/lib/seo/og-svg.ts` or the mark, and commit the PNGs:
 *
 *   bun scripts/generate-og-cards.ts
 *
 * Cards are drawn here, not on request, because Cloudflare Workers will not compile WebAssembly
 * from bytes at runtime. The Inter font is fetched once from Google Fonts.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg, initWasm } from '@resvg/resvg-wasm';
import { OG_CARDS, OG_WIDTH } from '../src/lib/seo/social.ts';
import { ogSvg } from '../src/lib/seo/og-svg.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const FONT_URL =
	'https://fonts.gstatic.com/s/inter/v18/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuLyfMZhrib2Bg-4.ttf';

await initWasm(readFileSync(join(root, 'node_modules/@resvg/resvg-wasm/index_bg.wasm')));
const fontResponse = await fetch(FONT_URL);
if (!fontResponse.ok) throw new Error(`Could not fetch the Inter font: ${fontResponse.status}`);
const font = new Uint8Array(await fontResponse.arrayBuffer());

const mark =
	'data:image/png;base64,' +
	readFileSync(join(root, 'src/lib/assets/spacebot-mark.png')).toString('base64');

const outDir = join(root, 'static/og');
mkdirSync(outDir, { recursive: true });

for (const [key, card] of Object.entries(OG_CARDS)) {
	const resvg = new Resvg(ogSvg(card, mark), {
		fitTo: { mode: 'width', value: OG_WIDTH },
		font: { fontBuffers: [font], defaultFontFamily: 'Inter' },
	});
	const png = resvg.render().asPng();
	writeFileSync(join(outDir, `${key}.png`), png);
	console.log(`static/og/${key}.png  ${(png.length / 1024).toFixed(0)} KB`);
}
