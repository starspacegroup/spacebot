import { describe, it, expect } from 'vitest';
import {
	resolveEphemeralFlag,
	coerceOptionBoolean,
	parseEphemeralOptionRef,
	parseEphemeralOptionConditions,
	formatEphemeralOptionRef,
} from '../lib/db/commands.js';
import {
	validateManifest,
	normalizeTemplateEphemeral,
	templateEphemeralOptionRef,
	templateEphemeralOptionRefs,
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

	// Multiple conditions (';'-separated) across different options — OR'd.
	it('is private when ANY condition matches', () => {
		const cmd = {
			ephemeral: false,
			ephemeral_option: 'publicity=draft,community;anonymous',
		};
		// First condition matches, second present-but-false.
		expect(
			resolveEphemeralFlag(
				cmd,
				interactionWith([
					{ name: 'publicity', value: 'draft' },
					{ name: 'anonymous', value: false },
				])
			)
		).toBe(true);
		// Second condition matches, first present-but-not-listed.
		expect(
			resolveEphemeralFlag(
				cmd,
				interactionWith([
					{ name: 'publicity', value: 'listed' },
					{ name: 'anonymous', value: true },
				])
			)
		).toBe(true);
		// Neither matches.
		expect(
			resolveEphemeralFlag(
				cmd,
				interactionWith([
					{ name: 'publicity', value: 'listed' },
					{ name: 'anonymous', value: false },
				])
			)
		).toBe(false);
	});

	it('mixes negated and plain conditions', () => {
		const cmd = { ephemeral: false, ephemeral_option: '!public;tier=free' };
		// public off → private
		expect(resolveEphemeralFlag(cmd, interactionWith([{ name: 'public', value: false }]))).toBe(
			true
		);
		// public on, but tier is free → still private (OR)
		expect(
			resolveEphemeralFlag(
				cmd,
				interactionWith([
					{ name: 'public', value: true },
					{ name: 'tier', value: 'free' },
				])
			)
		).toBe(true);
		// public on and tier pro → public
		expect(
			resolveEphemeralFlag(
				cmd,
				interactionWith([
					{ name: 'public', value: true },
					{ name: 'tier', value: 'pro' },
				])
			)
		).toBe(false);
	});

	it('skips conditions whose option was omitted, keeping the others live', () => {
		const cmd = { ephemeral: true, ephemeral_option: 'publicity=draft;anonymous' };
		// Only `anonymous` supplied and it is off → an evaluated condition decided: public.
		expect(
			resolveEphemeralFlag(cmd, interactionWith([{ name: 'anonymous', value: false }]))
		).toBe(false);
		// Only `publicity` supplied and it matches → private.
		expect(
			resolveEphemeralFlag(cmd, interactionWith([{ name: 'publicity', value: 'draft' }]))
		).toBe(true);
	});

	it('falls back to the static default only when EVERY option is omitted', () => {
		const cmd = { ephemeral: true, ephemeral_option: 'publicity=draft;anonymous' };
		expect(resolveEphemeralFlag(cmd, interactionWith([]))).toBe(true);
		expect(
			resolveEphemeralFlag(
				{ ...cmd, ephemeral: false },
				interactionWith([{ name: 'unrelated', value: 'x' }])
			)
		).toBe(false);
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
	it('returns the first condition of a multi-condition ref', () => {
		expect(parseEphemeralOptionRef('publicity=draft;anonymous')).toEqual({
			name: 'publicity',
			negate: false,
			values: ['draft'],
		});
	});
});

describe('parseEphemeralOptionConditions', () => {
	it('splits on ";" and parses each condition', () => {
		expect(parseEphemeralOptionConditions('publicity=draft,community;!public')).toEqual([
			{ name: 'publicity', negate: false, values: ['draft', 'community'] },
			{ name: 'public', negate: true, values: null },
		]);
	});
	it('drops unparseable conditions and returns [] for nothing usable', () => {
		expect(parseEphemeralOptionConditions('private;;=orphan')).toEqual([
			{ name: 'private', negate: false, values: null },
		]);
		expect(parseEphemeralOptionConditions('')).toEqual([]);
		expect(parseEphemeralOptionConditions(null)).toEqual([]);
	});
});

describe('formatEphemeralOptionRef', () => {
	it('round-trips a multi-condition ref', () => {
		const ref = 'publicity=draft,community;!public';
		expect(formatEphemeralOptionRef(parseEphemeralOptionConditions(ref))).toBe(ref);
	});
	it('drops incomplete rows (no name, or equality form with no values)', () => {
		expect(
			formatEphemeralOptionRef([
				{ name: '', negate: false, values: null },
				{ name: 'publicity', negate: false, values: [] },
				{ name: 'private', negate: false, values: null },
			])
		).toBe('private');
	});
	it('returns null when nothing usable remains', () => {
		expect(formatEphemeralOptionRef([{ name: 'publicity', negate: false, values: [] }])).toBe(
			null
		);
		expect(formatEphemeralOptionRef([])).toBe(null);
		expect(formatEphemeralOptionRef(null)).toBe(null);
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

describe('templateEphemeralOptionRefs', () => {
	it('returns every option a multi-condition ref names', () => {
		expect(
			templateEphemeralOptionRefs({
				ephemeral_option: 'publicity=draft,community;!anonymous',
			})
		).toEqual(['publicity', 'anonymous']);
	});
	it('is empty for a static boolean', () => {
		expect(templateEphemeralOptionRefs({ ephemeral: true })).toEqual([]);
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
