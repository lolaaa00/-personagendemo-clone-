/**
 * An in-flight guard is only a guard if it reads the key the handler writes.
 *
 * `generateField` used to take ONE string and use it as both the model prompt
 * and the `generating` key. Fields whose prompt was written for the model —
 * "Customer Pain Points this brand solves", "Audience Interests & Behaviors" —
 * therefore keyed `generating` under that whole sentence, while the button read
 * `generating['Pain Points']`. The two never met, so the guard never matched:
 * eight buttons never disabled, never showed their spinner, and could be fired
 * repeatedly into a paid AI call. The same string also reached the user, as
 * toasts reading "Audience Interests & Behaviors generated!".
 *
 * Nothing could have caught it: both halves are valid, the types agree, and the
 * feature works on a single click. It is only wrong on the second click.
 *
 * So this asserts the relationship rather than either half — for EVERY call
 * site, the label the handler keys on must be a key the markup actually reads.
 * A new field wired the old way fails here instead of in production.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(__dirname, '..', 'routes', '(portal)', 'brand-brief', '+page.svelte');

/** Every `generateField(...)` call, with its args balanced across newlines. */
function callSites(text: string) {
	const out: Array<{ line: number; prompt: string; label: string }> = [];
	// Skip the declaration itself and the API client of the same name.
	const re = /(?<!BrandBrief\.)(?<!async function )generateField\(/g;
	for (const m of text.matchAll(re)) {
		let i = m.index! + m[0].length;
		let depth = 1;
		while (depth > 0 && i < text.length) {
			if (text[i] === '(') depth++;
			else if (text[i] === ')') depth--;
			i++;
		}
		const args = text.slice(m.index! + m[0].length, i - 1);
		const quoted = [...args.matchAll(/'([^']*)'/g)].map((q) => q[1]);
		if (quoted.length === 0) continue;
		out.push({
			line: text.slice(0, m.index!).split('\n').length,
			prompt: quoted[0],
			// The optional third argument, when given, is the label.
			label: quoted.length > 1 ? quoted[quoted.length - 1] : quoted[0]
		});
	}
	return out;
}

describe('brand brief — the in-flight key the markup reads is the one the handler sets', () => {
	const text = readFileSync(SRC, 'utf8');
	const lines = text.split('\n');
	const sites = callSites(text);

	it('finds the call sites at all (a silent empty scan would pass forever)', () => {
		expect(sites.length).toBeGreaterThanOrEqual(8);
	});

	it('every generateField label is read back by its own button', () => {
		const orphans = sites.filter(({ line, label }) => {
			// The button's markup sits just after the handler in this file.
			const window = lines.slice(Math.max(0, line - 5), line + 16).join('\n');
			return !window.includes(`generating['${label}']`);
		});
		expect(
			orphans.map((o) => `line ${o.line}: label '${o.label}' is never read as generating[…]`),
			'A generateField whose label no button reads cannot disable that button: it will ' +
				'stay clickable through the whole request and can be fired repeatedly into a paid call.'
		).toEqual([]);
	});

	it('a prompt written for the model is never used as the key', () => {
		// The tell that the two arguments have been collapsed again: a key that
		// reads like an instruction. Short labels are keys; sentences are prompts.
		const sentences = sites.filter((s) => s.label.length > 24 || /\(|\bthis brand\b/.test(s.label));
		expect(
			sentences.map((s) => `line ${s.line}: '${s.label.slice(0, 46)}…'`),
			'This label looks like a model prompt. Pass the short UI label as the third ' +
				'argument so the key stays stable and the toast stays readable.'
		).toEqual([]);
	});
});
