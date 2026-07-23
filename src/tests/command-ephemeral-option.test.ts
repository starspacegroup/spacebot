import { describe, it, expect } from 'vitest';
import {
	resolveEphemeralFlag,
	coerceOptionBoolean,
	parseEphemeralOptionRef,
} from '../lib/db/commands.js';
import {
	validateManifest,
	normalizeTemplateEphemeral,
	templateEphemeralOptionRef,
} from '../lib/integrations/registry.js';

/** A slash-command interaction carrying the given option name/value. */
function interactionWith(options: Array<{ name: string; value: any }>) {
	return { data: { name: 'verse', options } };
}

describe('coerceOptionBoolean', () => {
	it('passes real booleans through', () => {
		expect(coerceOptionBoolean(true)).toBe(true);
		expect(coerceOptionBoolean(false)).toBe(false);
	});
	it('treats missing as false', () => {
		expect(coerceOptionBoolean(undefined)).toBe(false);
		expect(coerceOptionBoolean(null)).toBe(false);
	});
	it('accepts common string/number truthy forms', () => {
		for (const v of ['true', 'TRUE', 'yes', '1', 'on', ' On ']) {
			expect(coerceOptionBoolean(v)).toBe(true);
		}
		for (const v of ['false', 'no', '0', '', 'public']) {
			expect(coerceOptionBoolean(v)).toBe(false);
		}
		expect(coerceOptionBoolean(1)).toBe(true);
		expect(coerceOptionBoolean(0)).toBe(false);
	});
});

describe('resolveEphemeralFlag', () => {
	it('returns the static boolean when no ref is set', () => {
		expect(resolveEphemeralFlag({ ephemeral: true }, interactionWith([]))).toBe(true);
		expect(resolveEphemeralFlag({ ephemeral: false }, interactionWith([]))).toBe(false);
	});

	it('is driven by the referenced boolean option', () => {
		const cmd = { ephemeral: false, ephemeral_option: 'private' };
		expect(resolveEphemeralFlag(cmd, interactionWith([{ name: 'private', value: true }]))).toBe(
			true
		);
		expect(
			resolveEphemeralFlag(cmd, interactionWith([{ name: 'private', value: false }]))
		).toBe(false);
	});

	it('accepts the "option:" prefix form', () => {
		const cmd = { ephemeral: false, ephemeral_option: 'option:private' };
		expect(resolveEphemeralFlag(cmd, interactionWith([{ name: 'private', value: true }]))).toBe(
			true
		);
	});

	it('supports negation for a "make it public" toggle', () => {
		const cmd = { ephemeral: true, ephemeral_option: '!public' };
		// public=true → not ephemeral
		expect(resolveEphemeralFlag(cmd, interactionWith([{ name: 'public', value: true }]))).toBe(
			false
		);
		// public=false → ephemeral
		expect(resolveEphemeralFlag(cmd, interactionWith([{ name: 'public', value: false }]))).toBe(
			true
		);
	});

	it('falls back to the static default when the option is omitted', () => {
		// User didn't supply the optional arg.
		expect(
			resolveEphemeralFlag(
				{ ephemeral: true, ephemeral_option: 'private' },
				interactionWith([])
			)
		).toBe(true);
		expect(
			resolveEphemeralFlag(
				{ ephemeral: false, ephemeral_option: 'private' },
				interactionWith([])
			)
		).toBe(false);
	});

	it('is idempotent once collapsed (ref cleared)', () => {
		expect(
			resolveEphemeralFlag({ ephemeral: true, ephemeral_option: null }, interactionWith([]))
		).toBe(true);
	});

	it('ignores a non-string ref', () => {
		expect(
			resolveEphemeralFlag({ ephemeral: true, ephemeral_option: 123 }, interactionWith([]))
		).toBe(true);
	});

	// Choice / "multi" options: match the selected value against one or more choices.
	it('matches a choice option value (name=value form)', () => {
		const cmd = { ephemeral: false, ephemeral_option: 'visibility=private' };
		expect(
			resolveEphemeralFlag(cmd, interactionWith([{ name: 'visibility', value: 'private' }]))
		).toBe(true);
		expect(
			resolveEphemeralFlag(cmd, interactionWith([{ name: 'visibility', value: 'public' }]))
		).toBe(false);
	});

	it('accepts the option: prefix and is case-insensitive on the value', () => {
		const cmd = { ephemeral: false, ephemeral_option: 'option:visibility=private' };
		expect(
			resolveEphemeralFlag(cmd, interactionWith([{ name: 'visibility', value: 'PRIVATE' }]))
		).toBe(true);
	});

	it('matches any of several listed choice values', () => {
		const cmd = { ephemeral: false, ephemeral_option: 'visibility=private,secret' };
		for (const v of ['private', 'secret']) {
			expect(
				resolveEphemeralFlag(cmd, interactionWith([{ name: 'visibility', value: v }]))
			).toBe(true);
		}
		expect(
			resolveEphemeralFlag(cmd, interactionWith([{ name: 'visibility', value: 'public' }]))
		).toBe(false);
	});

	it('matches integer choice values (stringified)', () => {
		const cmd = { ephemeral: false, ephemeral_option: 'tier=3' };
		expect(resolveEphemeralFlag(cmd, interactionWith([{ name: 'tier', value: 3 }]))).toBe(true);
		expect(resolveEphemeralFlag(cmd, interactionWith([{ name: 'tier', value: 1 }]))).toBe(
			false
		);
	});

	it('negates the equality form', () => {
		const cmd = { ephemeral: true, ephemeral_option: '!tier=free' };
		// free → not ephemeral
		expect(resolveEphemeralFlag(cmd, interactionWith([{ name: 'tier', value: 'free' }]))).toBe(
			false
		);
		// anything else → ephemeral
		expect(resolveEphemeralFlag(cmd, interactionWith([{ name: 'tier', value: 'pro' }]))).toBe(
			true
		);
	});

	it('falls back to the default when a choice option is omitted', () => {
		const cmd = { ephemeral: true, ephemeral_option: 'visibility=private' };
		expect(resolveEphemeralFlag(cmd, interactionWith([]))).toBe(true);
	});
});

