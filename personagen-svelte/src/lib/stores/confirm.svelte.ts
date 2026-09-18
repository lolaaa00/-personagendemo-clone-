/* ═══════════════════════════════════════════════════════════════
   Destructive-action confirmation (Svelte 5 Runes)

   Replaces the scattered native `confirm()` calls. Those were inconsistent —
   the per-card trash can on the persona feed had NO confirmation at all and
   deleted permanently on one click — and a native prompt can't show you what
   you're about to lose.

   The API is promise-based so it drops straight into the old shape:

     if (!confirm('Delete?')) return;
     →
     if (!(await confirmAction({ title: 'Delete?' }))) return;

   Mount <ConfirmDialog /> once (portal layout) and this works app-wide.
   ═══════════════════════════════════════════════════════════════ */

export interface ConfirmPreviewItem {
	/** Thumbnail source. Videos pass their poster here. */
	image?: string | null;
	/** Shown when there is no image — first letter of the label, on a gradient. */
	gradient?: string | null;
	initial?: string | null;
	label: string;
	/** Second line: caption snippet, schedule, platform… */
	meta?: string | null;
	badge?: string | null;
}

export interface ConfirmRequest {
	title: string;
	/** One or two sentences on what actually happens. Plain language, no jargon. */
	body?: string;
	/** The consequence line, rendered as a warning strip. Omit if it's reversible. */
	warning?: string;
	/** What the user is about to act on. Up to 4 render; the rest collapse to "+N more". */
	preview?: ConfirmPreviewItem[];
	confirmLabel?: string;
	cancelLabel?: string;
	/**
	 * 'danger'  — permanent, unrecoverable (Empty Trash, delete a persona)
	 * 'caution' — reversible from the Trash (the everyday post delete)
	 * 'neutral' — not destructive at all (restore, unpublish)
	 */
	tone?: 'danger' | 'caution' | 'neutral';
	/**
	 * Requires typing this exact word before Confirm enables. Reserve it for
	 * actions with no undo path — a type-to-confirm on an everyday delete just
	 * trains people to type without reading.
	 */
	typeToConfirm?: string | null;
	/**
	 * Ask for a line of text as part of confirming — the Admin Console's audit
	 * note, for instance. Use `promptAction()` to read it back.
	 *
	 * This exists because those notes were collected with `window.prompt()`: a
	 * browser chrome dialog that cannot be styled, cannot show which row is being
	 * changed, and in several browsers is suppressed entirely after the user
	 * dismisses one — silently turning a mandatory audit note into no note.
	 */
	prompt?: {
		label: string;
		placeholder?: string;
		/** Confirm stays disabled until something is typed. */
		required?: boolean;
		initial?: string;
	} | null;
}

interface ConfirmState extends ConfirmRequest {
	open: boolean;
	resolve: ((ok: boolean) => void) | null;
	/** Live value of the optional prompt field. */
	promptValue: string;
}

export const confirmState = $state<ConfirmState>({
	open: false,
	title: '',
	resolve: null,
	promptValue: ''
});

/**
 * Opens the confirmation and resolves true only on an explicit confirm.
 * Escape, Cancel, and backdrop click all resolve false.
 *
 * A second call while one is open resolves the first as CANCELLED rather than
 * stacking — two destructive prompts fighting over one Enter key is how people
 * delete things they meant to keep.
 */
export function confirmAction(req: ConfirmRequest): Promise<boolean> {
	confirmState.resolve?.(false);

	return new Promise<boolean>((resolve) => {
		Object.assign(confirmState, {
			tone: 'caution',
			confirmLabel: 'Delete',
			cancelLabel: 'Cancel',
			body: undefined,
			warning: undefined,
			preview: undefined,
			typeToConfirm: null,
			prompt: null,
			...req,
			promptValue: req.prompt?.initial ?? '',
			open: true,
			resolve
		});
	});
}

/**
 * Confirm, and collect a line of text with it. Resolves the typed value, or
 * null when the user cancels. An empty string is only possible when the prompt
 * is not `required`.
 */
export async function promptAction(
	req: ConfirmRequest & { prompt: NonNullable<ConfirmRequest['prompt']> }
): Promise<string | null> {
	const ok = await confirmAction(req);
	return ok ? confirmState.promptValue.trim() : null;
}

/** Called by the dialog only. */
export function settleConfirm(ok: boolean): void {
	const resolve = confirmState.resolve;
	confirmState.open = false;
	confirmState.resolve = null;
	resolve?.(ok);
}
