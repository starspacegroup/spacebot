/**
 * Response headers for runner artifacts (security review 2026-10-20, #6).
 *
 * The MIME type is runner-declared, so it must never select active content on
 * our origin. Only raster images whose bytes match their declared type render
 * inline; everything else (HTML, SVG, XML, unknown) downloads as an opaque
 * attachment. The sandbox CSP is a second wall if a browser renders anyway.
 */

const INLINE_RASTER_SIGNATURES: Record<string, (b: Uint8Array) => boolean> = {
	'image/png': (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
	'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
	'image/gif': (b) => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38,
	'image/webp': (b) =>
		b[0] === 0x52 &&
		b[1] === 0x49 &&
		b[2] === 0x46 &&
		b[3] === 0x46 &&
		b[8] === 0x57 &&
		b[9] === 0x45 &&
		b[10] === 0x42 &&
		b[11] === 0x50,
};

export function artifactResponseHeaders(
	declaredMime: string | null | undefined,
	bytes: Uint8Array,
	artifactId: number
): Record<string, string> {
	const mime = String(declaredMime || '')
		.split(';')[0]
		.trim()
		.toLowerCase();
	const common = {
		'Cache-Control': 'private, max-age=60',
		'X-Content-Type-Options': 'nosniff',
		'Content-Security-Policy': "sandbox; default-src 'none'",
	};
	if (INLINE_RASTER_SIGNATURES[mime]?.(bytes)) {
		return { ...common, 'Content-Type': mime, 'Content-Disposition': 'inline' };
	}
	return {
		...common,
		'Content-Type': 'application/octet-stream',
		'Content-Disposition': `attachment; filename="artifact-${artifactId}"`,
	};
}

export function isSafeExternalArtifactUrl(value: string): boolean {
	try {
		const url = new URL(value);
		return url.protocol === 'https:' && !url.username && !url.password;
	} catch {
		return false;
	}
}
