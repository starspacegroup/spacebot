import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

// `use:enhance` resets a form after a successful save. The fields here are set as
// properties, so a reset blanks them: "Save game settings" emptied the form. Every
// form on the page, and in each game's card and settings panel, has to keep what
// was typed. Effects and forms do not run in the node tests, so this guards the
// cause in the source.
const page = readFileSync('src/routes/admin/[serverId]/activity/+page.svelte', 'utf8');
const panelDir = 'src/lib/components/activity-admin';
const panels = readdirSync(panelDir)
	.filter((f) => f.endsWith('.svelte'))
	.map((f) => [f, readFileSync(`${panelDir}/${f}`, 'utf8')] as const);

describe('Activity dashboard forms', () => {
	it('never reset after a save', () => {
		expect(page).toContain('update({ reset: false })');
		const forms = page.match(/<form[^>]*>/g) ?? [];
		expect(forms.length).toBeGreaterThan(0);
		for (const tag of forms) expect(tag).toContain('use:enhance={keepValues}');
	});

	it('the same in every game card and settings panel', () => {
		expect(panels.length).toBeGreaterThan(0);
		for (const [name, src] of panels) {
			for (const tag of src.match(/<form[^>]*>/g) ?? []) {
				expect(tag, name).toContain('use:enhance={keepValues}');
			}
		}
	});
});
