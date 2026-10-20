/**
 * Escaping for the Discord message preview, which builds markup by string
 * replacement and renders it with {@html} (security review 2026-10-20, #15).
 * Text is escaped for attribute context too (quotes), and links render only
 * for http(s) URLs.
 */

export function escapeHtml(text: string): string {
	return String(text)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

function decodeEntities(text: string): string {
	return text
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&amp;/g, '&');
}

/** `escapedText` and `escapedUrl` are already HTML-escaped preview fragments. */
export function previewLink(escapedText: string, escapedUrl: string): string {
	const url = decodeEntities(escapedUrl.replace(/<[^>]+>/g, '')).trim();
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return escapedText;
	}
	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return escapedText;
	return `<a class="preview-link" href="${escapeHtml(parsed.href)}" target="_blank" rel="noopener noreferrer">${escapedText}</a>`;
}
