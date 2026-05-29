/**
 * CSS contrast regression tests.
 *
 * These tests guard against using --color-text-inverse (near-white in light
 * mode) as text on semantic-color backgrounds (success, danger, warning).
 * In light mode those backgrounds are vivid but not dark, so white text has
 * ~2:1 contrast — effectively unreadable.
 *
 * The correct colour for text on those backgrounds is a dark value (#1B1730
 * or similar), NOT the theme-aware --color-text-inverse variable.
 *
 * Tests scan every .svelte and .css file under src/ and fail if they find
 * any CSS rule block that combines both patterns.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ── helpers ──────────────────────────────────────────────────────────────────

function collectFiles(dir, exts) {
	const results = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			results.push(...collectFiles(full, exts));
		} else if (exts.some(e => entry.name.endsWith(e))) {
			results.push(full);
		}
	}
	return results;
}

/**
 * Extract every CSS rule block from a file's content.
 * Works for both plain .css files and <style> blocks inside .svelte files.
 * Returns an array of { source, block } objects where `source` is the file
 * path and `block` is the raw text of one CSS declaration block.
 */
function extractCssBlocks(filePath, content) {
	const blocks = [];
	// Match balanced { ... } — enough for flat CSS rules (no nesting needed here)
	const ruleRe = /[^{}]+\{([^{}]+)\}/g;
	let match;
	while ((match = ruleRe.exec(content)) !== null) {
		blocks.push({ source: filePath, block: match[1] });
	}
	return blocks;
}

function extractStyleSlices(filePath, content) {
	if (filePath.endsWith('.css')) return [{ text: content, offset: 0 }];

	const slices = [];
	const styleRe = /<style[^>]*>([\s\S]*?)<\/style>/g;
	let match;
	while ((match = styleRe.exec(content)) !== null) {
		slices.push({ text: match[1], offset: match.index });
	}
	return slices;
}

function parseHexColour(value) {
	let hex = value.slice(1);
	if (hex.length === 3 || hex.length === 4) {
		hex = hex.split('').map(ch => ch + ch).join('');
	}
	if (hex.length === 6) {
		return {
			r: parseInt(hex.slice(0, 2), 16),
			g: parseInt(hex.slice(2, 4), 16),
			b: parseInt(hex.slice(4, 6), 16),
			a: 1,
		};
	}
	if (hex.length === 8) {
		return {
			r: parseInt(hex.slice(0, 2), 16),
			g: parseInt(hex.slice(2, 4), 16),
			b: parseInt(hex.slice(4, 6), 16),
			a: parseInt(hex.slice(6, 8), 16) / 255,
		};
	}
	return null;
}

function parseRgbColour(value) {
	const match = value.match(/rgba?\(([^)]+)\)/i);
	if (!match) return null;
	const parts = match[1].split(',').map(part => part.trim());
	if (parts.length < 3) return null;

	const to255 = (input) => input.endsWith('%') ? Math.round(parseFloat(input) * 2.55) : parseFloat(input);
	const r = to255(parts[0]);
	const g = to255(parts[1]);
	const b = to255(parts[2]);
	const a = parts[3] !== undefined ? parseFloat(parts[3]) : 1;

	if (![r, g, b, a].every(Number.isFinite)) return null;
	return { r, g, b, a };
}

function luminance(r, g, b) {
	const toLinear = (channel) => {
		const normalized = channel / 255;
		return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
	};

	const lr = toLinear(r);
	const lg = toLinear(g);
	const lb = toLinear(b);
	return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}

function isExtremeNeutralSurface(colour) {
	if (!colour) return false;
	if (colour.a < 0.55) return false;

	const range = Math.max(colour.r, colour.g, colour.b) - Math.min(colour.r, colour.g, colour.b);
	const isNeutral = range <= 18;
	if (!isNeutral) return false;

	const y = luminance(colour.r, colour.g, colour.b);
	return y >= 0.82 || y <= 0.08;
}

// Semantic background variables that produce a mid-lightness colour in light mode.
// White text on these has ~2:1 contrast — unacceptable.
const SEMANTIC_BG_RE =
	/background(?:-color)?\s*:\s*var\(--color-(success|danger|warning|info)[^)]*\)/;

// The problematic text variable: near-white in light mode (hsl(263, 25%, 95%))
// which is unreadable on the semi-vivid semantic backgrounds above.
const TEXT_INVERSE_RE = /color\s*:\s*var\(--color-text-inverse[^)]*\)/;

// ── tests ────────────────────────────────────────────────────────────────────

const SRC_DIR = path.resolve(import.meta.dirname, '..'); // src/
const files = collectFiles(SRC_DIR, ['.svelte', '.css']);

