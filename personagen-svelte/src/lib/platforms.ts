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
