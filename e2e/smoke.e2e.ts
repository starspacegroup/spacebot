import { expect, test } from '@playwright/test';

/**
 * Minimal smoke test against the externally-managed dev server (:4269).
 *
 * Intentionally tolerant: the landing page may render the dashboard or
 * redirect to a Discord OAuth login depending on auth state, so we only
 * assert that the app responds and renders an HTML document.
 */
test('landing page loads', async ({ page }) => {
	const response = await page.goto('/');

	// A response is returned (status may be 200 or a redirect that resolves).
	expect(response, 'expected a response from /').not.toBeNull();
	expect(response!.status()).toBeLessThan(500);

	// The document rendered some markup.
	await expect(page.locator('body')).toBeVisible();
	const title = await page.title();
	expect(title.length).toBeGreaterThan(0);
});
