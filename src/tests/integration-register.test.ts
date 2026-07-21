import { describe, it, expect } from 'vitest';
import { validateManifest, resolveManifestUrl } from '../lib/integrations/registry.js';

describe('validateManifest', () => {
	const base = { name: 'AgapeVerse', slug: 'agapeverse' };

	it('accepts a minimal valid manifest', () => {
		expect(validateManifest(base).ok).toBe(true);
	});

	it('requires name and slug', () => {
		expect(validateManifest({ name: 'x' }).ok).toBe(false);
		expect(validateManifest({ slug: 'x' }).ok).toBe(false);
	});

	it('rejects a malformed slug', () => {
		expect(validateManifest({ name: 'X', slug: 'Not Valid' }).ok).toBe(false);
		expect(validateManifest({ name: 'X', slug: 'UPPER' }).ok).toBe(false);
	});

	it('requires actions to be namespaced with the slug', () => {
		const bad = { ...base, actions: [{ key: 'generate_poem' }] };
		const res = validateManifest(bad);
		expect(res.ok).toBe(false);
		expect(res.error).toMatch(/namespaced/);
	});

	it('accepts namespaced actions', () => {
		const ok = { ...base, actions: [{ key: 'agapeverse.generate_poem' }] };
		expect(validateManifest(ok).ok).toBe(true);
	});

	it('requires events to be namespaced with the slug', () => {
		const bad = { ...base, events: [{ type: 'poem_created' }] };
		expect(validateManifest(bad).ok).toBe(false);
	});

	it('rejects an integration spoofing another namespace', () => {
		const bad = { ...base, events: [{ type: 'github.push' }] };
		expect(validateManifest(bad).ok).toBe(false);
	});

	it('validates array-typed fields', () => {
		expect(validateManifest({ ...base, actions: {} }).ok).toBe(false);
		expect(validateManifest({ ...base, command_templates: 'x' }).ok).toBe(false);
	});
});

describe('resolveManifestUrl', () => {
	it('appends the discovery path to a service origin', () => {
		expect(resolveManifestUrl('https://agapeverse.app')).toBe(
			'https://agapeverse.app/spacebot-integration.json'
		);
	});

	it('strips a trailing slash before appending', () => {
		expect(resolveManifestUrl('https://agapeverse.app/')).toBe(
			'https://agapeverse.app/spacebot-integration.json'
		);
	});

	it('uses a full .json URL as-is', () => {
		expect(resolveManifestUrl('https://agapeverse.app/custom/manifest.json')).toBe(
			'https://agapeverse.app/custom/manifest.json'
		);
	});

	it('rejects non-URLs and non-http(s) schemes', () => {
		expect(resolveManifestUrl('not a url')).toBeNull();
		expect(resolveManifestUrl('ftp://agapeverse.app')).toBeNull();
	});
});
