import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * Guard: the composer and the endpoint have to agree on the request.
 *
 * The composer's whole reason to exist is that the preview and the real request
 * come from one code path — but the BODY is still two files agreeing by
 * convention. Every field the composer sends has to be a field the endpoint
 * reads, and the endpoint publishes that set as `editable` for the UI. When
 * those drift, a control silently does nothing: the user changes it, approves,
 * and the run ignores it. That failure is invisible in review and invisible at
 * runtime, which is why it is a test.
 */

const COMPOSER = 'src/lib/components/generation/GenerationComposer.svelte';
const ENDPOINT = 'src/routes/api/agent/[agentId]/generate-post/+server.ts';

/** Fields the composer assigns onto the request body. */
function composerFields(): string[] {
	const src = readFileSync(COMPOSER, 'utf8');
	const found = new Set<string>();
	for (const m of src.matchAll(/\bbody\.([a-z_]+)\s*=/g)) found.add(m[1]);
	return [...found].sort();
}

/** The set the endpoint advertises as editable. */
function editableFields(): string[] {
	const src = readFileSync(ENDPOINT, 'utf8');
	const block = src.match(/editable:\s*\[([\s\S]*?)\]/);
	if (!block) return [];
	return [...block[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
}

/** Fields the endpoint actually reads off the request. */
function readFields(): string[] {
	const src = readFileSync(ENDPOINT, 'utf8');
	const found = new Set<string>();
	for (const m of src.matchAll(/\bbody\.([a-z_]+)\b/g)) found.add(m[1]);
	return [...found].sort();
}

/**
 * Sent by the composer but deliberately not in generate-post`s `editable`.
 * `prompt` and `model` belong to the PROMPT-KIND flows (avatar, reference kit),
 * which are different endpoints with their own preview shape; the rest are set
 * by the caller (a Studio template, the calendar) rather than in the dialog.
 */
const OTHER_ENDPOINT = new Set(['prompt', 'model']);
const CALLER_OWNED = new Set(['refs', 'deliver', 'studio_template', 'preview', ...OTHER_ENDPOINT]);

describe('composer ↔ generate-post request contract', () => {
	it('reads both files (a silent empty scan would pass forever)', () => {
		expect(composerFields().length).toBeGreaterThan(10);
		expect(editableFields().length).toBeGreaterThan(10);
	});

	it('every field the composer sends is read by the endpoint', () => {
		const read = new Set(readFields());
		const orphans = composerFields().filter((f) => !read.has(f) && !OTHER_ENDPOINT.has(f));
		expect(
			orphans,
			'The composer sends these but the endpoint never reads them — the control does nothing.'
		).toEqual([]);
	});

	it('every editable field the composer edits is advertised as editable', () => {
		const editable = new Set(editableFields());
		const unadvertised = composerFields().filter((f) => !CALLER_OWNED.has(f) && !editable.has(f));
		expect(
			unadvertised,
			"Add these to the endpoint's `editable` list, or to CALLER_OWNED if the caller sets them."
		).toEqual([]);
	});

	it('the stages a user can now pick a model for all reach the request', () => {
		// These four are the budget-vs-quality controls. Each one was, at some
		// point, a picker that rendered and changed nothing.
		const sent = new Set(composerFields());
		for (const field of ['still_model', 'video_model', 'talking_head_model', 'llm_model']) {
			expect(sent.has(field), `${field} is not sent by the composer`).toBe(true);
		}
	});

	it('the per-run Look controls reach the request', () => {
		const sent = new Set(composerFields());
		for (const field of ['script', 'voice', 'card_text', 'card_layout', 'framing', 'still_url']) {
			expect(sent.has(field), `${field} is not sent by the composer`).toBe(true);
		}
	});
});
