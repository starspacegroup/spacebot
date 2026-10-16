import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// Pages push toasts from `$effect`s. A push that reads the toast list inside the
// effect subscribes the effect to it, so each push re-ran the effect and pushed
// again: "Game settings saved" stacked without end. The tests run in node, where
// effects do not run, so this guards the cause in the source.
const src = readFileSync('src/lib/toast.svelte.ts', 'utf8');

describe('toast store', () => {
	it('reads and writes the list untracked in push and dismiss', () => {
		expect(src).toContain("import { untrack } from 'svelte'");
		const push = src.slice(src.indexOf('function push'), src.indexOf('export const toast'));
		expect(push).toMatch(/untrack\(\(\) => \{\s*_items = \[\.\.\._items, item\]/);
		const dismiss = src.slice(src.indexOf('function dismiss'), src.indexOf('function push'));
		expect(dismiss).toMatch(/untrack\(\(\) => \{\s*_items = _items\.filter/);
	});
});
