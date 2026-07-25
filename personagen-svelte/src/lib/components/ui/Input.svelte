<script lang="ts">
	import type { HTMLInputAttributes } from 'svelte/elements';

	/**
	 * Props extend HTMLInputAttributes and anything unrecognised is spread onto the
	 * element. The previous closed interface enumerated ~9 props with no rest, so
	 * `inputmode`, arbitrary `aria-*` and `bind:this` were not merely ignored — passing
	 * them was a svelte-check excess-property error. That is why the two auth pages,
	 * this component's only consumers, had to drop it and hand-roll a native input to
	 * get real form a11y. Keep the rest spread if you touch this.
	 */
	interface Props extends Omit<HTMLInputAttributes, 'value' | 'class'> {
		value: string;
		class?: string;
		/** Renders a wired-up <label for>. Omit when the page supplies its own label. */
		label?: string;
		/** Accessible name when there is no visible label anywhere. */
		ariaLabel?: string;
		/** Helper copy rendered under the field and linked via aria-describedby. */
		hint?: string;
		/** Error copy. Sets aria-invalid and role="alert" on the message. */
		error?: string | null;
		/** Bindable ref so callers can focus the field (e.g. first invalid on submit). */
		element?: HTMLInputElement | null;
	}

	let {
		value = $bindable(),
		element = $bindable(null),
		type = 'text',
		id,
		required = false,
		class: className = '',
		label,
		ariaLabel,
		hint,
		error = null,
		...rest
	}: Props = $props();

	// id/aria plumbing only — a stable unique base so label/hint/error can point at
	// the field even when the caller doesn't pass an id.
	const uid = $props.id();
	const fieldId = $derived(id ?? uid);
	const hintId = `${uid}-hint`;
	const errorId = `${uid}-error`;
	const describedBy = $derived(
		[hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined
	);
</script>

{#snippet control()}
	<input
		bind:this={element}
		id={fieldId}
		{type}
		{required}
		aria-label={label ? undefined : ariaLabel}
		aria-invalid={error ? 'true' : undefined}
		aria-describedby={describedBy}
		bind:value
		class="input-field {className}"
		{...rest}
	/>
{/snippet}

{#if label || hint || error}
	<div class="field">
		{#if label}
			<label class="field-label" for={fieldId}>
				{label}{#if required}<span class="field-req" aria-hidden="true">*</span>{/if}
			</label>
		{/if}
		{@render control()}
		{#if hint}
			<p class="field-hint" id={hintId}>{hint}</p>
		{/if}
		{#if error}
			<p class="field-error" id={errorId} role="alert">{error}</p>
		{/if}
	</div>
{:else}
	{@render control()}
{/if}

<style>
	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-2, 0.5rem);
	}

	.field-label {
		font-size: 0.85rem;
		font-weight: var(--weight-semi, 600);
		color: var(--text);
	}

	.field-req {
		color: var(--error-text);
		margin-left: 0.2rem;
	}

	.field-hint {
		margin: 0;
		font-size: 0.78rem;
		color: var(--text-muted);
	}

	.field-error {
		margin: 0;
		font-size: 0.78rem;
		font-weight: 600;
		color: var(--error-text);
	}

	/* Anything below 16px makes iOS Safari zoom the viewport on focus, so pin the
	   floor here rather than trusting whatever `class` a caller passes in. */
	.input-field {
		font-size: 1rem;
		min-height: 44px;
	}

	.input-field:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 1px;
	}

	.input-field[aria-invalid='true'] {
		border-color: var(--danger);
	}

	.input-field[aria-invalid='true']:focus {
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--danger) 25%, transparent);
	}
</style>
