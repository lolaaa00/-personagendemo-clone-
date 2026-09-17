import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { env } from '$env/dynamic/private';
import { getServiceSupabase } from './service-supabase';

export const SUPPORTED_USER_KEY_PROVIDERS = [
	'zernio',
	'gemini',
	'openrouter',
	'firecrawl',
	'kie_ai',
	'fal_ai'
] as const;
export type UserKeyProvider = (typeof SUPPORTED_USER_KEY_PROVIDERS)[number];

export interface EncryptedSecret {
	encrypted_value: string;
	iv: string;
	auth_tag: string;
}

export interface UserApiKeyMetadata {
	provider: UserKeyProvider;
	masked_value: string;
	status: 'untested' | 'valid' | 'invalid' | 'error';
	last_error: string | null;
	last_tested_at: string | null;
	updated_at: string | null;
}

/** The two tables that hold ciphertext. Nothing else on the platform does. */
export type SecretTable = 'user_api_keys' | 'zernio_keys';

/** The three columns `authenticated` must never read once stage B is applied. */
export const SECRET_COLUMNS = 'encrypted_value, iv, auth_tag';

/**
 * What a row's `last_error` says after its ciphertext failed to open. Written
 * verbatim — never with the ciphertext, iv or tag in it — and rendered as-is
 * by Settings → API keys, so it has to tell the user what to DO.
 */
export const UNDECRYPTABLE_KEY_MESSAGE =
	'Stored key could not be decrypted — delete it and save it again.';

function getEncryptionKey(): Buffer {
	const raw = env.USER_SECRETS_ENCRYPTION_KEY || '';
	if (!raw) {
		throw new Error('USER_SECRETS_ENCRYPTION_KEY is not configured.');
	}

	const trimmed = raw.trim();
	const base64 = Buffer.from(trimmed, 'base64');
	if (base64.length === 32) return base64;

	if (/^[a-f0-9]{64}$/i.test(trimmed)) {
		return Buffer.from(trimmed, 'hex');
	}

	// Accept passphrase-style secrets while still deriving a fixed 32-byte AES key.
	if (trimmed.length >= 32) {
		return createHash('sha256').update(trimmed).digest();
	}

	throw new Error('USER_SECRETS_ENCRYPTION_KEY must be a 32-byte base64 key, 64-char hex key, or at least 32 characters.');
}

export function encryptSecret(value: string): EncryptedSecret {
	const iv = randomBytes(12);
	const cipher = createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
	const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
	const authTag = cipher.getAuthTag();

	return {
		encrypted_value: encrypted.toString('base64'),
		iv: iv.toString('base64'),
		auth_tag: authTag.toString('base64')
	};
}

export function decryptSecret(secret: EncryptedSecret): string {
	const decipher = createDecipheriv(
		'aes-256-gcm',
		getEncryptionKey(),
		Buffer.from(secret.iv, 'base64')
	);
	decipher.setAuthTag(Buffer.from(secret.auth_tag, 'base64'));
	return Buffer.concat([
		decipher.update(Buffer.from(secret.encrypted_value, 'base64')),
		decipher.final()
	]).toString('utf8');
}

export function isSupportedProvider(provider: string): provider is UserKeyProvider {
	return SUPPORTED_USER_KEY_PROVIDERS.includes(provider as UserKeyProvider);
}

export function maskApiKey(value: string): { masked_value: string; last_four: string } {
	const trimmed = value.trim();
	const lastFour = trimmed.slice(-4);
	if (trimmed.length <= 8) {
		return { masked_value: `••••${lastFour}`, last_four: lastFour };
	}
	return {
		masked_value: `${trimmed.slice(0, 6)}••••••${lastFour}`,
		last_four: lastFour
	};
}

/**
 * The client that reads ciphertext: the service role, whatever the caller
 * handed in. `locals.supabase` is anon-key + user JWT, i.e. the SAME
 * `authenticated` role as the browser, and Postgres cannot tell "the server
 * decrypting on the user's behalf" from "the browser reading its own row" —
 * one role, one grant. Reading through service_role is what lets the
 * column-level SELECT revoke on the secret columns (stage B of
 * user_api_keys_column_grants_migration.sql) land without breaking BYOK.
 *
 * The `user_id` filter stays on every read: this changes which role performs
 * the read, not who may see what. Same fallback as credits.ts — a test with
 * no service key gets the caller's client.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the Supabase client is untyped across this codebase; narrowing it here alone would be a fiction
function secretReader(supabase: any): any {
	try {
		return getServiceSupabase();
	} catch {
		return supabase;
	}
}

/**
 * Best-effort: stamp the row so Settings shows WHY the key stopped being
 * used. Never throws — a failed status write must not mask the decrypt error
 * the caller is about to see. Skipped when the server has no encryption key
 * at all: that is an ops fault of the deployment, not of this row, and
 * "delete it and save it again" would be the wrong advice.
 */
async function markUndecryptable(
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the Supabase client is untyped across this codebase
	db: any,
	table: SecretTable,
	match: Record<string, string>
): Promise<void> {
	try {
		getEncryptionKey();
	} catch {
		return;
	}
	try {
		let q = db.from(table).update({ status: 'error', last_error: UNDECRYPTABLE_KEY_MESSAGE });
		for (const [col, val] of Object.entries(match)) q = q.eq(col, val);
		const res = await q;
		if (res?.error) {
			console.warn(`[user-api-keys] could not record decrypt failure on ${table}:`, res.error.message);
		}
	} catch (e) {
		console.warn(`[user-api-keys] could not record decrypt failure on ${table}:`, (e as Error).message);
	}
}

/**
 * Read one stored secret through the service role and decrypt it. Null when
 * no row matches. A ciphertext that will not open THROWS — and, first, marks
 * the row `status='error'` with a secret-free `last_error`. The throw is
 * deliberate and unchanged: resolvers still `.catch(() => null)` onto the
 * platform key, but the user now sees why in Settings instead of a key that
 * silently stopped being used.
 */
export async function readStoredSecret(
	supabase: any,
	table: SecretTable,
	match: Record<string, string>
): Promise<string | null> {
	const db = secretReader(supabase);
	let q = db.from(table).select(SECRET_COLUMNS);
	for (const [col, val] of Object.entries(match)) q = q.eq(col, val);
	const { data, error } = await q.maybeSingle();

	if (error) throw error;
	if (!data) return null;
	try {
		return decryptSecret(data);
	} catch (e) {
		console.error(
			`[user-api-keys] ${table} row (${Object.entries(match)
				.map(([k, v]) => `${k}=${v}`)
				.join(', ')}) could not be decrypted; status set to error.`
		);
		await markUndecryptable(db, table, match);
		throw e;
	}
}

export async function getUserApiKey(
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the Supabase client is untyped across this codebase
	supabase: any,
	userId: string,
	provider: UserKeyProvider
): Promise<string | null> {
	return readStoredSecret(supabase, 'user_api_keys', { user_id: userId, provider });
}

export function sanitizeKeyMetadata(row: any): UserApiKeyMetadata {
	return {
		provider: row.provider,
		masked_value: row.masked_value,
		status: row.status || 'untested',
		last_error: row.last_error || null,
		last_tested_at: row.last_tested_at || null,
		updated_at: row.updated_at || null
	};
}
