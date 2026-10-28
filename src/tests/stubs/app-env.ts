// Stand-in for SvelteKit's `$app/env` under Vitest, where the kit plugin is not
// loaded. Tests that need other values mock the module with vi.doMock.
export const browser = false;
export const dev = false;
export const building = false;
export const version = 'test';