describe('CSS contrast: --color-text-inverse must not be used on semantic-color backgrounds', () => {
	/**
	 * Collect ALL violations first so a single test gives a complete picture
	 * instead of stopping at the first failure.
	 */
	it('finds no rule blocks pairing a semantic background with --color-text-inverse', () => {
		const violations = [];

		for (const filePath of files) {
			const content = fs.readFileSync(filePath, 'utf8');
			const blocks = extractCssBlocks(filePath, content);

			for (const { source, block } of blocks) {
				if (SEMANTIC_BG_RE.test(block) && TEXT_INVERSE_RE.test(block)) {
					// Find a useful line number: locate the block in the full file
					const blockStart = content.indexOf(block);
					const lineNo =
						blockStart === -1
							? '?'
							: content.slice(0, blockStart).split('\n').length;
					const rel = path.relative(SRC_DIR, source);
					violations.push(`  ${rel}:${lineNo}`);
				}
			}
		}

		expect(violations, `\nThese files use --color-text-inverse on a semantic-color background.\nIn light mode this produces near-white text on a light background (~2:1 contrast).\nReplace with a hardcoded dark colour like #1B1730 instead:\n\n${violations.join('\n')}\n`).toHaveLength(0);
	});
});

describe('CSS contrast: ButtonEditor preview must not use a theme-aware background', () => {
	/**
	 * The button preview area must always use the Discord dark background so
	 * button colour previews look correct regardless of app theme.
	 * Guard against accidentally reverting .button-preview back to a CSS variable.
	 */
	it('.button-preview uses a dedicated fixed-surface token', () => {
		const buttonEditorPath = files.find(f => f.endsWith('ButtonEditor.svelte'));
		expect(buttonEditorPath, 'ButtonEditor.svelte not found').toBeTruthy();

		const content = fs.readFileSync(buttonEditorPath, 'utf8');
		// Find the .button-preview rule block
		const previewRuleRe = /\.button-preview\s*\{([^}]+)\}/;
		const match = previewRuleRe.exec(content);
		expect(match, '.button-preview CSS rule not found').toBeTruthy();

		const block = match[1];
		const usesFixedSurfaceToken = /background(?:-color)?\s*:\s*var\(--color-fixed-surface-discord-alt\)/.test(block);
		expect(usesFixedSurfaceToken, `.button-preview must use --color-fixed-surface-discord-alt so the preview remains fixed without hardcoding a literal in component CSS.\n\nCurrent rule:\n${block}`).toBe(true);
	});
});

describe('CSS theme safety: no hardcoded extreme neutral surfaces in component styles', () => {
	it('finds no opaque hardcoded near-white/near-black backgrounds outside theme tokens', () => {
		const violations = [];
		const backgroundDeclRe = /background(?:-color)?\s*:\s*([^;]+);/gi;
		const literalColourRe = /(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\))/g;

		for (const filePath of files) {
			if (filePath.endsWith('src/lib/styles/global.css')) continue;

			const content = fs.readFileSync(filePath, 'utf8');
			const slices = extractStyleSlices(filePath, content);

			for (const slice of slices) {
				let declMatch;
				while ((declMatch = backgroundDeclRe.exec(slice.text)) !== null) {
					const declaration = declMatch[1];
					if (/var\(/.test(declaration)) continue;

					const literals = [...declaration.matchAll(literalColourRe)].map(m => m[1]);
					if (literals.length === 0) continue;

					for (const literal of literals) {
						const parsed = literal.startsWith('#') ? parseHexColour(literal) : parseRgbColour(literal);
						if (!isExtremeNeutralSurface(parsed)) continue;

						const localOffset = slice.text.slice(0, declMatch.index).split('\n').length - 1;
						const globalLine = content.slice(0, slice.offset).split('\n').length + localOffset;
						const rel = path.relative(SRC_DIR, filePath);
						violations.push(`  ${rel}:${globalLine} -> ${declaration.trim()}`);
						break;
					}
				}
			}
		}

		expect(
			violations,
			`\nFound hardcoded extreme neutral surfaces in component/page CSS.\nUse shared tokens (e.g. --color-surface* or --color-overlay-scrim*) instead of literal near-white/near-black backgrounds.\n\n${violations.join('\n')}\n`
		).toHaveLength(0);
	});
});

describe('CSS contrast: superadmin workflows page must stay theme-safe', () => {
	it('does not hardcode light-only surface colours', () => {
		const workflowsPagePath = files.find(f => f.endsWith('routes/admin/superadmin/workflows/+page.svelte'));
		expect(workflowsPagePath, 'superadmin workflows page not found').toBeTruthy();

		const content = fs.readFileSync(workflowsPagePath, 'utf8');
		const styleMatch = /<style>([\s\S]*?)<\/style>/.exec(content);
		expect(styleMatch, 'No <style> block found in superadmin workflows page').toBeTruthy();

		const style = styleMatch[1];
		const hardcodedLightSurfacePatterns = [
			/rgba?\(\s*255\s*,\s*255\s*,\s*255\b/i,
			/rgba?\(\s*246\s*,\s*248\s*,\s*252\b/i,
			/rgba?\(\s*245\s*,\s*249\s*,\s*255\b/i,
			/rgba?\(\s*239\s*,\s*244\s*,\s*252\b/i,
		];

		const violations = [];
		for (const pattern of hardcodedLightSurfacePatterns) {
			if (pattern.test(style)) {
				violations.push(String(pattern));
			}
		}

		expect(
			violations,
			`\nThe superadmin workflows page includes hardcoded light-only surface colours.\nUse semantic theme variables such as --color-surface / --color-surface-elevated instead.\n\nMatched patterns:\n${violations.join('\n')}\n`
		).toHaveLength(0);
	});
});
