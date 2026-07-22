/**
 * Single source of truth for platform display data (color, label). Client-safe
 * (not under lib/server) so both Svelte components and server routes can import
 * it. This existed as 5 separately-drifting copies before consolidation — one of
 * them (calendar's dead `getPlatformColor`) had a stale TikTok color with zero
 * call sites, and X's color had genuinely diverged (3 copies on the old
 * pre-rebrand Twitter blue, 2 on a closer-to-current dark value).
 */
export interface PlatformInfo {
	key: string;
	label: string;
	color: string;
}

export const PLATFORMS: Record<string, PlatformInfo> = {
	instagram: { key: 'instagram', label: 'Instagram', color: '#e1306c' },
	tiktok: { key: 'tiktok', label: 'TikTok', color: '#fe2c55' },
	youtube: { key: 'youtube', label: 'YouTube', color: '#ff0000' },
	facebook: { key: 'facebook', label: 'Facebook', color: '#1877f2' },
	x: { key: 'x', label: 'X', color: '#000000' },
	threads: { key: 'threads', label: 'Threads', color: '#000000' },
	linkedin: { key: 'linkedin', label: 'LinkedIn', color: '#0A66C2' },
	bluesky: { key: 'bluesky', label: 'Bluesky', color: '#0285FF' },
	pinterest: { key: 'pinterest', label: 'Pinterest', color: '#E60023' },
	reddit: { key: 'reddit', label: 'Reddit', color: '#FF4500' },
	googlebusiness: { key: 'googlebusiness', label: 'Google Business', color: '#4285F4' },
	telegram: { key: 'telegram', label: 'Telegram', color: '#26A5E4' },
	snapchat: { key: 'snapchat', label: 'Snapchat', color: '#FFFC00' }
};

/** Every platform PersonaGen can connect + publish through Zernio. */
export const ALL_PLATFORM_KEYS = Object.keys(PLATFORMS);

export function platformColor(key: string | undefined | null): string {
	return PLATFORMS[key?.toLowerCase() ?? '']?.color || 'var(--accent)';
}

export function platformLabel(key: string | undefined | null): string {
	return PLATFORMS[key?.toLowerCase() ?? '']?.label || (key ?? '');
}

/**
 * Public profile URL for a connected handle, or `null` when we can't build one
 * (empty handle, or a platform with no canonical per-handle URL). Strips any
 * leading `@` so both "@user" and "user" resolve the same. Used to turn the
 * displayed handles on the persona Connections tab into real, clickable links.
 */
export function platformProfileUrl(
	key: string | undefined | null,
	handle: string | undefined | null
): string | null {
	const h = (handle ?? '').trim().replace(/^@+/, '');
	if (!h) return null;
	switch (key?.toLowerCase() ?? '') {
		case 'instagram':
			return `https://instagram.com/${h}`;
		case 'tiktok':
			return `https://tiktok.com/@${h}`;
		case 'youtube':
			return `https://youtube.com/@${h}`;
		case 'facebook':
			return `https://facebook.com/${h}`;
		case 'x':
			return `https://x.com/${h}`;
		case 'threads':
			return `https://threads.net/@${h}`;
		case 'linkedin':
			return `https://linkedin.com/in/${h}`;
		case 'bluesky':
			return `https://bsky.app/profile/${h}`;
		case 'pinterest':
			return `https://pinterest.com/${h}`;
		case 'reddit':
			return `https://reddit.com/user/${h}`;
		case 'telegram':
			return `https://t.me/${h}`;
		case 'snapchat':
			return `https://snapchat.com/add/${h}`;
		// Google Business has no canonical public @handle URL.
		default:
			return null;
	}
}
