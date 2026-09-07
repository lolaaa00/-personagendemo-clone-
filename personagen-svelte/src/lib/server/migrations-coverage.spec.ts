/**
 * MIGRATION COVERAGE — no .sql file may be silently forgotten.
 *
 * `personas_profile_migration.sql` sat outside `migrations.json` for a month
 * (2026-08-08 to 2026-09-05). Nothing failed: the app's never-brick fallback
 * quietly wrote the persona profile into the legacy `market` column instead,
 * so a database created from `client_bootstrap.sql` was simply missing the
 * column and nobody found out. This spec is the check that was missing.
 *
 * Every `supabase/*.sql` must be accounted for exactly once:
 *   - listed in `migrations.json` (the apply order and the bootstrap input), or
 *   - folded into `apply_all_pending.sql` (recorded in that file's header), or
 *   - listed in `migrations-excluded.json` with a reason, or
 *   - a generated artefact (`client_bootstrap.sql`).
 *
 * Reading the filesystem inside a unit test is unusual here, but the thing under
 * test IS the filesystem layout — the drift lives between the files, not inside
 * any module.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const supabaseDir = join(dirname(fileURLToPath(import.meta.url)), '../../../supabase');

const ORDER: Array<[string, string]> = JSON.parse(
	readFileSync(join(supabaseDir, 'migrations.json'), 'utf8')
);
const EXCLUDED: Array<[string, string]> = JSON.parse(
	readFileSync(join(supabaseDir, 'migrations-excluded.json'), 'utf8')
);

/** Generated output, not an input. */
const GENERATED = ['client_bootstrap.sql'];

/**
 * `apply_all_pending.sql` documents the migrations it subsumes in its header
 * comment. Parsing that header rather than keeping a second hand-written list
 * means the two can never disagree.
 */
function foldedIntoApplyAll(): string[] {
	const sql = readFileSync(join(supabaseDir, 'apply_all_pending.sql'), 'utf8');
	const header = sql.slice(0, sql.indexOf('\n\n\n') === -1 ? 4000 : sql.indexOf('\n\n\n'));
	return [...header.matchAll(/([a-z0-9_]+_migration\.sql)/g)].map((m) => m[1]);
}

const orderFiles = ORDER.map(([f]) => f);
const excludedFiles = EXCLUDED.map(([f]) => f);
const folded = foldedIntoApplyAll();

describe('supabase/ migration coverage', () => {
	it('accounts for every .sql file exactly once', () => {
		const onDisk = readdirSync(supabaseDir).filter((f) => f.endsWith('.sql'));
		const unaccounted: string[] = [];
		const duplicated: string[] = [];

		for (const file of onDisk) {
			const homes = [
				orderFiles.includes(file) && 'migrations.json',
				folded.includes(file) && 'apply_all_pending.sql',
				excludedFiles.includes(file) && 'migrations-excluded.json',
				GENERATED.includes(file) && 'generated'
			].filter(Boolean);

			if (homes.length === 0) unaccounted.push(file);
			if (homes.length > 1) duplicated.push(`${file} -> ${homes.join(' + ')}`);
		}

		expect(
			unaccounted,
			`These .sql files are in supabase/ but in no list. Add each to migrations.json ` +
				`(to ship it) or migrations-excluded.json (with a reason why not):\n  ` +
				unaccounted.join('\n  ')
		).toEqual([]);

		expect(duplicated, `Listed in more than one place:\n  ${duplicated.join('\n  ')}`).toEqual([]);
	});

	it('lists no ordered migration that does not exist', () => {
		// Exclusions are deliberately allowed to be absent: an entry for a file that
		// was moved or deleted is a tombstone, and its job is to stop the file
		// quietly reappearing in supabase/ without a decision.
		const missing = orderFiles.filter((f) => !existsSync(join(supabaseDir, f)));
		expect(missing, `In migrations.json but absent from supabase/: ${missing.join(', ')}`).toEqual(
			[]
		);
	});

	it('gives every exclusion a non-empty reason', () => {
		const reasonless = EXCLUDED.filter(([, reason]) => !reason || reason.trim().length < 10).map(
			([f]) => f
		);
		expect(reasonless, `Excluded with no usable reason: ${reasonless.join(', ')}`).toEqual([]);
	});

	it('gives every ordered migration a description', () => {
		const undescribed = ORDER.filter(([, note]) => !note || note.trim().length === 0).map(
			([f]) => f
		);
		expect(undescribed).toEqual([]);
	});

	it('applies the ledger migration first', () => {
		// apply-migration.mjs records each applied file in schema_migrations; the
		// table has to exist before anything can be recorded against it.
		expect(orderFiles[0]).toBe('000_schema_migrations.sql');
	});
});

describe('client_bootstrap.sql is in step with its inputs', () => {
	it('contains every ordered migration, in order', () => {
		const bootstrap = readFileSync(join(supabaseDir, 'client_bootstrap.sql'), 'utf8');
		// Match the builder's numbered section banner (`-- 08. user_api_keys_migration.sql`)
		// anchored to the line, not a bare indexOf: `api_keys_migration.sql` is a
		// substring of `user_api_keys_migration.sql` and would otherwise resolve to
		// the wrong section and report a phantom ordering error.
		const positions = orderFiles.map((f) => ({
			file: f,
			at: bootstrap.search(new RegExp(`^-- \\d+\\. ${f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'))
		}));

		const absent = positions.filter((p) => p.at === -1).map((p) => p.file);
		expect(
			absent,
			`In migrations.json but not in the generated bootstrap — regenerate it with ` +
				`\`node supabase/build-bootstrap.mjs\`:\n  ${absent.join('\n  ')}`
		).toEqual([]);

		const outOfOrder: string[] = [];
		for (let i = 1; i < positions.length; i++) {
			if (positions[i].at < positions[i - 1].at) {
				outOfOrder.push(`${positions[i].file} appears before ${positions[i - 1].file}`);
			}
		}
		expect(outOfOrder, outOfOrder.join('; ')).toEqual([]);
	});

	it('emits re-runnable DDL', () => {
		// The builder rewrites its inputs to be replayable; assert on the OUTPUT so
		// a hand-edit of the generated file, or a builder regression, both fail.
		const bootstrap = readFileSync(join(supabaseDir, 'client_bootstrap.sql'), 'utf8');
		// `%I` / `%L` mark a format() template executed as dynamic SQL inside
		// PL/pgSQL (the activity-events partition helper). Those are built at run
		// time and cannot carry a literal IF NOT EXISTS, so they are not drift.
		const isDynamicSql = (name: string) => name.includes('%');

		const bareCreateTable = [...bootstrap.matchAll(/CREATE TABLE (?!IF NOT EXISTS)(\S+)/g)]
			.map((m) => m[1])
			.filter((n) => !isDynamicSql(n));
		expect(bareCreateTable, `CREATE TABLE without IF NOT EXISTS: ${bareCreateTable.join(', ')}`).toEqual(
			[]
		);

		const bareCreateIndex = [
			...bootstrap.matchAll(/CREATE (?:UNIQUE )?INDEX (?!IF NOT EXISTS)(\S+)/g)
		]
			.map((m) => m[1])
			.filter((n) => !isDynamicSql(n));
		expect(bareCreateIndex, `CREATE INDEX without IF NOT EXISTS: ${bareCreateIndex.join(', ')}`).toEqual(
			[]
		);
	});
});
