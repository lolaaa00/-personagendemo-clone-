<script lang="ts">
	import { personaStatus } from '$lib/status-color';
	interface Props {
		status: string;
	}

	let { status }: Props = $props();

	// Labels come from the shared status map. This component used to return
	// 'PENDING' in capitals while every sibling returned lower case.
	const statusConfig = $derived({
		label: personaStatus(status).label,
		cssClass: ['active', 'paused', 'pending', 'failing'].includes(status) ? status : 'paused'
	});
</script>

<span class="dash-status {statusConfig.cssClass}" role="status">
	<span class="dash-status-dot" aria-hidden="true"></span>
	{statusConfig.label}
</span>

<style>
	.dash-status {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-size: 0.65rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.dash-status-dot {
		width: 5px;
		height: 5px;
		border-radius: 50%;
	}

	/* Status is never colour-only — the word itself is always rendered beside the dot,
	   and the dot is aria-hidden. The label uses the AA `-text` token variants because
	   at 0.65rem the raw fill hues fall under 4.5:1 on the light surface; the dots keep
	   the vivid fill colours, which only need 3:1 as non-text. */
	.dash-status.active {
		color: var(--success-text);
	}
	.dash-status.active .dash-status-dot {
		background: var(--success);
	}

	.dash-status.paused {
		color: var(--gold);
	}
	.dash-status.paused .dash-status-dot {
		background: var(--gold);
	}

	.dash-status.pending {
		color: var(--warning-text);
	}
	.dash-status.pending .dash-status-dot {
		background: var(--warning);
		animation: pulse-amber 2s infinite;
	}

	@media (prefers-reduced-motion: reduce) {
		.dash-status.pending .dash-status-dot {
			animation: none;
		}
	}

	.dash-status.failing {
		color: var(--rose-text);
	}
	.dash-status.failing .dash-status-dot {
		background: var(--rose);
	}

	@keyframes pulse-amber {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.4;
		}
	}
</style>
