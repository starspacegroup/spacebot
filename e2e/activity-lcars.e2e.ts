import { expect, test } from '@playwright/test';

/**
 * The Activity's LCARS screens, through the dev-only `?preview=` states (stripped
 * from production builds), against the externally-managed dev server.
 */

test('the active module is plain: enlarged, marked, and the only current tab', async ({ page }) => {
	await page.goto('/activity?preview=game-round');
	const nav = page.getByRole('navigation', { name: 'Modules' });
	await expect(nav.getByRole('button')).toHaveText(['Timebox', 'Agent', 'Quorum']);
	await expect(nav.locator('[aria-current="page"]')).toHaveText('Agent');
	// SpaceBot is a brand block, not a tab.
	await expect(nav.getByRole('button', { name: 'SpaceBot' })).toHaveCount(0);
	await expect(page.locator('h1')).toHaveText(/Agent · Round/i);
});

test('the viewer has their own badge and is not in the roster', async ({ page }) => {
	await page.goto('/activity?preview=game-round');
	const roster = page.getByRole('list', { name: 'Players' });
	await expect(roster.getByRole('listitem')).toHaveCount(5);
	await expect(roster).not.toContainText('a-rather-long-display-name-here');
	await expect(page.locator('.self')).toContainText('Crew · 1 vote call left');
});

test('the vote screen shows your pick and that votes are secret', async ({ page }) => {
	await page.goto('/activity?preview=game-vote');
	await expect(page.locator('.banner')).toContainText('Your vote');
	await expect(page.locator('.banner')).toContainText('Orion');
	await expect(page.getByRole('button', { name: /Orion/ })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await expect(page.getByText(/no one sees who voted for whom/i)).toBeVisible();
	await expect(page.getByRole('button', { name: 'Skip instead' })).toBeVisible();
});

test('the role cards: crew sees the word, the agent does not', async ({ page }) => {
	await page.goto('/activity?preview=game-crew');
	await expect(page.getByRole('heading', { name: /You are Crew/i })).toBeVisible();
	await expect(page.getByText('nebula')).toBeVisible();
	await page.goto('/activity?preview=game-agent');
	await expect(page.getByRole('heading', { name: /You are the Agent/i })).toBeVisible();
	await expect(page.getByText('nebula')).toHaveCount(0);
});

for (const kind of ['game-lobby', 'game-vote', 'game-crew-win', 'quorum', 'guild']) {
	test(`${kind} has no horizontal overflow on a phone`, async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto(`/activity?preview=${kind}`);
		const overflow = await page.evaluate(
			() => document.documentElement.scrollWidth > window.innerWidth + 1
		);
		expect(overflow).toBe(false);
	});
}
