/**
 * `use:dialog` — the modal contract in one place.
 *
 * The app grew ~18 hand-rolled dialogs. A previous pass added `aria-modal="true"`
 * to several of them, which promises assistive tech that everything outside the
 * dialog is inert — but none of them trapped focus, so the promise was false and
 * a screen-reader user tabbed straight into content their AT had been told was
 * unavailable. That is worse than no `aria-modal` at all.
 *
 * Rather than restructure every dialog's markup onto <Modal>, this action gives
 * any element the full contract in one line:
 *
 *   <div role="dialog" aria-modal="true" tabindex="-1" use:dialog={{ onClose }}>
 *
 * It provides: initial focus, a Tab/Shift+Tab trap, a focusin guard (a Tab-only
 * trap is defeated by a mouse click), Escape-to-close, background scroll lock,
 * and focus restoration to whatever opened it.
 *
 * Nesting is handled with a stack: only the topmost dialog responds to keys, and
 * the scroll lock is reference-counted so closing an inner dialog doesn't unlock
 * the page while an outer one is still open.
 */

export interface DialogOptions {
	/** Called on Escape and (if you wire it) backdrop click. Omit to disable Escape. */
	onClose?: () => void;
	/** Where focus should land on open. Selector, element, or omit for the first focusable. */
	initialFocus?: string | HTMLElement | null;
	/** Set false for non-modal popovers that shouldn't trap. Default true. */
	trapFocus?: boolean;
	/** Set false if the dialog is small and the page behind should stay scrollable. Default true. */
	lockScroll?: boolean;
	/** Set false to opt out of Escape handling (e.g. a destructive confirm you want deliberate). */
	closeOnEscape?: boolean;
}

const FOCUSABLE = [
	'a[href]',
	'area[href]',
	'button:not([disabled])',
	'input:not([disabled]):not([type="hidden"])',
	'select:not([disabled])',
	'textarea:not([disabled])',
	'iframe',
	'audio[controls]',
	'video[controls]',
	'[contenteditable]:not([contenteditable="false"])',
	'[tabindex]:not([tabindex="-1"])'
].join(',');

interface Entry {
	node: HTMLElement;
	opts: DialogOptions;
	returnTo: HTMLElement | null;
}

/** Topmost dialog is last. Only it reacts to Escape/Tab. */
const stack: Entry[] = [];

/** Elements we locked, so we can restore their exact inline styles on the last unlock. */
let lockedTargets: { el: HTMLElement; overflow: string; paddingRight: string }[] = [];

function isVisible(el: HTMLElement): boolean {
	return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
}

function focusablesIn(node: HTMLElement): HTMLElement[] {
	return Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
		(el) => isVisible(el) && el.getAttribute('aria-hidden') !== 'true'
	);
}

/**
 * The portal scrolls `.portal-content`, not <body> — locking only <body> leaves
 * the page behind a dialog scrollable on every portal route. Lock both.
 */
function scrollTargets(): HTMLElement[] {
	const targets: HTMLElement[] = [document.body];
	document.querySelectorAll<HTMLElement>('.portal-content').forEach((el) => targets.push(el));
	return targets;
}

function lockScroll() {
	if (lockedTargets.length) return; // already locked by an outer dialog
	lockedTargets = scrollTargets().map((el) => {
		const prevOverflow = el.style.overflow;
		const prevPad = el.style.paddingRight;
		// Compensate the scrollbar so hiding it doesn't shift the layout sideways.
		const gap = el === document.body ? window.innerWidth - document.documentElement.clientWidth : el.offsetWidth - el.clientWidth;
		if (gap > 0) {
			const current = parseFloat(getComputedStyle(el).paddingRight) || 0;
			el.style.paddingRight = `${current + gap}px`;
		}
		el.style.overflow = 'hidden';
		return { el, overflow: prevOverflow, paddingRight: prevPad };
	});
}

