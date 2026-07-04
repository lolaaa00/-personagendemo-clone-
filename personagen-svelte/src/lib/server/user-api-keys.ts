import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { env } from '$env/dynamic/private';

export const SUPPORTED_USER_KEY_PROVIDERS = [
	'zernio',
	'blotato',
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

export async function getUserApiKey(
	supabase: any,
	userId: string,
	provider: UserKeyProvider
): Promise<string | null> {
	const { data, error } = await supabase
		.from('user_api_keys')
		.select('encrypted_value, iv, auth_tag')
		.eq('user_id', userId)
		.eq('provider', provider)
		.maybeSingle();

	if (error) throw error;
	if (!data) return null;
	return decryptSecret(data);
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
