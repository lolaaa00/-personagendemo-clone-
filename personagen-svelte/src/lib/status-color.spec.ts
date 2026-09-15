/**
 * The properties that matter about status colour:
 *
 *  1. every status the DATABASE allows has an entry, so nothing renders as
 *     anonymous grey by accident;
 *  2. fill and text are the same hue family, so a post does not change colour
 *     when you open it;
 *  3. text variants are the AA-safe `-text` tokens, because the raw brand hues
 *     measure 2.77–4.08:1 on a light surface.
 *
 * (1) is checked against the CHECK constraints parsed out of the migrations
 * rather than a list retyped here — a status added to the database without an
 * entry in this module must fail this file, which is the whole point.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
	POST_STATUSES,
	PERSONA_STATUSES,
	postStatus,
	personaStatus,
	postStatusFill,
	postStatusText
} from './status-color';

const migrationsDir = join(__dirname, '..', '..', 'supabase');

/**
 * Every status value the schema has EVER allowed for a table, unioned across all
 * migrations.
 *
 * The union, not the latest constraint: each migration DROPs and re-ADDs
 * `posts_status_check`, and rows written under an earlier one are still in the
 * table. A colour map that only knew the current constraint would draw those
 * historical rows as anonymous grey.
 */
function everAllowed(table: 'posts' | 'agents'): string[] {
	const found = new Set<string>();
	// Literal patterns, not a RegExp built from a template literal: `\s` and `\(`
	// lose their backslashes inside a template literal, which silently turns the
	// pattern into something that matches nothing.
	const named =
		table === 'posts'
			? /posts_status_check[\s\S]{0,200}?CHECK\s*\(+\s*status\s+IN\s*\(([^)]*)\)/gi
			: /agents_status_check[\s\S]{0,200}?CHECK\s*\(+\s*status\s+IN\s*\(([^)]*)\)/gi;
	const inline = /status\s+TEXT[^,]*?CHECK\s*\(\s*status\s+IN\s*\(([^)]*)\)/i;

	for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'))) {
		const sql = readFileSync(join(migrationsDir, file), 'utf8');

		// Named constraint, re-declared by later migrations.
		for (const m of sql.matchAll(named)) {
			for (const v of m[1].matchAll(/'([a-z_]+)'/g)) found.add(v[1]);
		}

		// Inline in the original CREATE TABLE, where the constraint is unnamed.
		const create = sql.indexOf('CREATE TABLE public.' + table);
		if (create !== -1) {
			const m = sql.slice(create, create + 1500).match(inline);
			if (m) for (const v of m[1].matchAll(/'([a-z_]+)'/g)) found.add(v[1]);
		}
	}
	return [...found];
}

describe('every status the database allows is styled', () => {
	it('covers all post statuses declared in the migrations', () => {
		const allowed = everAllowed('posts');
		expect(allowed.length, 'no posts status values found in supabase/*.sql').toBeGreaterThan(0);
		for (const s of allowed) {
			expect(POST_STATUSES, `post status "${s}" is allowed by the database but has no entry`).toContain(s);
			expect(postStatus(s).label).not.toBe('Unknown');
		}
	});

	it('covers all persona statuses declared in the migrations', () => {
		const allowed = everAllowed('agents');
		expect(allowed.length, 'no agents status values found in supabase/*.sql').toBeGreaterThan(0);
		for (const s of allowed) {
			expect(PERSONA_STATUSES, `persona status "${s}" is allowed but has no entry`).toContain(s);
			expect(personaStatus(s).label).not.toBe('Unknown');
		}
	});

	it('an unrecognised status is grey and says so, rather than guessing', () => {
		expect(postStatus('banana').label).toBe('Unknown');
		expect(postStatus('banana').fill).toBe('var(--text-dim)');
		expect(postStatus(null).fill).toBe('var(--text-dim)');
		expect(postStatus(undefined).fill).toBe('var(--text-dim)');
	});
});

describe('fill and text agree', () => {
	it('every status uses the same hue for its fill and its text', () => {
		for (const s of POST_STATUSES) {
			const { fill, text } = postStatus(s);
			// var(--success) ↔ var(--success-text)
			expect(text, `"${s}" changes hue between fill and text`).toBe(fill.replace(/\)$/, '-text)'));
		}
	});

	it('partial is no longer gold in one place and amber in another', () => {
		expect(postStatusFill('partial')).toBe('var(--warning)');
		expect(postStatusText('partial')).toBe('var(--warning-text)');
	});

	it('draft has a colour at all — it used to fall through to grey in the drawer', () => {
		expect(postStatusFill('draft')).toBe('var(--warning)');
		expect(postStatusText('draft')).not.toBe('var(--text-dim)');
	});
});

describe('text variants are the accessible ones', () => {
	it('never puts a raw brand hue on text', () => {
		for (const s of [...POST_STATUSES, ...PERSONA_STATUSES]) {
			const style = POST_STATUSES.includes(s as never) ? postStatus(s) : personaStatus(s);
			// --text-dim is already an AA body colour; every other hue must be a -text token.
			if (style.text !== 'var(--text-dim)') {
				expect(style.text, `"${s}" uses a raw hue as text`).toMatch(/-text\)$/);
			}
		}
	});
});

describe('labels are sentence case', () => {
	it('no label SHOUTS — StatusBadge used to return "PENDING" among lower-case siblings', () => {
		for (const s of [...POST_STATUSES, ...PERSONA_STATUSES]) {
			const style = POST_STATUSES.includes(s as never) ? postStatus(s) : personaStatus(s);
			expect(style.label, `"${s}" label is shouted`).not.toBe(style.label.toUpperCase());
		}
	});

	it('every status explains itself in one line', () => {
		for (const s of POST_STATUSES) {
			expect(postStatus(s).meaning.length).toBeGreaterThan(10);
			expect(postStatus(s).meaning.endsWith('.')).toBe(true);
		}
	});
});
