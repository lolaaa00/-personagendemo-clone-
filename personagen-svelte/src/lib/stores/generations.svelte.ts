/**
 * Live registry of in-flight generations.
 *
 * Every generation endpoint is now async: it returns 202 immediately and records
 * its progress server-side (a post row in status 'generating', or a
 * `<key>_status` marker inside agent_configs.ugc_reference_kit). This store is
 * the client-side mirror of that, so the same job can be rendered in three
 * places at once — the feed card, the persona tile, and the global activity
 * indicator — from ONE source of truth instead of three ad-hoc boolean flags.
 *
 * Crucially, jobs are keyed by their server-side identity (post id / agent+kit
 * key), not by a component's lifetime. Nothing here is the source of truth — the
 * DB is — so a hard refresh mid-generation can rehydrate from the server and the
 * spinners come back, which the old per-component `$state` flags could not do.
 */

export type GenerationKind = 'post' | 'avatar' | 'kit_stage' | 'drafts';

export interface GenerationJob {
	/** Stable id: post row id, or `${agentId}:${kitKey}` for avatar/kit work. */
	id: string;
	kind: GenerationKind;
	agentId: string;
	/** Human label for the activity list, e.g. "Side profiles" or "UGC post". */
	label: string;
	startedAt: number;
	/** Set when the job finishes unsuccessfully; the UI shows this verbatim. */
	error?: string;
	done?: boolean;
}

export const generations = $state<GenerationJob[]>([]);

/** Median wall-clock for each job kind, used to drive an honest progress bar. */
const EXPECTED_MS: Record<GenerationKind, number> = {
	avatar: 35_000, // portrait + sheet + hero shot (3 chained fal calls)
	kit_stage: 20_000, // one Nano Banana edit
	post: 90_000, // director + still + video
	drafts: 120_000 // a whole autopilot runway fill
};

export function startGeneration(job: Omit<GenerationJob, 'startedAt'>): void {
	const existing = generations.findIndex((g) => g.id === job.id);
	const entry: GenerationJob = { ...job, startedAt: Date.now() };
	if (existing !== -1) generations[existing] = entry;
	else generations.push(entry);
}

export function failGeneration(id: string, error: string): void {
	const job = generations.find((g) => g.id === id);
	if (job) {
		job.error = error;
		job.done = true;
	}
}

export function finishGeneration(id: string): void {
	const i = generations.findIndex((g) => g.id === id);
	if (i !== -1) generations.splice(i, 1);
}

export function getGeneration(id: string): GenerationJob | undefined {
	return generations.find((g) => g.id === id);
}

export function isGenerating(id: string): boolean {
	const job = generations.find((g) => g.id === id);
	return !!job && !job.done;
}

/**
 * A progress fraction (0–0.95) for a job.
 *
 * We cannot know real provider progress — fal exposes none — so this is an
 * elapsed-vs-expected curve that decelerates and deliberately NEVER reaches 1.0
 * while running. A bar that sits at 100% while still spinning reads as "stuck";
 * one that keeps creeping reads as "working". It only completes when the job
 * actually completes and is removed.
 */
export function progressOf(job: GenerationJob, now: number = Date.now()): number {
	const expected = EXPECTED_MS[job.kind] ?? 60_000;
	const elapsed = Math.max(0, now - job.startedAt);
	// Asymptotic: fast at first, then slower — approaches 0.95 without touching it.
	return Math.min(0.95, 1 - Math.exp(-elapsed / (expected * 0.6)));
}

/** Key for avatar/kit jobs, which have no post id of their own. */
export function kitJobId(agentId: string, key: string): string {
	return `${agentId}:${key}`;
}

/** Jobs still running (drives the global activity indicator's count). */
export function activeGenerations(): GenerationJob[] {
	return generations.filter((g) => !g.done);
}
