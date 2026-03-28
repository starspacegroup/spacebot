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
	it('.button-preview uses a fixed dark background, not a CSS variable', () => {
		const buttonEditorPath = files.find(f => f.endsWith('ButtonEditor.svelte'));
		expect(buttonEditorPath, 'ButtonEditor.svelte not found').toBeTruthy();

		const content = fs.readFileSync(buttonEditorPath, 'utf8');
		// Find the .button-preview rule block
		const previewRuleRe = /\.button-preview\s*\{([^}]+)\}/;
		const match = previewRuleRe.exec(content);
		expect(match, '.button-preview CSS rule not found').toBeTruthy();

		const block = match[1];
		const hasCssVar = /background(?:-color)?\s*:\s*var\(/.test(block);
		expect(hasCssVar, `.button-preview must use a fixed colour (e.g. #313338), not a CSS variable.\nThis ensures button previews always render against a dark Discord-style background regardless of light/dark mode.\n\nCurrent rule:\n${block}`).toBe(false);
	});
});
