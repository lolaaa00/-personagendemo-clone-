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
	tiktok: { key: 'tiktok', label: 'TikTok', color: '#fe2c55' },
	instagram: { key: 'instagram', label: 'Instagram', color: '#e1306c' },
	youtube: { key: 'youtube', label: 'YouTube', color: '#ff0000' },
	facebook: { key: 'facebook', label: 'Facebook', color: '#1877f2' },
	x: { key: 'x', label: 'X', color: '#000000' },
	threads: { key: 'threads', label: 'Threads', color: '#999999' }
};

export function platformColor(key: string | undefined | null): string {
	return PLATFORMS[key?.toLowerCase() ?? '']?.color || 'var(--accent)';
}

export function platformLabel(key: string | undefined | null): string {
	return PLATFORMS[key?.toLowerCase() ?? '']?.label || (key ?? '');
}
