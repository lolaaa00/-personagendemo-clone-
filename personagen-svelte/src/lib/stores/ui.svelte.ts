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

/**
 * Timing a reader controls (WCAG 2.2.1). Toasts vanished after a fixed 4s —
 * hovered, focused or not — and an ERROR, often the only account of what went
 * wrong, disappeared mid-sentence (round-2 re-audit). Now: pointer or focus on
 * a toast pauses its clock, errors stay until dismissed, and the stack keeps
 * the newest four so persistent errors cannot pile up forever.
 */
const AUTO_DISMISS_MS = 6000;
const MAX_TOASTS = 4;
// A plain record, deliberately NOT reactive: nothing renders from it.
const timers: Record<
	string,
	{ handle: ReturnType<typeof setTimeout> | null; remaining: number; startedAt: number }
> = {};

function startTimer(id: string, ms: number): void {
	const handle = setTimeout(() => dismissToast(id), ms);
	timers[id] = { handle, remaining: ms, startedAt: Date.now() };
}

export function showToast(message: string, type: ToastMessage['type'] = 'success'): void {
	const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
	toasts.push({ id, message, type });
	while (toasts.length > MAX_TOASTS) {
		const oldest = toasts.shift();
		if (oldest) clearToastTimer(oldest.id);
	}
	if (type !== 'error') startTimer(id, AUTO_DISMISS_MS);
}

/** Hover or focus: stop the clock. */
export function pauseToast(id: string): void {
	const t = timers[id];
	if (!t?.handle) return;
	clearTimeout(t.handle);
	t.remaining = Math.max(0, t.remaining - (Date.now() - t.startedAt));
	t.handle = null;
}

/** Pointer or focus left: resume, never with less than a moment to read. */
export function resumeToast(id: string): void {
	const t = timers[id];
	if (!t || t.handle) return;
	t.startedAt = Date.now();
	t.handle = setTimeout(() => dismissToast(id), Math.max(1500, t.remaining));
}

function clearToastTimer(id: string): void {
	const t = timers[id];
	if (t?.handle) clearTimeout(t.handle);
	delete timers[id];
}

export function dismissToast(id: string): void {
	clearToastTimer(id);
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

	// 1. Theme initialization.
	//    An explicit choice always wins. With nothing stored we follow the OS
	//    rather than forcing light: the dark palette is fully defined under
	//    [data-theme='dark'] but nothing ever set that attribute for a first-time
	//    visitor, so a dark-mode user was served the light theme — most visibly on
	//    the marketing page, which renders before any toggle is reachable.
	const savedTheme = localStorage.getItem('personagen_theme') as Theme | null;
	const prefersDark =
		typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
	setTheme(savedTheme || (prefersDark ? 'dark' : 'light'));

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
