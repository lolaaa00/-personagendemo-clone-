import { browser } from '$app/environment';

/* ═══════════════════════════════════════════════════════════════
   Toast Queue (Svelte 5 Runes)
   ═══════════════════════════════════════════════════════════════ */

export interface ToastMessage {
	id: string;
	message: string;
	type: 'success' | 'error' | 'info' | 'warning';
}

export const toasts = $state<ToastMessage[]>([]);

export function showToast(message: string, type: ToastMessage['type'] = 'success'): void {
	const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
	toasts.push({ id, message, type });
	setTimeout(() => {
		const index = toasts.findIndex((toast) => toast.id === id);
		if (index !== -1) {
			toasts.splice(index, 1);
		}
	}, 4000);
}

export function dismissToast(id: string): void {
	const index = toasts.findIndex((toast) => toast.id === id);
	if (index !== -1) {
		toasts.splice(index, 1);
	}
}

/* ═══════════════════════════════════════════════════════════════
   Sidebar State (Svelte 5 Runes)
   ═══════════════════════════════════════════════════════════════ */

export const sidebarState = $state({
	open: false,
	collapsed: false
});

export function toggleSidebar(): void {
	sidebarState.open = !sidebarState.open;
}

export function toggleSidebarCollapse(): void {
	sidebarState.collapsed = !sidebarState.collapsed;
}

export function closeSidebar(): void {
	sidebarState.open = false;
}

/* ═══════════════════════════════════════════════════════════════
   Theme & Brand Color State (Svelte 5 Runes)
   ═══════════════════════════════════════════════════════════════ */

export type Theme = 'light' | 'dark';

export const themeState = $state<{ current: Theme }>({
	current: 'light' // Default to light mode
});

export const DEFAULT_BRAND_PRIMARY = '#7c6aed';
export const DEFAULT_BRAND_SECONDARY = '#22d3ee';

/**
 * Which brand brief (if any) dresses the app palette. Opt-in ONLY, chosen in
 * Settings → Brand Theme: the Brand Brief editor used to hijack `--accent`/
 * `--cyan` live while you typed and fire a sparkle animation on save, so
 * merely scraping a store repainted the whole UI in that brand's colors.
 */
const BRAND_THEME_KEY = 'personagen_brand_theme';

export const brandColorsState = $state({
	primary: DEFAULT_BRAND_PRIMARY,
	secondary: DEFAULT_BRAND_SECONDARY
});

export const brandThemeState = $state<{ briefId: string | null; name: string }>({
	briefId: null,
	name: ''
});

// Sparkles / Radial wave transform state
export const brandTransformState = $state({
	active: false,
	x: 0,
	y: 0,
	primary: '#7c6aed',
	secondary: '#22d3ee'
});

export function toggleTheme(): void {
	const nextTheme = themeState.current === 'light' ? 'dark' : 'light';
	setTheme(nextTheme);
}

export function setTheme(newTheme: Theme): void {
	themeState.current = newTheme;
	if (browser) {
		localStorage.setItem('personagen_theme', newTheme);
		document.documentElement.setAttribute('data-theme', newTheme);
	}
}

export function updateBrandColors(primary: string, secondary: string): void {
	brandColorsState.primary = primary || DEFAULT_BRAND_PRIMARY;
	brandColorsState.secondary = secondary || DEFAULT_BRAND_SECONDARY;
	if (browser) {
		const root = document.documentElement;
		root.style.setProperty('--accent', brandColorsState.primary);
		root.style.setProperty('--cyan', brandColorsState.secondary);
	}
}

/**
 * Dresses the app in a brief's colors and remembers the choice locally so the
 * next page load paints correctly before any network call resolves.
 */
export function applyBrandTheme(
	briefId: string,
	name: string,
	primary: string,
	secondary: string
): void {
	brandThemeState.briefId = briefId;
	brandThemeState.name = name;
	updateBrandColors(primary, secondary);
	if (browser) {
		localStorage.setItem(
			BRAND_THEME_KEY,
			JSON.stringify({
				briefId,
				name,
				primary: brandColorsState.primary,
				secondary: brandColorsState.secondary
			})
		);
	}
}

/** Back to the stock PersonaGen palette. */
export function clearBrandTheme(): void {
	brandThemeState.briefId = null;
	brandThemeState.name = '';
	updateBrandColors(DEFAULT_BRAND_PRIMARY, DEFAULT_BRAND_SECONDARY);
	if (browser) localStorage.removeItem(BRAND_THEME_KEY);
}

export function triggerBrandTransform(
	x: number,
	y: number,
	primary: string,
	secondary: string
): void {
	brandTransformState.primary = primary || '#7c6aed';
	brandTransformState.secondary = secondary || '#22d3ee';
	brandTransformState.x = x;
	brandTransformState.y = y;
	brandTransformState.active = true;

	updateBrandColors(primary, secondary);

	// Auto-deactivate transform layer after animation finishes
	setTimeout(() => {
		brandTransformState.active = false;
	}, 1600);
}

export function initializeThemeAndColors(): void {
	if (!browser) return;

	// 1. Theme initialization (Default to light)
	const savedTheme = localStorage.getItem('personagen_theme') as Theme;
	const initialTheme = savedTheme || 'light';
	setTheme(initialTheme);

	// 2. Brand palette — ONLY from an explicit Settings → Brand Theme choice.
	//    Deliberately NOT read from the active brand brief: editing or scraping
	//    a brief must never repaint the app.
	try {
		const saved = localStorage.getItem(BRAND_THEME_KEY);
		if (saved) {
			const parsed = JSON.parse(saved);
			brandThemeState.briefId = parsed.briefId ?? null;
			brandThemeState.name = parsed.name ?? '';
			updateBrandColors(parsed.primary, parsed.secondary);
		} else {
			updateBrandColors(DEFAULT_BRAND_PRIMARY, DEFAULT_BRAND_SECONDARY);
		}
	} catch (err) {
		console.error('Error initializing brand theme:', err);
		clearBrandTheme();
	}
}
