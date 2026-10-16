import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// `use:enhance` resets a form after a successful save. The fields here are set as
// properties, so a reset blanks them: "Save game settings" emptied the form. Every
// form on the page has to keep what was typed. Effects and forms do not run in the
// node tests, so this guards the cause in the source.
const page = readFileSync('src/routes/admin/[serverId]/activity/+page.svelte', 'utf8');

describe('Activity dashboard forms', () => {
	it('never reset after a save', () => {
		expect(page).toContain('update({ reset: false })');
		const forms = page.match(/<form[^>]*>/g) ?? [];
		expect(forms.length).toBeGreaterThan(0);
		for (const tag of forms) expect(tag).toContain('use:enhance={keepValues}');
	});
});
