import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The consent form must carry the query string it was opened with.
 *
 * `approve` in `+page.server.ts` deliberately re-resolves client_id,
 * redirect_uri, scope and state from `url.searchParams` rather than trusting
 * form fields — "the form's hidden fields are a convenience for rendering,
 * never the authority". A bare `action="?/approve"` REPLACES the query string,
 * so that re-resolution found nothing and every single approval failed with
 * "This link is missing its client_id or redirect_uri". The page rendered
 * perfectly right up to the moment somebody pressed the button.
 *
 * There is no component-test setup in this repo and one is not worth adding
 * for this, so the guard reads the source.
 */
const page = readFileSync(
	join(import.meta.dirname, '..', 'routes', 'connect', '+page.svelte'),
	'utf8'
);

describe('connect consent form', () => {
	it('does not post to a bare ?/approve', () => {
		// Scoped to the tag, because the comment above the form legitimately
		// quotes the broken version.
		expect(page).not.toMatch(/<form[^>]*action="\?\/approve"/);
	});

	it('posts to an action built from the current search string', () => {
		expect(page).toMatch(/action=\{approveAction\}/);
		expect(page).toMatch(/page\.url\.search.*\/approve/);
	});

	it('still resolves the request from the URL, not from form fields', () => {
		const server = readFileSync(
			join(import.meta.dirname, '..', 'routes', 'connect', '+page.server.ts'),
			'utf8'
		);
		// If this ever reads client_id out of formData instead, the guard above
		// stops meaning anything and the security note needs revisiting.
		expect(server).toMatch(/resolveRequest\(db, url\)/);
	});
});
