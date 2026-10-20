/**
 * Outbound requests to tenant- or integration-chosen URLs (security review
 * 2026-10-20, #12).
 *
 * Automation webhooks, integration handlers, manifests and health probes used
 * to `fetch()` whatever URL was stored. The gateway runs on a host inside a
 * private network, so that reached loopback services, the LAN and cloud
 * metadata endpoints. Every such request now goes through `safeFetch`:
 *
 * - http(s) only, default ports or 1024+, no embedded credentials;
 * - hostnames that are, or obviously point at, loopback / private / link-local
 *   / reserved addresses are refused (IPv4, IPv6, IPv4-mapped, decimal/hex
 *   forms, `localhost`, `*.local`, `*.internal`);
 * - redirects are followed manually and every hop is re-validated;
 * - a timeout and a response-size cap always apply.
 *
 * Residual: a public hostname whose DNS answer is private (rebinding) is not
 * caught here — Workers has no pre-connect DNS hook. Local development can set
 * OUTBOUND_ALLOW_PRIVATE=true to reach integrations on localhost.
 */

export class EgressBlockedError extends Error {}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BYTES = 1024 * 1024;
const MAX_REDIRECTS = 3;

function allowPrivateEgress(): boolean {
	return typeof process !== 'undefined' && process.env?.OUTBOUND_ALLOW_PRIVATE === 'true';
}

function parseIPv4(host: string): number[] | null {
	const parts = host.split('.');
	if (parts.length < 1 || parts.length > 4) return null;
	const nums: number[] = [];
	for (const part of parts) {
		if (!/^(0x[0-9a-f]+|\d+)$/i.test(part)) return null;
		nums.push(Number(part));
	}
	// inet_aton forms: a, a.b, a.b.c expand the last part across remaining bytes
	const last = nums.pop()!;
	const bytes = [...nums];
	const remaining = 4 - bytes.length;
	for (let i = remaining - 1; i >= 0; i--) bytes.push(Math.floor(last / 256 ** i) % 256);
	if (bytes.some((b) => !Number.isInteger(b) || b < 0 || b > 255)) return null;
	return bytes;
}

function isPrivateIPv4([a, b]: number[]): boolean {
	return (
		a === 0 ||
		a === 10 ||
		a === 127 ||
		(a === 100 && b >= 64 && b <= 127) ||
		(a === 169 && b === 254) ||
		(a === 172 && b >= 16 && b <= 31) ||
		(a === 192 && b === 168) ||
		(a === 192 && b === 0) ||
		(a === 198 && (b === 18 || b === 19)) ||
		a >= 224
	);
}

function isPrivateIPv6(host: string): boolean {
	const h = host.toLowerCase();
	if (h === '::' || h === '::1') return true;
	const mapped = /^::ffff:(?:0:)?([0-9.]+)$/.exec(h);
	if (mapped) {
		const v4 = parseIPv4(mapped[1]);
		return !v4 || isPrivateIPv4(v4);
	}
	const mappedHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(h);
	if (mappedHex) {
		const hi = parseInt(mappedHex[1], 16);
		const lo = parseInt(mappedHex[2], 16);
		return isPrivateIPv4([hi >> 8, hi & 255, lo >> 8, lo & 255]);
	}
	return /^(fc|fd|fe[89ab]|ff)/.test(h) || h.startsWith('64:ff9b:') || h.startsWith('2001:db8');
}

export function assertPublicHttpUrl(raw: string | URL): URL {
	let url: URL;
	try {
		url = new URL(String(raw));
	} catch {
		throw new EgressBlockedError('Invalid URL');
	}
	if (url.protocol !== 'https:' && url.protocol !== 'http:') {
		throw new EgressBlockedError(`Scheme ${url.protocol} is not allowed`);
	}
	if (url.username || url.password)
		throw new EgressBlockedError('Credentials in URL are not allowed');
	if (url.port && Number(url.port) < 1024 && !['80', '443'].includes(url.port)) {
		throw new EgressBlockedError(`Port ${url.port} is not allowed`);
	}
	if (allowPrivateEgress()) return url;

	const host = url.hostname
		.replace(/^\[|\]$/g, '')
		.replace(/\.$/, '')
		.toLowerCase();
	if (
		!host ||
		host === 'localhost' ||
		host.endsWith('.localhost') ||
		host.endsWith('.local') ||
		host.endsWith('.internal') ||
		host === 'metadata.google.internal'
	) {
		throw new EgressBlockedError('Private host is not allowed');
	}
	if (host.includes(':')) {
		if (isPrivateIPv6(host)) throw new EgressBlockedError('Private address is not allowed');
		return url;
	}
	const v4 = parseIPv4(host);
	if (v4 && isPrivateIPv4(v4)) throw new EgressBlockedError('Private address is not allowed');
	return url;
}

async function readCapped(response: Response, maxBytes: number): Promise<Uint8Array<ArrayBuffer>> {
	const declared = Number(response.headers.get('content-length'));
	if (Number.isFinite(declared) && declared > maxBytes) {
		await response.body?.cancel();
		throw new EgressBlockedError(`Response exceeds ${maxBytes} bytes`);
	}
	if (!response.body) return new Uint8Array();
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > maxBytes) {
			await reader.cancel();
			throw new EgressBlockedError(`Response exceeds ${maxBytes} bytes`);
		}
		chunks.push(value);
	}
	const out = new Uint8Array(total);
	let offset = 0;
	for (const c of chunks) {
		out.set(c, offset);
		offset += c.byteLength;
	}
	return out;
}

export async function safeFetch(
	raw: string | URL,
	init: RequestInit = {},
	{ timeoutMs = DEFAULT_TIMEOUT_MS, maxBytes = DEFAULT_MAX_BYTES } = {}
): Promise<Response> {
	const signal = init.signal ?? AbortSignal.timeout(timeoutMs);
	let url = assertPublicHttpUrl(raw);
	let currentInit: RequestInit = { ...init, signal, redirect: 'manual' };

	for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
		const response = await fetch(url, currentInit);
		const location = response.headers.get('location');
		if (response.status >= 300 && response.status < 400 && location) {
			await response.body?.cancel();
			url = assertPublicHttpUrl(new URL(location, url));
			if (
				response.status === 303 ||
				((response.status === 301 || response.status === 302) &&
					currentInit.method &&
					currentInit.method !== 'GET')
			) {
				currentInit = { ...currentInit, method: 'GET', body: undefined };
			}
			continue;
		}
		const body = await readCapped(response, maxBytes);
		return new Response(response.status === 204 || response.status === 304 ? null : body, {
			status: response.status,
			statusText: response.statusText,
			headers: response.headers,
		});
	}
	throw new EgressBlockedError('Too many redirects');
}
