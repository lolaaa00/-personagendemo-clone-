/**
 * Registry truth helpers for the Model Manager.
 *
 * describeUsage() answers "where does the pipeline consult this row?" by
 * calling the SAME resolvers the pipeline calls (effectiveResolve /
 * effectiveOptions / openRouterRoute) and mapping each answer onto its call
 * sites. The site table below is ground truth by grep, not intent — if a call
 * site moves, update it here or the page will state a path that no longer runs:
 *
 *   video_i2v  → api/agent/[id]/generate-post (composer picker + default), autopilot.ts
 *   image_edit → api/agent/[id]/generate-reference-kit, generate-avatar (editing),
 *                content/generate.ts openRouterRoute('image_edit')
 *   image_t2i  → generate-avatar (not editing), content/generate.ts openRouterRoute('image_t2i');
 *                UGC images on fal use the compiled UGC_IMAGE_MODEL_FAL constant, NOT the star
 *   tts        → nothing (content/generate.ts TTS_MODEL comes from env UGC_TTS_MODEL)
 *
 * reconcileLedger() answers "did it actually run?" from generation_events.
 * OpenRouter events record the model id verbatim; fal events record a display
 * label ("nano-banana-2 (avatar hero shot)"), so matching normalises both
 * sides to a bare name. That is approximate for fal and exact for OpenRouter —
 * the result says which.
 */
import {
	effectiveOptions,
	effectiveResolve,
	openRouterRoute,
	servesKind,
	type RegistryKind,
	type RegistryRow
} from './model-registry';

export type UsageRole = 'default' | 'option' | 'route';
export interface UsageTag {
	site: string;
	role: UsageRole;
}
export interface RegistryUsage {
	byRowId: Record<string, UsageTag[]>;
	/** Kinds where at least one pipeline path resolves a row. */
	consultedKinds: RegistryKind[];
	/** Honest caveat per kind, shown above the roster. */
	kindNotes: Partial<Record<RegistryKind, string>>;
}

const KINDS: RegistryKind[] = ['image_t2i', 'image_edit', 'video_i2v', 'tts'];

const SITES: Record<
	RegistryKind,
	{ defaultAt: string[]; optionAt: string | null; orRoute: string | null; note?: string }
> = {
	video_i2v: {
		defaultAt: ['b-roll video · composer default', 'autopilot video'],
		optionAt: 'b-roll video · composer option',
		orRoute: null
	},
	image_edit: {
		defaultAt: ['reference kit · default', 'avatar edit · default'],
		optionAt: 'reference kit / avatar edit · option',
		orRoute: 'OpenRouter image-edit route · UGC pipeline'
	},
	image_t2i: {
		defaultAt: ['avatar · default'],
		optionAt: 'avatar · option',
		orRoute: 'OpenRouter image route · UGC pipeline',
		note: 'Only avatar generation reads this tab’s star. UGC images on fal use the compiled default, not the star.'
	},
	tts: {
		defaultAt: [],
		optionAt: null,
		orRoute: null,
		note: 'Nothing in the pipeline reads this tab yet — text-to-speech uses the UGC_TTS_MODEL environment setting. Star and toggle are informational.'
	}
};

export function describeUsage(rows: RegistryRow[]): RegistryUsage {
	const byRowId: Record<string, UsageTag[]> = {};
	const consulted = new Set<RegistryKind>();
	const kindNotes: RegistryUsage['kindNotes'] = {};
	const push = (row: RegistryRow | undefined, tag: UsageTag) => {
		if (!row) return;
		(byRowId[row.id] ??= []).push(tag);
	};
	for (const kind of KINDS) {
		const s = SITES[kind];
		if (s.note) kindNotes[kind] = s.note;
		const wiredFor = (id: string) =>
			rows.find(
				(r) => r.model_id === id && r.wired && r.status === 'active' && servesKind(r, kind)
			);
		if (s.defaultAt.length || s.optionAt) {
			const def = effectiveResolve(rows, kind, undefined);
			for (const opt of effectiveOptions(rows, kind)) {
				const row = wiredFor(opt.id);
				if (!row) continue;
				if (opt.id === def.id) {
					for (const site of s.defaultAt) push(row, { site, role: 'default' });
					consulted.add(kind);
				} else if (s.optionAt) {
					push(row, { site: s.optionAt, role: 'option' });
					consulted.add(kind);
				}
			}
		}
		if (s.orRoute) {
			const r = openRouterRoute(rows, kind, '', 0);
			if (r.fromRegistry) {
				const row = rows.find(
					(x) =>
						x.provider === 'openrouter' &&
						x.model_id === r.id &&
						x.wired &&
						x.status === 'active' &&
						servesKind(x, kind)
				);
				push(row, { site: s.orRoute, role: 'route' });
				if (row) consulted.add(kind);
			}
		}
	}
	return { byRowId, consultedKinds: [...consulted], kindNotes };
}

export interface LedgerEvent {
	provider: string | null;
	model: string | null;
	operation: string | null;
	est_cost: number | string | null;
}
export interface LedgerHit {
	runs: number;
	usd: number;
	match: 'exact' | 'name';
}
export interface LedgerReconciliation {
	byRowId: Record<string, LedgerHit>;
	/** Ran, but no row in this registry claims it. */
	unlisted: Array<{ provider: string; model: string; operation: string; runs: number; usd: number }>;
	windowDays: number;
}

/** Operations that are model calls the registry is supposed to describe. */
const MODEL_OPERATIONS = new Set(['image', 'video', 'tts', 'talking_head']);

/** "fal-ai/nano-banana-2" → "nano-banana-2"; "Nano Banana 2 (hero portrait)" → "nano-banana-2". */
export function normalizeModelName(s: string): string {
	return s
		.toLowerCase()
		.replace(/\s*\([^)]*\)/g, '')
		.replace(/^fal-ai\//, '')
		.replace(/[\s_/]+/g, '-')
		.replace(/-+/g, '-')
		.replace(/^-|-$/g, '');
}

export function reconcileLedger(
	rows: RegistryRow[],
	events: LedgerEvent[],
	windowDays: number
): LedgerReconciliation {
	const agg = new Map<
		string,
		{ provider: string; model: string; operation: string; runs: number; usd: number }
	>();
	for (const e of events) {
		const op = String(e.operation ?? '');
		const provider = String(e.provider ?? '');
		if (!MODEL_OPERATIONS.has(op) || !e.model || provider === 'local' || provider === 'storage')
			continue;
		const key = `${provider}|${e.model}`;
		const a = agg.get(key) ?? { provider, model: String(e.model), operation: op, runs: 0, usd: 0 };
		a.runs += 1;
		a.usd += Number(e.est_cost) || 0;
		agg.set(key, a);
	}
	const byRowId: Record<string, LedgerHit> = {};
	const unlisted: LedgerReconciliation['unlisted'] = [];
	for (const a of agg.values()) {
		const exact = rows.find((r) => r.provider === a.provider && r.model_id === a.model);
		const byName =
			exact ??
			rows.find(
				(r) =>
					r.provider === a.provider && normalizeModelName(r.model_id) === normalizeModelName(a.model)
			);
		if (!byName) {
			unlisted.push(a);
			continue;
		}
		const hit = (byRowId[byName.id] ??= { runs: 0, usd: 0, match: exact ? 'exact' : 'name' });
		hit.runs += a.runs;
		hit.usd += a.usd;
		if (!exact) hit.match = 'name';
	}
	unlisted.sort((x, y) => y.runs - x.runs);
	return { byRowId, unlisted, windowDays };
}
