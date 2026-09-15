/**
 * One definition of what a status looks like.
 *
 * Status colour was defined in four places with four vocabularies:
 *
 *   calendar/CalendarView.svelte:361  STATUS_COLORS  — raw hues, for stripes
 *   feed/PostDrawer.svelte:521        statusColor()  — AA -text variants, for labels
 *   personas/[agentId]:3000           getStatusColor() — persona status, raw hues
 *   agents/StatusBadge.svelte:8       statusConfig   — persona status, CSS classes
 *
 * Two of those differences were correct and are preserved here. A status used as
 * a FILL (a calendar stripe, a dot) wants the raw brand hue; the same status used
 * as small TEXT wants the `-text` variant, because the raw hues measure 2.77–4.08:1
 * on a light surface and fail WCAG AA. That is why this module exposes `fill` and
 * `text` separately rather than one colour.
 *
 * What was NOT correct: `partial` rendered as `--gold` on the calendar and
 * `--warning-text` in the drawer — two different hues for one state, so the same
 * post changed colour when you opened it. And `draft` had no entry in the drawer
 * at all, falling through to grey while the calendar drew it amber.
 *
 * COVERAGE IS ENFORCED. `posts_status_check` and `agents_status_check` in the
 * database allow a fixed set of values; status-color.spec.ts asserts this module
 * covers every one of them. A status added to the constraint without an entry
 * here would otherwise render as anonymous grey wherever it appeared.
 */

/** Every value `posts_status_check` permits. */
export const POST_STATUSES = [
	'draft',
	'generating',
	'scheduled',
	'publishing',
	'published',
	'partial',
	'failed',
	'rejected'
] as const;
export type PostStatus = (typeof POST_STATUSES)[number];

/** Every value `agents_status_check` permits. */
export const PERSONA_STATUSES = ['active', 'paused', 'pending'] as const;
export type PersonaStatus = (typeof PERSONA_STATUSES)[number];

export interface StatusStyle {
	/** Sentence-case label for UI. Never SHOUTED — `StatusBadge` used to return
	 *  'PENDING' in caps while every sibling returned lower case. */
	label: string;
	/** Raw hue token. For stripes, dots, bars — anything that is not text. */
	fill: string;
	/** AA-safe token. For any status rendered AS text, at any size. */
	text: string;
	/** A one-line answer to "what does this mean?", for tooltips and help. */
	meaning: string;
}

const POST: Record<PostStatus, StatusStyle> = {
	draft: {
		label: 'Draft',
		fill: 'var(--warning)',
		text: 'var(--warning-text)',
		meaning: 'Written and waiting for you to approve it.'
	},
	generating: {
		label: 'Generating',
		fill: 'var(--cyan)',
		text: 'var(--cyan-text)',
		meaning: 'Being made right now.'
	},
	scheduled: {
		label: 'Scheduled',
		fill: 'var(--accent)',
		text: 'var(--accent-text)',
		meaning: 'Approved, and queued for its slot.'
	},
	publishing: {
		label: 'Publishing',
		fill: 'var(--cyan)',
		text: 'var(--cyan-text)',
		meaning: 'Being sent to the platform now.'
	},
	published: {
		label: 'Published',
		fill: 'var(--success)',
		text: 'var(--success-text)',
		meaning: 'The platform confirmed it went live.'
	},
	partial: {
		// Was --gold on the calendar and --warning-text in the drawer.
		label: 'Partly published',
		fill: 'var(--warning)',
		text: 'var(--warning-text)',
		meaning: 'It reached some platforms and failed on others.'
	},
	failed: {
		label: 'Failed',
		fill: 'var(--error)',
		text: 'var(--error-text)',
		meaning: 'It did not go out. The reason is on the post.'
	},
	rejected: {
		label: 'Rejected',
		fill: 'var(--rose)',
		text: 'var(--rose-text)',
		meaning: 'You turned this one down.'
	}
};

const PERSONA: Record<PersonaStatus, StatusStyle> = {
	active: {
		label: 'Active',
		fill: 'var(--success)',
		text: 'var(--success-text)',
		meaning: 'Working normally.'
	},
	paused: {
		label: 'Paused',
		fill: 'var(--warning)',
		text: 'var(--warning-text)',
		meaning: 'Nothing runs for this persona until you resume it.'
	},
	pending: {
		label: 'Pending',
		fill: 'var(--text-dim)',
		text: 'var(--text-dim)',
		meaning: 'Set up, but not finished — connect a platform to start.'
	}
};

/** Anything unrecognised is anonymous grey rather than a confident wrong colour. */
const UNKNOWN: StatusStyle = {
	label: 'Unknown',
	fill: 'var(--text-dim)',
	text: 'var(--text-dim)',
	meaning: 'This status is not one the app recognises.'
};

export const postStatus = (s: string | null | undefined): StatusStyle =>
	POST[(s ?? '') as PostStatus] ?? UNKNOWN;

export const personaStatus = (s: string | null | undefined): StatusStyle =>
	PERSONA[(s ?? '') as PersonaStatus] ?? UNKNOWN;

/** Convenience for the common call sites. */
export const postStatusFill = (s: string | null | undefined) => postStatus(s).fill;
export const postStatusText = (s: string | null | undefined) => postStatus(s).text;
export const personaStatusFill = (s: string | null | undefined) => personaStatus(s).fill;
export const personaStatusText = (s: string | null | undefined) => personaStatus(s).text;
