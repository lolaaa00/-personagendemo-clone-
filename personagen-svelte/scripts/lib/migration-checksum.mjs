// ═══════════════════════════════════════════════════════════════════════════
// Migration checksums — CHECKOUT-INDEPENDENT by construction.
//
// The ledger records a sha256 per applied migration and the runner refuses a
// file whose checksum changed, so edit history can never be replayed. That
// guarantee only works if the same file hashes the same everywhere.
//
// It did not. The hash was taken over the raw bytes, and these files are
// `text=auto`: the same commit is CRLF in one working tree and LF in another (a
// git worktree, CI, a Linux box). One file, two hashes — so a migration applied
// from an LF checkout read as DRIFTED from a CRLF checkout and vice versa, and
// `--status --strict` (deploy.ps1 step 0, `npm run verify:money`) aborted on a
// database that was perfectly correct. Observed 2026-09-08:
// market_restore_migration.sql recorded ed669907 (LF, = the git blob hash) but
// hashed ddd40700 raw in the CRLF shared tree, while a fresh LF worktree
// reported 38 of 39 files drifted for the mirror-image reason.
//
// The fix: normalise CRLF → LF before hashing, so the checksum is over the
// file's CONTENT and equals the hash of the git blob, which every checkout
// agrees on.
//
// Legacy rows are repaired by `apply-migration.mjs --rehash`, which uses
// `legacyVariantHashes()`: it rewrites a stored checksum ONLY when that
// checksum equals the raw hash of one of the two line-ending renderings of the
// file now on disk. That is proof the bytes differ by nothing but `\r`, so a
// genuine edit can never be laundered through it — and, because both renderings
// are considered, the repair works identically from a CRLF or an LF checkout.
//
// Pure and dependency-free so it can be unit-tested without importing the
// runner, which executes on import.
//
// Diagnosis and the original of this module: the concurrent session working on
// the orphaned-rail audit (finding #12); adopted here with the runner.
// ═══════════════════════════════════════════════════════════════════════════

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

/**
 * @param {string} s
 * @returns {string} lowercase hex sha256 of exactly these bytes
 */
export const sha256 = (s) => createHash('sha256').update(s).digest('hex');

/**
 * File content with line endings normalised to \n (also strips a UTF-8 BOM).
 * Only CRLF is folded — the same transformation git applies to a `text` file —
 * so the canonical hash equals the hash of the committed blob.
 *
 * @param {string} text
 * @returns {string}
 */
export function normalizeSql(text) {
	return String(text).replace(/^﻿/, '').replace(/\r\n/g, '\n');
}

/**
 * The checkout-independent checksum of migration SQL.
 *
 * @param {string} text
 * @returns {string}
 */
export function hashSql(text) {
	return sha256(normalizeSql(text));
}

/**
 * Reads a migration file and returns { sql, checksum } with sql normalised.
 *
 * @param {string} path
 * @returns {{ sql: string, checksum: string }}
 */
export function readMigrationSql(path) {
	const sql = normalizeSql(readFileSync(path, 'utf8'));
	return { sql, checksum: sha256(sql) };
}

/**
 * The raw-byte hashes of both line-ending renderings of this content — the two
 * values the OLD hasher could have produced for it. A recorded checksum that
 * matches one of these is provably the same content, only rendered differently.
 *
 * @param {string} text
 * @returns {string[]} [hash of the LF rendering, hash of the CRLF rendering]
 */
export function legacyVariantHashes(text) {
	const lf = normalizeSql(text);
	const crlf = lf.replace(/\n/g, '\r\n');
	return [sha256(lf), sha256(crlf)];
}

/**
 * Classifies a stored checksum against the file now on disk:
 *   'current'  — already the canonical hash, nothing to do
 *   'legacy'   — a raw hash of the same content (line endings only) → restampable
 *   'changed'  — neither; the file genuinely differs from what was applied
 *
 * @param {string} text file content as read from this checkout
 * @param {string} recorded checksum stored in schema_migrations
 * @returns {'current' | 'legacy' | 'changed'}
 */
export function classifyChecksum(text, recorded) {
	const canonical = hashSql(text);
	if (recorded === canonical) return 'current';
	return legacyVariantHashes(text).includes(recorded) ? 'legacy' : 'changed';
}

// ── Provenance: a live schema change must exist in the repository ───────────
//
// Twice on 2026-09-08 a migration reached production from a file that was
// untracked at the time. Both were committed afterwards, so nothing became
// unreproducible — but in that window the only copy of a live schema change was
// one file on one machine, and a rollback or an audit would have had nothing to
// read. `apply` therefore refuses a file that is untracked or modified against
// HEAD unless --allow-uncommitted is passed. It cannot obstruct a correct
// workflow, because the correct workflow commits first.

/**
 * Reads `git status --porcelain -- <file>` output for ONE path and says what it
 * means. Empty output = tracked and identical to HEAD.
 *
 * @param {string} porcelain raw stdout of `git status --porcelain -- <file>`
 * @returns {'clean' | 'untracked' | 'modified'}
 */
export function classifyWorktreeState(porcelain) {
	const line = String(porcelain ?? '')
		.split('\n')
		.map((l) => l.trimEnd())
		.find((l) => l.length > 0);
	if (!line) return 'clean';
	// Porcelain v1: XY <path>. '??' is untracked; anything else is a staged
	// and/or unstaged difference from HEAD — both mean "not what HEAD says".
	return line.startsWith('??') ? 'untracked' : 'modified';
}

/**
 * The message shown when a migration is refused for provenance.
 *
 * @param {string} name migration file name
 * @param {'untracked' | 'modified' | 'unverifiable'} state
 * @returns {string}
 */
export function provenanceRefusal(name, state) {
	const why =
		state === 'untracked'
			? 'is not tracked by git'
			: state === 'modified'
				? 'differs from HEAD'
				: 'could not be checked against git (not a work tree, or git is unavailable)';
	return `REFUSED  ${name}: the file ${why}. A schema change that is live in production must exist in the repository first — commit it, then apply. Pass --allow-uncommitted to override (recorded nowhere; you are on your own for reproducibility).`;
}