describe('parseEphemeralOptionRef', () => {
	it('parses the boolean form', () => {
		expect(parseEphemeralOptionRef('private')).toEqual({
			name: 'private',
			negate: false,
			values: null,
		});
		expect(parseEphemeralOptionRef('!option:public')).toEqual({
			name: 'public',
			negate: true,
			values: null,
		});
	});
	it('parses the equality form with one or more values', () => {
		expect(parseEphemeralOptionRef('visibility=private')).toEqual({
			name: 'visibility',
			negate: false,
			values: ['private'],
		});
		expect(parseEphemeralOptionRef('!visibility=private, Secret ')).toEqual({
			name: 'visibility',
			negate: true,
			values: ['private', 'secret'],
		});
	});
	it('returns null for empty / non-string / orphan value', () => {
		expect(parseEphemeralOptionRef('')).toBe(null);
		expect(parseEphemeralOptionRef(null)).toBe(null);
		expect(parseEphemeralOptionRef('=orphan')).toBe(null);
	});
});

describe('templateEphemeralOptionRef', () => {
	it('returns null for static / absent', () => {
		expect(templateEphemeralOptionRef({ ephemeral: true })).toBe(null);
		expect(templateEphemeralOptionRef({})).toBe(null);
	});
	it('extracts the bare option name from every ref form', () => {
		expect(templateEphemeralOptionRef({ ephemeral: 'private' })).toBe('private');
		expect(templateEphemeralOptionRef({ ephemeral: 'option:private' })).toBe('private');
		expect(templateEphemeralOptionRef({ ephemeral: '!public' })).toBe('public');
		expect(templateEphemeralOptionRef({ ephemeral_option: '!option:public' })).toBe('public');
	});
	it('strips the =value match suffix (choice form)', () => {
		expect(templateEphemeralOptionRef({ ephemeral: 'visibility=private' })).toBe('visibility');
		expect(templateEphemeralOptionRef({ ephemeral_option: '!visibility=private,secret' })).toBe(
			'visibility'
		);
	});
	it('prefers the explicit ephemeral_option field', () => {
		expect(templateEphemeralOptionRef({ ephemeral: 'a', ephemeral_option: 'b' })).toBe('b');
	});
});

describe('normalizeTemplateEphemeral', () => {
	it('keeps a static boolean', () => {
		expect(normalizeTemplateEphemeral({ ephemeral: true })).toEqual({
			ephemeral: true,
			ephemeral_option: null,
		});
	});
	it('turns a string ephemeral into an option ref (default fallback public)', () => {
		expect(normalizeTemplateEphemeral({ ephemeral: 'option:private' })).toEqual({
			ephemeral: false,
			ephemeral_option: 'option:private',
		});
	});
	it('honors the explicit two-field form with a boolean fallback', () => {
		expect(
			normalizeTemplateEphemeral({ ephemeral: true, ephemeral_option: '!public' })
		).toEqual({ ephemeral: true, ephemeral_option: '!public' });
	});
});

describe('validateManifest — command template ephemeral refs', () => {
	const base = { name: 'AgapeVerse', slug: 'agapeverse' };

	it('accepts a template whose ephemeral ref names a declared option', () => {
		const manifest = {
			...base,
			command_templates: [
				{
					key: 'agapeverse.verse',
					name: 'verse',
					description: 'Generate a poem',
					options: [{ name: 'private', type: 5, description: 'Keep it to yourself' }],
					ephemeral: 'option:private',
				},
			],
		};
		expect(validateManifest(manifest)).toEqual({ ok: true });
	});

	it('rejects a template whose ephemeral ref names an undeclared option', () => {
		const manifest = {
			...base,
			command_templates: [
				{
					key: 'agapeverse.verse',
					name: 'verse',
					description: 'Generate a poem',
					options: [{ name: 'theme', type: 3, description: 'What about' }],
					ephemeral: 'option:private',
				},
			],
		};
		const result = validateManifest(manifest);
		expect(result.ok).toBe(false);
		expect(result.error).toContain('private');
	});

	it('accepts a choice-equality ref against a declared choice option', () => {
		const manifest = {
			...base,
			command_templates: [
				{
					key: 'agapeverse.verse',
					name: 'verse',
					description: 'Generate a poem',
					options: [
						{
							name: 'visibility',
							type: 3,
							description: 'Who sees it',
							choices: [
								{ name: 'Public', value: 'public' },
								{ name: 'Private', value: 'private' },
							],
						},
					],
					ephemeral: 'visibility=private',
				},
			],
		};
		expect(validateManifest(manifest)).toEqual({ ok: true });
	});

	it('rejects a choice-equality ref to an undeclared option', () => {
		const manifest = {
			...base,
			command_templates: [
				{
					key: 'agapeverse.verse',
					name: 'verse',
					description: 'Generate a poem',
					options: [{ name: 'theme', type: 3, description: 'What about' }],
					ephemeral: 'visibility=private',
				},
			],
		};
		const result = validateManifest(manifest);
		expect(result.ok).toBe(false);
		expect(result.error).toContain('visibility');
	});

	it('still accepts a static-boolean template', () => {
		const manifest = {
			...base,
			command_templates: [
				{ key: 'agapeverse.verse', name: 'verse', description: 'x', ephemeral: true },
			],
		};
		expect(validateManifest(manifest)).toEqual({ ok: true });
	});
});
