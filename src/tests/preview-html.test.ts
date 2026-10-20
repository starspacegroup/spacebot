import { describe, expect, it } from 'vitest';
import { escapeHtml, previewLink } from '../lib/preview-html.js';

function renderLink(markdown: string) {
	return escapeHtml(markdown).replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, text, url) =>
		previewLink(text, url)
	);
}

function parse(html: string) {
	const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
	return doc.body.firstElementChild!;
}

describe('message preview links', () => {
	it('quotes in the URL cannot open an attribute', () => {
		const html = renderLink('[x](https://a.example/" onmouseover="alert(1))');
		expect(html).not.toMatch(/"\s*onmouseover=/);
		expect(html).not.toContain('" onmouseover');
	});

	it.each([
		'[x](javascript:alert(1))',
		'[x](data:text/html,<script>alert(1)</script>)',
		'[x](JaVaScRiPt:alert(1))',
		"[x](' onfocus='alert(1))",
	])('%s renders as text, not a link', (md) => {
		expect(renderLink(md)).not.toContain('<a ');
	});

	it('http(s) links still render', () => {
		const html = renderLink('[docs](https://spacebot.example/a?b=1&c=2)');
		expect(html).toContain(
			'<a class="preview-link" href="https://spacebot.example/a?b=1&amp;c=2"'
		);
	});

	it.each(['"', "'", '<', '>', '&'])('escapeHtml neutralises %s', (ch) => {
		expect(escapeHtml(`a${ch}b`)).not.toContain(ch === '&' ? 'a&b' : ch);
	});
});

if (typeof DOMParser !== 'undefined') {
	it('no event-handler attribute survives parsing', () => {
		const el = parse(renderLink('[x](https://a/" onclick="alert(1))'));
		for (const node of el.querySelectorAll('*')) {
			expect([...node.attributes].some((a) => a.name.startsWith('on'))).toBe(false);
		}
	});
}
