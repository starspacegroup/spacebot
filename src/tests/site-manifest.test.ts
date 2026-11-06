import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const staticDir = resolve(process.cwd(), 'static');
const manifest = JSON.parse(readFileSync(resolve(staticDir, 'site.webmanifest'), 'utf8'));

describe('site.webmanifest', () => {
	it('has the fields browsers need to offer install', () => {
		expect(manifest.name).toBeTruthy();
		expect(manifest.start_url).toBe('/');
		expect(manifest.display).toBe('standalone');
	});

	it('points every icon at a file that exists', () => {
		for (const icon of manifest.icons) {
			expect(existsSync(resolve(staticDir, icon.src.replace(/^\//, '')))).toBe(true);
		}
	});
});
