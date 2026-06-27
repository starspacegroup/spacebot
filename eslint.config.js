import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import ts from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import svelteConfig from './svelte.config.js';

/**
 * Flat-config ESLint setup for SvelteKit 2 / Svelte 5 + TypeScript.
 *
 * Intentionally pragmatic: recommended rule sets plus a handful of
 * relaxations so the existing (un-linted, mid-migration JS→TS) codebase
 * doesn't turn entirely red. Tighten rules module-by-module as the
 * codebase hardens (mirrors the gradual-typing posture in tsconfig.json).
 *
 * Type-aware linting (projectService / recommendedTypeChecked) is
 * deliberately NOT enabled — it is slow and would surface thousands of
 * findings against the gradual-typing baseline.
 */
export default ts.config(
	// Global ignores (must be a standalone object to apply repo-wide).
	{
		ignores: [
			'.svelte-kit/',
			'build/',
			'dist/',
			'coverage/',
			'.wrangler/',
			'.claude/',
			'node_modules/',
			'playwright-report/',
			'test-results/',
			'**/*.timestamp-*',
			'orchestrator-worker/node_modules/',
		],
	},

	js.configs.recommended,
	...ts.configs.recommended,
	...svelte.configs.recommended,
	prettier,
	...svelte.configs.prettier,

	{
		languageOptions: {
			globals: {
				...globals.browser,
				...globals.node,
			},
		},
		rules: {
			// TypeScript handles undefined-variable resolution; the core
			// rule produces false positives on globals/types.
			'no-undef': 'off',
			// Pragmatic relaxations for the existing codebase.
			'no-empty': ['warn', { allowEmptyCatch: true }],
			'@typescript-eslint/no-explicit-any': 'off',
			'@typescript-eslint/no-unused-vars': [
				'warn',
				{
					argsIgnorePattern: '^_',
					varsIgnorePattern: '^_',
					caughtErrorsIgnorePattern: '^_',
				},
			],
			'@typescript-eslint/no-unused-expressions': 'off',
			'@typescript-eslint/ban-ts-comment': 'warn',
			'@typescript-eslint/no-empty-object-type': 'off',
			// `this` aliasing and require() appear in vendored/CJS surfaces.
			'@typescript-eslint/no-this-alias': 'off',
			'@typescript-eslint/no-require-imports': 'off',
			// Real-but-low-value findings against the existing baseline: keep
			// them visible as warnings rather than blocking CI on day one.
			'prefer-const': 'warn',
			'no-sparse-arrays': 'warn',
			'no-useless-escape': 'warn',
			'no-control-regex': 'off',
			'no-case-declarations': 'warn',
			'no-constant-binary-expression': 'warn',
		},
	},

	{
		// Svelte components need the TS parser for <script lang="ts"> and
		// the svelte.config.js for runes/compiler awareness.
		files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
		languageOptions: {
			parserOptions: {
				parser: ts.parser,
				extraFileExtensions: ['.svelte'],
				svelteConfig,
			},
		},
		rules: {
			'svelte/no-at-html-tags': 'warn',
			// Opinionated stylistic Svelte rules that fire en-masse on the
			// established component set — off so the baseline is green; the
			// correctness-oriented Svelte rules stay as errors.
			'svelte/require-each-key': 'off',
			'svelte/no-navigation-without-resolve': 'off',
			'svelte/prefer-svelte-reactivity': 'off',
			'svelte/prefer-writable-derived': 'off',
			'svelte/no-unused-svelte-ignore': 'warn',
			'svelte/no-useless-mustaches': 'warn',
		},
	},

	{
		// Node/CLI/script surfaces are Node-only.
		files: ['scripts/**', '*.config.{js,ts}', 'mcp-server/**', 'orchestrator-worker/**'],
		languageOptions: {
			globals: {
				...globals.node,
			},
		},
	}
);
