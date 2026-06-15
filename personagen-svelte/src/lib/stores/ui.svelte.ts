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

export const brandColorsState = $state({
	primary: '#7c6aed',
	secondary: '#22d3ee'
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
	brandColorsState.primary = primary || '#7c6aed';
	brandColorsState.secondary = secondary || '#22d3ee';
	if (browser) {
		const root = document.documentElement;
		root.style.setProperty('--accent', brandColorsState.primary);
		root.style.setProperty('--cyan', brandColorsState.secondary);
	}
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

	// 2. Brand colors initialization
	try {
		const savedBrief = localStorage.getItem('personagen_brand_brief');
		if (savedBrief) {
			const parsed = JSON.parse(savedBrief);
			const primary = parsed.primaryColor || '#7c6aed';
			const secondary = parsed.secondaryColor || '#22d3ee';
			updateBrandColors(primary, secondary);
		} else {
			updateBrandColors('#7c6aed', '#22d3ee');
		}
	} catch (err) {
		console.error('Error initializing brand colors:', err);
		updateBrandColors('#7c6aed', '#22d3ee');
	}
}
