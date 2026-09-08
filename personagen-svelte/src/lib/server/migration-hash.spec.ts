/**
 * The migration ledger's checksum must be a property of the CONTENT, not of the
 * checkout's line endings.
 *
 * These files are `text=auto`, so the same commit is CRLF in a Windows working
 * tree and LF in a Linux worktree or CI. Hashing raw bytes made a record valid
 * only where it was written: on 2026-09-08 a row recorded from an LF worktree
 * read as DRIFTED from the CRLF tree, while that same tree's 38 rows read as
 * drifted from a fresh LF worktree. `--status --strict` gates deploy.ps1 step 0
 * and `npm run verify:money`, so the artefact blocked deploys on one side or
 * the other permanently while the database was perfectly correct.
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
// Plain ESM helper, shared with scripts/apply-migration.mjs (typed by JSDoc).
import { normalizeSql, hashSql, legacyVariantHashes, classifyChecksum } from '../../../scripts/lib/migration-checksum.mjs';

const SQL_LF = 'ALTER TABLE public.agents\n  ADD COLUMN IF NOT EXISTS market TEXT;\n';
const SQL_CRLF = SQL_LF.replace(/\n/g, '\r\n');
const raw = (s: string) => createHash('sha256').update(s).digest('hex');

describe('migration checksum — content, not line endings', () => {
	it('CRLF and LF renderings of the same file hash identically', () => {
		expect(hashSql(SQL_CRLF)).toBe(hashSql(SQL_LF));
	});

	it('the canonical hash is the hash of the LF bytes (= the git blob), so records are portable', () => {
		expect(hashSql(SQL_CRLF)).toBe(raw(SQL_LF));
	});

	it('a UTF-8 BOM is not content', () => {
		expect(hashSql('﻿' + SQL_LF)).toBe(hashSql(SQL_LF));
		expect(normalizeSql('﻿' + SQL_CRLF)).toBe(SQL_LF);
	});

	it('a real content change still changes the hash', () => {
		expect(hashSql(SQL_LF.replace('market', 'markets'))).not.toBe(hashSql(SQL_LF));
		expect(hashSql(SQL_LF + '-- trailing comment\n')).not.toBe(hashSql(SQL_LF));
	});
});

describe('classifyChecksum — what --rehash is allowed to repair', () => {
	it('a canonical record is current', () => {
		expect(classifyChecksum(SQL_CRLF, hashSql(SQL_LF))).toBe('current');
	});

	it('a record written from EITHER checkout is legacy — repairable from either checkout', () => {
		// recorded from a CRLF tree, read from an LF tree …
		expect(classifyChecksum(SQL_LF, raw(SQL_CRLF))).toBe('legacy');
		// … and recorded from an LF worktree, read from the CRLF shared tree.
		// (This is the case a raw-hash-of-my-own-checkout guard would refuse.)
		expect(classifyChecksum(SQL_CRLF, raw(SQL_LF))).toBe('current');
		expect(legacyVariantHashes(SQL_CRLF)).toContain(raw(SQL_LF));
		expect(legacyVariantHashes(SQL_LF)).toContain(raw(SQL_CRLF));
	});

	it('an edited file is changed, and can never be laundered through the repair', () => {
		const edited = SQL_LF.replace('market', 'markets');
		expect(classifyChecksum(edited, hashSql(SQL_LF))).toBe('changed');
		expect(classifyChecksum(edited, raw(SQL_CRLF))).toBe('changed');
		expect(classifyChecksum(SQL_LF, 'deadbeef')).toBe('changed');
	});

	it('the real drifted file reproduces the production case exactly', () => {
		// market_restore_migration.sql: recorded ed669907 from an LF worktree,
		// hashed ddd40700 raw in this CRLF tree. It must classify as current now.
		const path = join(__dirname, '..', '..', '..', 'supabase', 'market_restore_migration.sql');
		const sql = readFileSync(path, 'utf8');
		expect(classifyChecksum(sql, 'ed669907492a46b114542524c57e2477916882f34ffdd60f7495875ebbf3bd26')).toBe('current');
	});
});

describe('the runner delegates to that module', () => {
	const script = readFileSync(join(__dirname, '..', '..', '..', 'scripts', 'apply-migration.mjs'), 'utf8');

	it('imports the shared helper instead of hashing raw bytes itself', () => {
		expect(script).toContain("from './lib/migration-checksum.mjs'");
		expect(script).not.toMatch(/createHash\('sha256'\)/);
	});

	it('--rehash only rewrites rows classified legacy, refuses changed, and can dry-run', () => {
		const rehash = script.slice(script.indexOf('async function cmdRehash'), script.indexOf('async function cmdAll'));
		expect(rehash).toContain("if (state === 'legacy') updates.push");
		expect(rehash).toContain('REFUSED');
		expect(rehash).toContain('UPDATE public.schema_migrations SET checksum =');
		expect(rehash).not.toMatch(/\bDROP\b|\bDELETE\b|\bALTER\b|\bINSERT\b/);
		expect(rehash.indexOf('if (dryRun)')).toBeLessThan(rehash.indexOf('await pgQuery'));
	});
});
