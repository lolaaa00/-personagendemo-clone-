// ═══════════════════════════════════════════════════════════════════════════
// Secret re-keying — the pure half: key derivation, the AES-GCM codec, and the
// per-row plan. No I/O, no process, no env, and deliberately NO SHEBANG.
//
// It lives here rather than in rotate-user-secrets.mjs because a spec that
// wants to test this arithmetic has to IMPORT it, and vite cannot parse a file
// that opens with `#!` — the shebang is valid to node and a syntax error to
// every bundler. scripts/lib/migration-checksum.mjs exists for the same reason
// and is imported by both apply-migration.mjs and migration-hash.spec.ts; this
// follows it.
//
// The crypto below is a deliberate REPLICA of src/lib/server/user-api-keys.ts
// (a .mjs cannot import TS, $lib, or $env). The two must stay in step or a
// rotation would write ciphertext the app cannot read — there is a test that
// drives both implementations against the same inputs and fails if they drift.
// ═══════════════════════════════════════════════════════════════════════════

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * @typedef {{ encrypted_value: string, iv: string, auth_tag: string }} EncryptedSecret
 * @typedef {{ state: 'pending' | 'rotated' | 'failed', reencrypted?: EncryptedSecret, reason?: string }} RowPlan
 */


/**
 * @param {string} raw
 * @returns {Buffer}
 */
export function deriveKey(raw) {
	if (!raw) {
		throw new Error('USER_SECRETS_ENCRYPTION_KEY is not configured.');
	}

	const trimmed = String(raw).trim();
	const base64 = Buffer.from(trimmed, 'base64');
	if (base64.length === 32) return base64;

	if (/^[a-f0-9]{64}$/i.test(trimmed)) {
		return Buffer.from(trimmed, 'hex');
	}

	// Accept passphrase-style secrets while still deriving a fixed 32-byte AES key.
	if (trimmed.length >= 32) {
		return createHash('sha256').update(trimmed).digest();
	}

	throw new Error(
		'USER_SECRETS_ENCRYPTION_KEY must be a 32-byte base64 key, 64-char hex key, or at least 32 characters.'
	);
}

/**
 * Replica of encryptSecret() (user-api-keys.ts:51-62).
 * @param {string} rawKey
 * @param {string} value
 * @returns {EncryptedSecret}
 */
export function encryptSecretWith(rawKey, value) {
	const iv = randomBytes(12);
	const cipher = createCipheriv('aes-256-gcm', deriveKey(rawKey), iv);
	const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
	const authTag = cipher.getAuthTag();

	return {
		encrypted_value: encrypted.toString('base64'),
		iv: iv.toString('base64'),
		auth_tag: authTag.toString('base64')
	};
}

/**
 * Replica of decryptSecret() (user-api-keys.ts:64-74).
 * @param {string} rawKey
 * @param {EncryptedSecret} secret
 * @returns {string}
 */
export function decryptSecretWith(rawKey, secret) {
	const decipher = createDecipheriv(
		'aes-256-gcm',
		deriveKey(rawKey),
		Buffer.from(secret.iv, 'base64')
	);
	decipher.setAuthTag(Buffer.from(secret.auth_tag, 'base64'));
	return Buffer.concat([
		decipher.update(Buffer.from(secret.encrypted_value, 'base64')),
		decipher.final()
	]).toString('utf8');
}

// ── the two tables that hold encrypted secrets ─────────────────────────────
// `tag` is the non-secret label printed per row. For user_api_keys that is the
// provider; zernio_keys has no provider (every row is Zernio) and its `label`
// is user-typed free text — often an email address — so it is NEVER read or
// printed. Only the id prefix identifies those rows.
export const SECRET_TABLES = [
	{ table: 'user_api_keys', tagColumn: 'provider', tagFallback: null },
	{ table: 'zernio_keys', tagColumn: null, tagFallback: 'zernio' }
];

/**
 * Decide what happens to one stored secret, without touching the database.
 * @param {EncryptedSecret & { id?: string, provider?: string }} row
 * @param {string} oldKey
 * @param {string} newKey
 * @param {{ encrypt: (k: string, v: string) => EncryptedSecret, decrypt: (k: string, s: EncryptedSecret) => string }} [codec]
 * @returns {RowPlan}
 */
export function planRow(
	row,
	oldKey,
	newKey,
	codec = { encrypt: encryptSecretWith, decrypt: decryptSecretWith }
) {
	let plaintext;
	try {
		plaintext = codec.decrypt(oldKey, row);
	} catch {
		try {
			codec.decrypt(newKey, row);
			return { state: 'rotated' };
		} catch {
			return { state: 'failed' };
		}
	}

	const reencrypted = codec.encrypt(newKey, plaintext);
	// Verify the new ciphertext before trusting it. A write that cannot be read
	// back is the exact failure this whole script exists to prevent.
	let verified;
	try {
		verified = codec.decrypt(newKey, reencrypted);
	} catch {
		return { state: 'failed', reason: 'round-trip decrypt failed' };
	}
	if (verified !== plaintext) {
		return { state: 'failed', reason: 'round-trip mismatch' };
	}

	return { state: 'pending', reencrypted };
}

/** @param {{ dryRun: boolean, onlyTable: string | null }} opts */
