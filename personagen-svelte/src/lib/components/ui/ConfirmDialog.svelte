<script lang="ts">
	/**
	 * The app's single confirmation dialog. Mounted once in the portal layout;
	 * driven imperatively via `confirmAction()` from $lib/stores/confirm.
	 *
	 * Deliberate choices:
	 *  - Cancel takes initial focus, so a reflexive Enter cancels, never deletes.
	 *  - Escape and backdrop click both cancel (`use:dialog` handles Escape).
	 *  - The preview strip shows the actual media and caption, which is the whole
	 *    reason this exists instead of a native confirm().
	 */
	import { dialog } from '$lib/actions/dialog';
	import { confirmState, settleConfirm } from '$lib/stores/confirm.svelte';

	let typed = $state('');

	// Reset the type-to-confirm box each time the dialog opens, or the previous
	// answer would still be sitting there pre-satisfying the guard.
	$effect(() => {
		if (confirmState.open) typed = '';
	});

	const needsTyping = $derived(!!confirmState.typeToConfirm);
	// A required prompt gates Confirm the same way type-to-confirm does.
	const promptUnfilled = $derived(
		!!confirmState.prompt?.required && confirmState.promptValue.trim().length === 0
	);
	const canConfirm = $derived(
		!promptUnfilled &&
			(!needsTyping ||
			typed.trim().toLowerCase() === (confirmState.typeToConfirm ?? '').trim().toLowerCase())
	);

	const shown = $derived((confirmState.preview ?? []).slice(0, 4));
	const overflow = $derived(Math.max(0, (confirmState.preview?.length ?? 0) - 4));

	function cancel() {
		settleConfirm(false);
	}
	function accept() {
		if (!canConfirm) return;
		settleConfirm(true);
	}
</script>

