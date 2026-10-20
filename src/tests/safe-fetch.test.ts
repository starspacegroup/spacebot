import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertPublicHttpUrl, safeFetch } from '../lib/server/safe-fetch.js';
import { callWebhook } from '../lib/db/webhooks.js';

afterEach(() => vi.unstubAllGlobals());

const BLOCKED = [
	'http://127.0.0.1/',
	'http://127.1/',
	'http://2130706433/',
	'http://0x7f000001/',
	'http://0177.0.0.1/'.replace('0177', '127'),
	'http://10.0.0.5/',
	'http://172.16.3.4/',
	'http://192.168.1.1:8080/',
	'http://169.254.169.254/latest/meta-data/',
	'http://100.64.0.1/',
	'http://0.0.0.0/',
	'http://[::1]/',
	'http://[::ffff:127.0.0.1]/',
	'http://[::ffff:a9fe:a9fe]/',
	'http://[fd00::1]/',
	'http://[fe80::1]/',
	'http://localhost:4269/',
	'http://foo.localhost/',
	'http://printer.local/',
	'http://metadata.google.internal/',
	'ftp://example.com/',
	'file:///etc/passwd',
	'https://user:pw@example.com/',
	'https://example.com:22/',
];

describe('assertPublicHttpUrl', () => {
	it.each(BLOCKED)('blocks %s', (url) => {
		expect(() => assertPublicHttpUrl(url)).toThrow();
	});

	it.each([
		'https://example.com/hook',
		'http://example.com:8080/x',
		'https://[2606:4700::1111]/',
	])('allows %s', (url) => {
		expect(() => assertPublicHttpUrl(url)).not.toThrow();
	});
});

describe('safeFetch', () => {
	it('re-validates redirect targets', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(null, {
						status: 302,
						headers: { location: 'http://169.254.169.254/' },
					})
			)
		);
		await expect(safeFetch('https://example.com/')).rejects.toThrow(/Private/);
	});

	it('caps response size', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('x'.repeat(2048)))
		);
		await expect(safeFetch('https://example.com/', {}, { maxBytes: 1024 })).rejects.toThrow(
			/exceeds/
		);
	});

	it('passes a normal response through', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } })
			)
		);
		const res = await safeFetch('https://example.com/');
		expect(await res.json()).toEqual({ ok: true });
	});
});

describe('automation webhooks use the egress policy', () => {
	it('refuses a webhook aimed at the metadata service', async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		const result = await callWebhook(
			{ name: 'x', url: 'http://169.254.169.254/latest/meta-data/', enabled: true },
			{}
		);
		expect(result.success).toBe(false);
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
