/**
 * Hand-written layer for the changelog. NOT generated — the generator reads
 * this file and never writes it, so regenerating from git can never destroy
 * curation.
 *
 * It previously round-tripped curation through changelog.ts itself, which was
 * a latent data-loss bug: the generator emits double-quoted keys while the
 * original hand-written file used single quotes, so the second consecutive
 * run would have silently dropped all 14 milestones.
 *
 * MILESTONES  commit hash -> why that commit mattered. Marks an era boundary,
 *             which also starts a new group.
 * GROUP_COPY  group id (its first commit hash) -> plain-language title and
 *             summary. Anything absent here gets auto-written copy.
 */

export const MILESTONES: Record<string, string> = {
	"04c8672": "Repo initiation — static onboarding site with the first design system.",
	"e9e143c": "The client portal era begins: onboarding portal and first social-connection plumbing.",
	"119ba51": "Brand Brief is born — the Firecrawl-powered brand interview wizard.",
	"d31c2e2": "The platform rewrite: full-stack SvelteKit + Supabase persona platform.",
	"40a79e5": "Social publishing architecture lands (Zernio) — personas can reach real accounts.",
	"6a3919a": "Review Queue + QC gate + autopilot foundations — the approval workflow exists.",
	"fa8a136": "Confirm-before-generate composer — nothing spends money without an explicit approval.",
	"ed0d603": "Zernio Key Manager — multiple publishing keys with per-persona assignment.",
	"dd9cb3a": "personagen-svelte initialized — the codebase the app runs on today.",
	"31e3483": "Calendar becomes a first-class surface with the shared CalendarView.",
	"0d9975c": "Design-system components, accessibility hardening, and budget tracking in one sweep.",
	"03fe3b4": "Guides go immersive — the in-app documentation hub this page lives in.",
	"0961c0b": "Model Manager — the roster, discovery, and value rankings for generation models.",
	"224ca57": "Studio template system — one-click archetype scaffolds for every persona."
};

export interface GroupCopy {
	title: string;
	summary: string;
}

/**
 * Titles read like a headline a child could follow; summaries sit around an
 * eighth-grade reading level. Write what CHANGED FOR THE USER, not what was
 * edited — and describe what the group actually contains, which is not always
 * what its milestone is called. Run `node scripts/generate-changelog.mjs --list`
 * to see the commits inside each id before writing.
 */
export const GROUP_COPY: Record<string, GroupCopy> = {
	"317d321": {
		title: "The big usability pass",
		summary:
			"A wide sweep across the whole app. Pop-up windows now behave properly if you use a keyboard, pages remember which tab you were on when you refresh or share a link, Settings gained a side menu instead of one long scroll, and the in-app help pages arrived."
	},
	"72dda44": {
		title: "Model numbers are numbers again",
		summary:
			"On the Model Manager, price, speed and quality used to look like boxes you were meant to type in. They now read as plain values, with an Edit button when you actually want to change one. Newly found models also show how old they are."
	},
	"03fe3b4": {
		title: "Better help, model swapping, and a fix that stopped losing your edits",
		summary:
			"The help pages became a full walkthrough with real screenshots. You can now filter models and swap a better one into your line-up. Most importantly, a bug that could throw away your last few edits when you left a page mid-typing was fixed."
	},
	"0961c0b": {
		title: "Model Manager",
		summary:
			"A new page listing every AI model your personas can use, what each one costs per run, and how good it is — so you can see what you are paying for and pick something cheaper or newer."
	},
	"224ca57": {
		title: "One-click starting points, and much faster pictures",
		summary:
			"Pick a ready-made template instead of writing a post from scratch. Images across the app also load far faster, because they are now sent at the size they are shown rather than at full resolution."
	},
	"14f9073": {
		title: "Your posts now have a home",
		summary:
			"Everything a persona has made appears in one feed you can scroll through, with the behind-the-scenes work needed to keep it current."
	}
};
