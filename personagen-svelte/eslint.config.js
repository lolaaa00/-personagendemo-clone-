import prettier from 'eslint-config-prettier';
import path from 'node:path';
import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import { defineConfig, includeIgnoreFile } from 'eslint/config';
import globals from 'globals';
import ts from 'typescript-eslint';
import svelteConfig from './svelte.config.js';

const gitignorePath = path.resolve(import.meta.dirname, '.gitignore');

export default defineConfig(
	includeIgnoreFile(gitignorePath),
	{
		// `archive/` holds retired routes kept for reference. They are outside
		// tsconfig's include, so the type-aware parser cannot resolve them and
		// every file there reports "not found by the project service" — noise that
		// would otherwise sit permanently in the error count.
		ignores: ['archive/**', 'build/**', '.svelte-kit/**', 'test-results/**', 'verify-shots/**']
	},
	js.configs.recommended,
	ts.configs.recommended,
	svelte.configs.recommended,
	prettier,
	svelte.configs.prettier,
	{
		languageOptions: { globals: { ...globals.browser, ...globals.node } },
		rules: {
			// typescript-eslint strongly recommend that you do not use the no-undef lint rule on TypeScript projects.
			// see: https://typescript-eslint.io/troubleshooting/faqs/eslint/#i-get-errors-from-the-no-undef-rule-about-global-variables-not-being-defined-even-though-there-are-no-typescript-errors
			'no-undef': 'off'
		}
	},
	{
		files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
		languageOptions: {
			parserOptions: {
				projectService: true,
				extraFileExtensions: ['.svelte'],
				parser: ts.parser,
				svelteConfig
			}
		}
	},
	{
		/**
		 * Two tiers, on purpose.
		 *
		 * `npm run lint` had 1,157 errors and was in no gate, so nobody ran it and
		 * it caught nothing. A zero-tolerance gate over that backlog would have
		 * been switched off within a week. So: anything that can be a live bug
		 * stays an ERROR and must be zero; the accumulated type/style debt is a
		 * WARNING held under a ceiling by `npm run lint:ci`, and the ceiling may
		 * only go down.
		 *
		 * Moving a rule from warn to error is the goal, not a rule change to make
		 * casually — do it when its count reaches zero.
		 */
		rules: {
			// ~870 sites. Real debt, but `any` is not itself a defect and the
			// backlog predates any gate. Ratcheted rather than ignored.
			'@typescript-eslint/no-explicit-any': 'warn',
			// ~67 sites. Style: SvelteKit prefers resolve() for base-path safety.
			// This app is served from the domain root, so none of these are bugs.
			'svelte/no-navigation-without-resolve': 'warn',
			// ~20 sites. Suggests SvelteMap/SvelteSet over plain Map/Set in reactive
			// positions. Correct advice, but each one needs its reactivity checked
			// by hand — not a mechanical fix.
			'svelte/prefer-svelte-reactivity': 'warn',
			// ~3 sites. Refactor suggestion, no behaviour change.
			'svelte/prefer-writable-derived': 'warn',
			// ~124 sites. Kept as a WARNING deliberately: the honest fix is a stable
			// unique key per item, and "silence it with the index" reproduces the
			// exact unkeyed behaviour while claiming it is fixed. Ratcheted so the
			// count can only fall as real keys are added.
			'svelte/require-each-key': 'warn',
			// ~15 sites, and every one is the same shape:
			//     let apiKey: string | null = null;
			//     try { apiKey = ...} catch { /* stays null */ }
			// The rule is right that the initialiser is dead on the happy path, but
			// removing it deletes the defensive default that makes the catch safe.
			// A rule whose fix makes the code worse must not gate a deploy.
			'no-useless-assignment': 'warn',

			// Unused symbols stay an ERROR — dead code is how a false comment like
			// the mcp-bridge one survives. These options just teach the rule the
			// conventions this codebase already uses:
			//   ^_        deliberate placeholder (`const { x: _dropped, ...rest }`)
			//   rest-sibling  the standard "omit these keys" destructuring idiom
			'@typescript-eslint/no-unused-vars': [
				'error',
				{
					argsIgnorePattern: '^_',
					varsIgnorePattern: '^_',
					caughtErrorsIgnorePattern: '^_',
					destructuredArrayIgnorePattern: '^_',
					ignoreRestSiblings: true
				}
			]
		}
	}
);