{#if confirmState.open}
	<div class="confirm-backdrop" onclick={cancel} role="presentation">
		<div
			class="confirm-modal tone-{confirmState.tone ?? 'caution'}"
			onclick={(e) => e.stopPropagation()}
			role="alertdialog"
			aria-modal="true"
			aria-labelledby="confirm-title"
			aria-describedby={confirmState.body ? 'confirm-body' : undefined}
			tabindex="-1"
			use:dialog={{ onClose: cancel, initialFocus: '[data-confirm-cancel]' }}
		>
			<div class="confirm-head">
				<span class="confirm-icon" aria-hidden="true">
					{#if confirmState.tone === 'neutral'}
						<svg
							width="20"
							height="20"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
						>
							<path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
							<path d="M3 3v5h5" />
						</svg>
					{:else}
						<svg
							width="20"
							height="20"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
						>
							<path d="M12 9v4" />
							<path d="M12 17h.01" />
							<path
								d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"
							/>
						</svg>
					{/if}
				</span>
				<h3 id="confirm-title">{confirmState.title}</h3>
			</div>

			<div class="confirm-body">
				{#if confirmState.body}
					<p id="confirm-body" class="confirm-text">{confirmState.body}</p>
				{/if}

				{#if shown.length > 0}
					<ul class="confirm-preview" aria-label="Items affected">
						{#each shown as item}
							<li class="preview-row">
								<span
									class="preview-thumb"
									style={item.image
										? `background-image:url(${item.image})`
										: `background:${item.gradient || 'var(--surface-2)'}`}
								>
									{#if !item.image}
										<span class="preview-initial">{item.initial || item.label.charAt(0)}</span>
									{/if}
								</span>
								<span class="preview-copy">
									<span class="preview-label">{item.label}</span>
									{#if item.meta}<span class="preview-meta">{item.meta}</span>{/if}
								</span>
								{#if item.badge}<span class="preview-badge">{item.badge}</span>{/if}
							</li>
						{/each}
						{#if overflow > 0}
							<li class="preview-more">+{overflow} more</li>
						{/if}
					</ul>
				{/if}

				{#if confirmState.warning}
					<p class="confirm-warning">{confirmState.warning}</p>
				{/if}

				{#if confirmState.prompt}
					<label class="confirm-prompt">
						<span>{confirmState.prompt.label}</span>
						<input
							type="text"
							bind:value={confirmState.promptValue}
							autocomplete="off"
							placeholder={confirmState.prompt.placeholder ?? ''}
							required={confirmState.prompt.required ?? false}
							onkeydown={(e) => e.key === 'Enter' && accept()}
						/>
					</label>
				{/if}

				{#if needsTyping}
					<label class="confirm-type">
						<span>Type <strong>{confirmState.typeToConfirm}</strong> to confirm</span>
						<input
							type="text"
							bind:value={typed}
							autocomplete="off"
							spellcheck="false"
							placeholder={confirmState.typeToConfirm}
							onkeydown={(e) => e.key === 'Enter' && accept()}
						/>
					</label>
				{/if}
			</div>

			<div class="confirm-foot">
				<button class="btn-cancel" data-confirm-cancel onclick={cancel}>
					{confirmState.cancelLabel ?? 'Cancel'}
				</button>
				<button class="btn-confirm" onclick={accept} disabled={!canConfirm}>
					{confirmState.confirmLabel ?? 'Delete'}
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.confirm-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(15, 23, 42, 0.75);
		backdrop-filter: blur(8px);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: var(--z-overlay);
		padding: 1.5rem;
		animation: confirm-fade 0.14s ease-out;
	}

	@keyframes confirm-fade {
		from {
			opacity: 0;
		}
	}

	.confirm-modal {
		--tone: #f59e0b;
		background: var(--surface);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius);
		width: 100%;
		max-width: 440px;
		max-height: 85dvh;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		box-shadow:
			0 20px 25px -5px rgba(0, 0, 0, 0.35),
			0 0 50px color-mix(in srgb, var(--tone) 14%, transparent);
		animation: confirm-rise 0.16s cubic-bezier(0.16, 1, 0.3, 1);
	}

	@keyframes confirm-rise {
		from {
			opacity: 0;
			transform: translateY(8px) scale(0.985);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.confirm-backdrop,
		.confirm-modal {
			animation: none;
		}
	}

	.confirm-modal.tone-danger {
		--tone: #ef4444;
	}
	.confirm-modal.tone-neutral {
		--tone: var(--accent);
	}

	.confirm-head {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 1.25rem 1.5rem 0.85rem;
	}

	.confirm-icon {
		flex-shrink: 0;
		width: 36px;
		height: 36px;
		border-radius: 999px;
		display: grid;
		place-items: center;
		color: var(--tone);
		background: color-mix(in srgb, var(--tone) 14%, transparent);
	}

	.confirm-head h3 {
		margin: 0;
		font-size: 1rem;
		font-weight: 600;
		color: var(--text);
		line-height: 1.35;
	}

	.confirm-body {
		padding: 0 1.5rem 0.25rem;
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
		overflow-y: auto;
	}

	.confirm-text {
		margin: 0;
		font-size: 0.82rem;
		line-height: 1.6;
		color: var(--text-dim);
	}

	.confirm-preview {
		list-style: none;
		margin: 0;
		padding: 0.5rem;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
	}

	.preview-row {
		display: flex;
		align-items: center;
		gap: 0.65rem;
		min-width: 0;
	}

	.preview-thumb {
		flex-shrink: 0;
		width: 38px;
		height: 38px;
		border-radius: var(--radius-sm);
		background-size: cover;
		background-position: center;
		border: 1px solid var(--border);
		display: grid;
		place-items: center;
	}

	.preview-initial {
		font-size: 0.8rem;
		font-weight: 700;
		color: #fff;
		text-shadow: 0 1px 2px rgba(0, 0, 0, 0.35);
	}

	.preview-copy {
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		flex: 1;
	}

	.preview-label {
		font-size: 0.78rem;
		font-weight: 600;
		color: var(--text);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.preview-meta {
		font-size: 0.68rem;
		color: var(--text-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.preview-badge {
		flex-shrink: 0;
		font-size: 0.6rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		padding: 3px 7px;
		border-radius: 999px;
		color: var(--tone);
		background: color-mix(in srgb, var(--tone) 12%, transparent);
	}

	.preview-more {
		font-size: 0.7rem;
		color: var(--text-muted);
		padding-left: 0.25rem;
	}

	.confirm-warning {
		margin: 0;
		font-size: 0.74rem;
		line-height: 1.5;
		color: var(--tone);
		background: color-mix(in srgb, var(--tone) 10%, transparent);
		border: 1px solid color-mix(in srgb, var(--tone) 28%, transparent);
		border-radius: var(--radius-sm);
		padding: 0.6rem 0.75rem;
	}

	.confirm-prompt,
	.confirm-type {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		font-size: 0.72rem;
		color: var(--text-dim);
	}

	.confirm-type strong {
		color: var(--text);
	}

	.confirm-prompt input,
	.confirm-type input {
		font-size: 0.82rem;
		padding: 0.5rem 0.7rem;
		border-radius: var(--radius-sm);
		border: 1px solid var(--border-strong);
		background: var(--surface-2);
		color: var(--text);
	}

	.confirm-type input:focus-visible {
		outline: 2px solid var(--tone);
		outline-offset: 1px;
	}

	.confirm-foot {
		display: flex;
		justify-content: flex-end;
		gap: 0.6rem;
		padding: 1.1rem 1.5rem 1.25rem;
	}

	.confirm-foot button {
		min-height: 38px;
		padding: 0 1.05rem;
		border-radius: var(--radius-sm);
		font-size: 0.8rem;
		font-weight: 600;
		cursor: pointer;
		transition:
			background 0.15s,
			border-color 0.15s,
			opacity 0.15s;
	}

	.btn-cancel {
		background: var(--surface-2);
		border: 1px solid var(--border-strong);
		color: var(--text);
	}

	.btn-cancel:hover {
		background: var(--border);
	}

	.btn-confirm {
		background: var(--tone);
		border: 1px solid var(--tone);
		color: #fff;
	}

	.btn-confirm:hover:not(:disabled) {
		filter: brightness(1.08);
	}

	.btn-confirm:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}

	.confirm-foot button:focus-visible {
		outline: 2px solid var(--tone);
		outline-offset: 2px;
	}
</style>
