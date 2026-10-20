import { describe, expect, it } from 'vitest';
import { validateManifest } from '../lib/integrations/registry.js';
import { isSafeLinkUrl } from '../lib/safe-link-url.js';

const base = { name: 'Demo', slug: 'demo' };

describe('integration manifest link fields', () => {
	it.each([
		'javascript:alert(1)',
		'JAVASCRIPT:alert(1)',
		'data:text/html,<script>alert(1)</script>',
		'file:///etc/passwd',
		'https://user:pass@example.com/',
		'http://example.com/',
		'not a url',
	])('rejects author_url/homepage = %s', (value) => {
		expect(validateManifest({ ...base, author_url: value }).ok).toBe(false);
		expect(validateManifest({ ...base, homepage: value }).ok).toBe(false);
	});

	it('accepts https and absent links', () => {
		expect(validateManifest({ ...base, author_url: 'https://example.com' }).ok).toBe(true);
		expect(validateManifest(base).ok).toBe(true);
	});

	it('render guard only allows https or loopback http', () => {
		expect(isSafeLinkUrl('https://example.com')).toBe(true);
		expect(isSafeLinkUrl('http://localhost:4269/x')).toBe(true);
		expect(isSafeLinkUrl('javascript:alert(1)')).toBe(false);
		expect(isSafeLinkUrl(undefined)).toBe(false);
	});
});
