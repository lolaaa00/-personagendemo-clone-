<script lang="ts">
	/**
	 * The portal's error boundary.
	 *
	 * Without this, an error thrown by any (portal) page load walks up to the
	 * ROOT +error.svelte, which renders inside the root layout only — so a
	 * signed-in user who hits a 403 or a 404 loses the sidebar, the persona rail
	 * and every way of moving on except the two links on the error card. The
	 * portal shell is the product's frame; an error is not a reason to remove it.
	 *
	 * This re-renders the root error page unchanged, inside the portal layout.
	 * One error component, two boundaries: the copy, the actions and the status
	 * mapping live in exactly one place, so the two can never drift apart.
	 */
	import RootError from '../+error.svelte';
</script>

<RootError />
