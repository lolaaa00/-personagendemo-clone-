<script lang="ts">
	interface Props {
		status: string;
	}

	let { status }: Props = $props();

	const statusConfig = $derived.by(() => {
		switch (status) {
			case 'active':
				return { label: 'active', cssClass: 'active' };
			case 'paused':
				return { label: 'paused', cssClass: 'paused' };
			case 'pending':
				return { label: 'PENDING', cssClass: 'pending' };
			case 'failing':
				return { label: 'failing', cssClass: 'failing' };
			default:
				return { label: status, cssClass: 'paused' };
		}
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

	.dash-status.active {
		color: var(--success);
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
		color: #f59e0b;
	}
	.dash-status.pending .dash-status-dot {
		background: #f59e0b;
		animation: pulse-amber 2s infinite;
	}

	.dash-status.failing {
		color: var(--rose);
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