function unlockScroll() {
	if (stack.length > 0) return; // an outer dialog is still open
	for (const { el, overflow, paddingRight } of lockedTargets) {
		el.style.overflow = overflow;
		el.style.paddingRight = paddingRight;
	}
	lockedTargets = [];
}

function top(): Entry | undefined {
	return stack[stack.length - 1];
}

function onKeydown(e: KeyboardEvent) {
	const entry = top();
	if (!entry) return;
	const { node, opts } = entry;

	if (e.key === 'Escape') {
		if (opts.closeOnEscape === false || !opts.onClose) return;
		e.stopPropagation();
		e.preventDefault();
		opts.onClose();
		return;
	}

	if (e.key !== 'Tab' || opts.trapFocus === false) return;

	const items = focusablesIn(node);
	if (items.length === 0) {
		// Nothing tabbable inside — keep focus on the dialog itself rather than
		// letting it fall through to the page behind.
		e.preventDefault();
		node.focus({ preventScroll: true });
		return;
	}

	const first = items[0];
	const last = items[items.length - 1];
	const active = document.activeElement as HTMLElement | null;

	if (e.shiftKey) {
		if (active === first || active === node || !node.contains(active)) {
			e.preventDefault();
			last.focus();
		}
	} else if (active === last || active === node || !node.contains(active)) {
		e.preventDefault();
		first.focus();
	}
}

/**
 * A Tab-only trap is defeated by clicking something behind the dialog. If focus
 * lands outside the topmost dialog, pull it back.
 */
function onFocusIn(e: FocusEvent) {
	const entry = top();
	if (!entry || entry.opts.trapFocus === false) return;
	const target = e.target as HTMLElement | null;
	if (target && !entry.node.contains(target)) {
		const items = focusablesIn(entry.node);
		(items[0] ?? entry.node).focus({ preventScroll: true });
	}
}

function attachGlobals() {
	if (stack.length !== 1) return; // only on the first dialog
	document.addEventListener('keydown', onKeydown, true);
	document.addEventListener('focusin', onFocusIn, true);
}

function detachGlobals() {
	if (stack.length !== 0) return; // outer dialogs still open
	document.removeEventListener('keydown', onKeydown, true);
	document.removeEventListener('focusin', onFocusIn, true);
}

function resolveInitial(node: HTMLElement, initialFocus: DialogOptions['initialFocus']): HTMLElement {
	if (initialFocus instanceof HTMLElement) return initialFocus;
	if (typeof initialFocus === 'string') {
		const found = node.querySelector<HTMLElement>(initialFocus);
		if (found) return found;
	}
	// Prefer the dialog container itself so screen readers announce the dialog's
	// label before its first control, matching native <dialog> behaviour.
	return node;
}

export function dialog(node: HTMLElement, options: DialogOptions = {}) {
	let opts = options;

	// The element must be programmatically focusable for the container-first
	// focus strategy to work; don't make it a tab stop.
	if (!node.hasAttribute('tabindex')) node.setAttribute('tabindex', '-1');

	const entry: Entry = {
		node,
		opts,
		returnTo: document.activeElement instanceof HTMLElement ? document.activeElement : null
	};

	stack.push(entry);
	attachGlobals();
	if (opts.lockScroll !== false) lockScroll();

	// Wait a frame: transitions (Svelte's fly/fade) can leave the node
	// zero-sized on mount, which makes every child fail the visibility test.
	requestAnimationFrame(() => {
		if (!node.isConnected || top() !== entry) return;
		resolveInitial(node, opts.initialFocus).focus({ preventScroll: true });
	});

	return {
		update(next: DialogOptions = {}) {
			opts = next;
			entry.opts = next;
		},
		destroy() {
			const i = stack.indexOf(entry);
			if (i !== -1) stack.splice(i, 1);
			detachGlobals();
			unlockScroll();

			const back = entry.returnTo;
			if (back && back.isConnected && typeof back.focus === 'function') {
				back.focus({ preventScroll: true });
			}
		}
	};
}
