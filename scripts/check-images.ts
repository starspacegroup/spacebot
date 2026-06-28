import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const MAX_BYTES = 750 * 1024;
const roots = ['static', 'docs/screenshots'];
let failed = false;

function walk(dir: string) {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			walk(path);
			continue;
		}
		if (!/\.(?:png|jpe?g)$/i.test(entry.name)) continue;
		const size = statSync(path).size;
		if (size > MAX_BYTES) {
			console.error(
				`${path} is ${Math.round(size / 1024)}KB; prefer WebP/AVIF or document why the source is retained.`
			);
			failed = true;
		}
	}
}

for (const root of roots) walk(root);
if (failed) process.exit(1);
console.log('Image size check passed.');
