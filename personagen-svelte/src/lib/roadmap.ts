/**
 * Roadmap — the honest forward ledger, shown beside the Changelog on the docs
 * page. Every item here is real: either in-flight work, a known gap with a
 * chosen fix, or an idea that has been explicitly scoped. Nothing aspirational
 * enough to be marketing. Keep statuses truthful — this page exists so anyone
 * can see exactly where the project stands.
 */

export type RoadmapStatus = 'in-progress' | 'planned' | 'exploring';

export interface RoadmapItem {
	title: string;
	detail: string;
	area: 'Generation' | 'Review & publishing' | 'Personas' | 'Platform & UX' | 'Infrastructure';
	status: RoadmapStatus;
}

export const ROADMAP_STATUSES: Array<{ id: RoadmapStatus; label: string; hint: string }> = [
	{ id: 'in-progress', label: 'In progress', hint: 'Being built or validated right now' },
	{ id: 'planned', label: 'Planned', hint: 'Chosen and scoped — next in line' },
	{ id: 'exploring', label: 'Exploring', hint: 'Scoped ideas, not yet committed' }
];

export const ROADMAP: RoadmapItem[] = [
	// ── In progress ────────────────────────────────────────────────────────
	{
		title: 'Model adapter system — first live validation',
		detail:
			'Auto-generated adapters now let discovered models swap into the roster and actually drive generation. The request-shape logic is probe-verified; the first paid generation through a swapped-in model is the remaining validation step.',
		area: 'Generation',
		status: 'in-progress'
	},
	{
		title: 'User Voice — live vote round-trip',
		detail:
			'The feature-request board ships with list + Kanban views, voting, and submissions. Its database migration (supabase/feature_requests_migration.sql) still needs to be applied to the live database; until then the tab explains itself instead of failing.',
		area: 'Platform & UX',
		status: 'in-progress'
	},
	// ── Planned ────────────────────────────────────────────────────────────
	{
		title: 'Adapter-aware refine flow',
		detail:
			'The in-drawer Refine re-roll still resolves models against the static catalog only — a swapped-in video model should refine through its generated adapter exactly like first generation.',
		area: 'Generation',
		status: 'planned'
	},
	{
		title: 'Identity Kit & Character workspaces as routes',
		detail:
			'The two heaviest Profile sections (~2,150px each when open) move to their own pages under the persona — as an optional route segment so unsaved edits survive the navigation.',
		area: 'Personas',
		status: 'planned'
	},
	{
		title: 'Review queue at scale',
		detail:
			'Responsive breakpoints for narrow screens and list virtualization for queues past ~50 drafts, keeping the five views fast for multi-persona accounts.',
		area: 'Review & publishing',
		status: 'planned'
	},
	{
		title: 'Light-mode contrast sweep — the last mile',
		detail:
			'A few dozen dark-first white-alpha backgrounds and borders are still invisible on light surfaces (AgentConnectionStats is the main cluster). Convert them to theme-aware color-mix tints.',
		area: 'Platform & UX',
		status: 'planned'
	},
	{
		title: 'Dialog contract everywhere',
		detail:
			'Roll the shared focus-trap dialog action across the remaining hand-rolled lightboxes and modals (persona page carries five), and make the roster pause switch fully keyboard-operable.',
		area: 'Platform & UX',
		status: 'planned'
	},
	{
		title: 'Studio phase 3 — favorites & archetype analytics',
		detail:
			'Pin favorite templates, and track which archetypes convert once posts go live so the gallery can rank templates by real performance.',
		area: 'Generation',
		status: 'planned'
	},
	{
		title: 'One-command local verification stack',
		detail:
			'A throwaway Docker Supabase seeded from client_bootstrap.sql, so destructive flows (generate, scrape, publish, delete) can be exercised end-to-end with zero production risk.',
		area: 'Infrastructure',
		status: 'planned'
	},
	// ── Exploring ──────────────────────────────────────────────────────────
	{
		title: 'Auto-adapters beyond video',
		detail:
			'Extend probe-generated adapters to image, image-edit, and TTS models so every discovered model in every category can be swapped in, not just video.',
		area: 'Generation',
		status: 'exploring'
	},
	{
		title: 'Asset-to-post promotion',
		detail:
			'Standalone Studio assets get a one-click "make this a post" action — caption written by the persona, straight into the review queue.',
		area: 'Review & publishing',
		status: 'exploring'
	},
	{
		title: 'Multi-persona scenes',
		detail:
			'Two-creator templates (interviews, duets) — blocked today by single-face identity consistency; needs a two-reference generation strategy that doesn’t dilute either identity.',
		area: 'Personas',
		status: 'exploring'
	},
	{
		title: 'Changelog auto-refresh on release',
		detail:
			'Regenerate the changelog data from git as part of the deploy pipeline so the docs page can never drift from the real history.',
		area: 'Infrastructure',
		status: 'exploring'
	}
];
