<script lang="ts">
	/**
	 * The frame every portal page sits in.
	 *
	 * Before this existed, each route had been designed alone, and it showed the
	 * moment you navigated: ten container widths from 800px to 100%, four gutter
	 * values and eight `h1` sizes across thirteen routes. Measured at 1920 the
	 * `h1` left edge moved 441px depending on which page you were on, and the
	 * same semantic level ranged from 21.6px on Trash to 67.2px on the Dashboard
	 * — a 3.1x swing. Every navigation made the reader find the page again.
	 *
	 * So the width, the gutter, the masthead and the heading scale live here and
	 * nowhere else. A route says what kind of page it is; it does not get to pick
	 * pixels. There are exactly two widths because the third one is always an
	 * argument nobody wins:
	 *
	 *   default (1200px) — anything that is not a dense data table
	 *   wide    (1440px) — dashboard, review, calendar, generations
	 *
	 * Two widths means two `h1` left edges at any viewport, which is the point:
	 * the eye lands in one of two places instead of ten.
	 *
	 * A form that wants a narrow measure does NOT ask for a narrow page — it
	 * wraps its fields in `.page-column`, so the masthead stays where the reader
	 * expects it and only the fields narrow.
	 */
	import type { Snippet } from 'svelte';

	interface Props {
		/** The page's name. Renders as the only `h1`, and should match the nav. */
		title: string;
		/** Small label above the title. Use sparingly — it is not a subtitle. */
		eyebrow?: string;
		/** One or two sentences. Longer than that belongs in the body. */
		description?: string;
		/** `wide` only for dense tables; see the note above. */
		width?: 'default' | 'wide';
		/** Buttons for the page as a whole, right-aligned against the title. */
		actions?: Snippet;
		/** Filters, tabs or a toolbar — sits below the masthead, above content. */
		toolbar?: Snippet;
		/**
		 * Render the frame without the masthead, for a detail page whose subject
		 * IS the heading — a persona's own page, where the name is the h1 and a
		 * shell title above it would be a second one saying the same thing. The
		 * page still gets the shared width, gutter and document <title>, which is
		 * the part that must not vary; it just supplies its own h1.
		 */
		bare?: boolean;
		children: Snippet;
	}

	let {
		title,
		eyebrow = '',
		description = '',
		width = 'default',
		actions,
		toolbar,
		bare = false,
		children
	}: Props = $props();
</script>

<svelte:head>
	<title>{title} — PersonaGen</title>
</svelte:head>

<div class="page-shell" class:is-wide={width === 'wide'}>
	{#if !bare}
	<header class="page-masthead">
		<div class="page-masthead-text">
			{#if eyebrow}<p class="page-eyebrow">{eyebrow}</p>{/if}
			<h1 class="page-title">{title}</h1>
			{#if description}<p class="page-description">{description}</p>{/if}
		</div>
		{#if actions}
			<div class="page-actions">{@render actions()}</div>
		{/if}
	</header>
	{/if}

	{#if toolbar}
		<div class="page-toolbar">{@render toolbar()}</div>
	{/if}

	<div class="page-body">{@render children()}</div>
</div>

<style>
	.page-shell {
		--page-max: var(--page-default);
		width: 100%;
		max-width: var(--page-max);
		margin: 0 auto;
		padding: var(--space-6) var(--page-gutter) var(--space-16);
	}
	.page-shell.is-wide {
		--page-max: var(--page-wide);
	}

	/* The gutter steps with the viewport rather than being set per page. The
	   16px floor is the minimum side margin the whole portal is held to. */
	@media (min-width: 640px) {
		.page-shell {
			--page-gutter: var(--space-6);
		}
	}
	@media (min-width: 1024px) {
		.page-shell {
			--page-gutter: var(--space-8);
		}
	}

	.page-masthead {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		justify-content: space-between;
		gap: var(--space-4);
		margin-bottom: var(--space-6);
	}
	.page-masthead-text {
		min-width: 0; /* lets a long title wrap instead of forcing the row wide */
	}

	.page-eyebrow {
		margin: 0 0 var(--space-2);
		font-size: var(--text-sm);
		font-weight: 600;
		letter-spacing: var(--tracking-wider);
		text-transform: uppercase;
		color: var(--text-dim);
	}

	/* One size for every portal h1. The dashboard's 67.2px display serif was a
	   marketing-page treatment that had leaked inside the product. */
	.page-title {
		margin: 0;
		font-family: var(--font-display);
		font-size: var(--text-xl);
		font-weight: 700;
		line-height: var(--leading-tight);
		letter-spacing: var(--tracking-tight);
		color: var(--text);
	}

	.page-description {
		margin: var(--space-2) 0 0;
		max-width: 62ch; /* a measure, not the container width */
		font-size: var(--text-base);
		line-height: var(--leading-normal);
		color: var(--text-muted);
	}

	.page-actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		align-items: center;
	}

	.page-toolbar {
		margin-bottom: var(--space-5);
	}

	/* 768, not 767. The application shell switches to mobile at `max-width: 768px`
	   with its desktop counterpart at `min-width: 769px`; this block used 767px,
	   so at exactly 768 — iPad portrait, and a standard test width — the sidebar,
	   hamburger and content area were in mobile mode while the masthead, its
	   description and its actions were still in desktop mode. One layout, one
	   crossing point. */
	@media (max-width: 768px) {
		.page-masthead {
			align-items: flex-start;
		}
		.page-actions {
			width: 100%;
		}
		/* Tighter, not gone. It was display:none here to save ~90px of chrome on
		   screens people return to daily — but that dropped content at 320px /
		   400% zoom, which WCAG 1.4.10 does not allow: reflow may re-arrange a
		   page, never remove from it. */
		.page-description {
			margin-top: var(--space-1);
			line-height: var(--leading-snug);
		}
	}
</style>
