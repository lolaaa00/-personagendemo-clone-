/**
 * Autopilot: keeps each enabled agent's calendar topped up with UGC posts at
 * 2-hour slots between active hours (default 8am–8pm) in the agent's timezone.
 *
 * Mode is driven by `agent_configs.autonomy_level`:
 *   - 'advisor'          → off (no auto-generation)
 *   - 'semi_autonomous'  → generate as DRAFTS for the user to approve (default)
 *   - 'fully_autonomous' → generate as SCHEDULED (the scheduler publishes them)
 *
 * Generation is lazy + idempotent + cost-capped: each run fills only the missing
 * future slots in the lookahead window, up to AUTOPILOT_MAX_PER_RUN, never
 * regenerating a slot that already has a post.
 */

import { env } from '$env/dynamic/private';
import { getServiceSupabase } from './service-supabase';
import { generateUgcPack, generateCinematicUgcPack } from './content/generate';
import { VIDEO_ONLY_PLATFORMS } from './social/platforms';

const DEFAULT_TZ = 'Australia/Sydney';

function intFromEnv(name: string, fallback: number): number {
	const raw = env[name];
	if (!raw) return fallback;
	const n = parseInt(raw, 10);
	return Number.isFinite(n) && n > 0 ? n : fallback;
}

function clampHour(h: number): number {
	if (!Number.isFinite(h)) return 0;
	return Math.min(23, Math.max(0, Math.trunc(h)));
}

// ── Timezone helpers (dependency-free, via Intl) ────────────────────────────

/** Wall-clock parts (and YYYY-MM-DD date string) for `date` as seen in `tz`. */
export function getLocalParts(tz: string, date: Date = new Date()) {
	const parts = new Intl.DateTimeFormat('en-CA', {
		timeZone: tz,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
		hour12: false
	}).formatToParts(date);
	const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
	let hour = parseInt(get('hour'), 10);
	if (hour === 24) hour = 0; // some runtimes emit 24 at midnight
	return {
		year: parseInt(get('year'), 10),
		month: parseInt(get('month'), 10),
		day: parseInt(get('day'), 10),
		hour,
		minute: parseInt(get('minute'), 10),
		dateStr: `${get('year')}-${get('month')}-${get('day')}`
	};
}

/** Milliseconds `tz` is ahead of UTC at the given instant. */
function tzOffsetMs(tz: string, date: Date): number {
	const p = getLocalParts(tz, date);
	const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, 0);
	// getLocalParts drops seconds into minute precision; add the real seconds back
	const seconds = date.getUTCSeconds();
	return asIfUtc + seconds * 1000 - date.getTime();
}

/** Epoch ms for a wall-clock `dateStr`/`timeStr` interpreted in `tz`. */
export function zonedWallTimeToEpoch(dateStr: string, timeStr: string, tz: string): number {
	const [y, m, d] = dateStr.split('-').map(Number);
	const [hh = 0, mm = 0, ss = 0] = (timeStr || '0:0:0').split(':').map(Number);
	const asUtc = Date.UTC(y, (m || 1) - 1, d || 1, hh, mm, ss);
	// One refinement pass handles DST boundaries adequately for scheduling.
	let epoch = asUtc - tzOffsetMs(tz, new Date(asUtc));
	epoch = asUtc - tzOffsetMs(tz, new Date(epoch));
	return epoch;
}

function addDaysToDateStr(dateStr: string, days: number): string {
	const [y, m, d] = dateStr.split('-').map(Number);
	const dt = new Date(Date.UTC(y, m - 1, d));
	dt.setUTCDate(dt.getUTCDate() + days);
	return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

interface Slot {
	dateStr: string;
	timeStr: string;
}

function buildSlots(
	tz: string,
	lookaheadDays: number,
	startH: number,
	endH: number,
	postsPerDay: number
): Slot[] {
	// N slots per day, spread evenly across the active window (e.g. 3/day over
	// 8–20 → 08:00, 14:00, 20:00). This is what makes the runway match the
	// persona's configured posts_per_day instead of a fixed 2-hourly cadence.
	const n = Math.min(Math.max(Math.trunc(postsPerDay) || 3, 1), 10);
	const span = Math.max(endH - startH, 0);
	const hours: number[] = [];
	for (let i = 0; i < n; i++) {
		const h = n === 1 ? startH : Math.round(startH + (i * span) / (n - 1));
		if (!hours.includes(h)) hours.push(h);
	}

	const slots: Slot[] = [];
	const today = getLocalParts(tz);
	for (let d = 0; d < lookaheadDays; d++) {
		const dateStr = addDaysToDateStr(today.dateStr, d);
		for (const h of hours) {
			slots.push({ dateStr, timeStr: `${String(h).padStart(2, '0')}:00:00` });
		}
	}
	return slots;
}

interface AgentConfig {
	agent_id: string;
	user_id: string;
	autonomy_level?: string | null;
	active_hours_start?: number | null;
	active_hours_end?: number | null;
	timezone?: string | null;
	posts_per_day?: number | null;
}

interface GenerateOpts {
	lookaheadDays: number;
	maxToCreate: number;
}

/** Fills missing future slots for a single agent. Returns the number created. */
async function generateDraftsForAgent(
	supabase: any,
	cfg: AgentConfig,
	opts: GenerateOpts
): Promise<number> {
	const agentId = cfg.agent_id;
	const userId = cfg.user_id;
	const tz = cfg.timezone || DEFAULT_TZ;
	const startH = clampHour(cfg.active_hours_start ?? 8);
	const endH = clampHour(cfg.active_hours_end ?? 20);
	if (endH < startH) return 0;

	// Target platforms = the agent's active connections (where it can actually post).
	const { data: conns } = await supabase
		.from('connections')
		.select('platform')
		.eq('agent_id', agentId)
		.eq('status', 'active');
	const connected = (conns || []).map((c: any) => c.platform);
	const hasConnections = connected.length > 0;

	// Generation is NOT gated on connections: an unconnected agent still gets
	// content generated (shaped for Instagram by default), saved as drafts to
	// publish once an account is linked. Only publish (status 'scheduled') when
	// there's actually somewhere to post — otherwise force 'draft'.
	const platforms = hasConnections ? connected : ['instagram'];
	const status =
		hasConnections && cfg.autonomy_level === 'fully_autonomous' ? 'scheduled' : 'draft';

	const slots = buildSlots(tz, opts.lookaheadDays, startH, endH, cfg.posts_per_day ?? 3);
	const dateStrs = [...new Set(slots.map((s) => s.dateStr))];

	// Existing posts in the window → never double-book a slot (and don't re-spend on images)
	const { data: existing } = await supabase
		.from('posts')
		.select('scheduled_date, scheduled_time')
		.eq('agent_id', agentId)
		.in('scheduled_date', dateStrs);
	const taken = new Set(
		(existing || []).map((p: any) => `${p.scheduled_date}T${(p.scheduled_time || '').slice(0, 5)}`)
	);

	// ── Roll stale drafts forward ────────────────────────────────────────────
	// A draft whose slot passed unapproved simply didn't publish (the scheduler
	// only takes status='scheduled'). Rather than letting it rot in the past,
	// move it to the next free future slot so the already-paid-for content
	// stays in the review runway. No regeneration, no extra spend.
	const nowMs = Date.now();
	const { data: staleDrafts } = await supabase
		.from('posts')
		.select('id, scheduled_date, scheduled_time')
		.eq('agent_id', agentId)
		.eq('status', 'draft')
		.not('scheduled_date', 'is', null)
		.lte('scheduled_date', getLocalParts(tz).dateStr);
	for (const draft of staleDrafts || []) {
		if (
			zonedWallTimeToEpoch(draft.scheduled_date, draft.scheduled_time || '00:00:00', tz) > nowMs
		) {
			continue; // still in the future today
		}
		const nextFree = slots.find(
			(s) =>
				!taken.has(`${s.dateStr}T${s.timeStr.slice(0, 5)}`) &&
				zonedWallTimeToEpoch(s.dateStr, s.timeStr, tz) > nowMs
		);
		if (!nextFree) break; // runway fully booked — leave remaining drafts as-is
		const { error: rollErr } = await supabase
			.from('posts')
			.update({ scheduled_date: nextFree.dateStr, scheduled_time: nextFree.timeStr })
			.eq('id', draft.id)
			.eq('status', 'draft'); // guard: don't move it if it was approved mid-run
		if (!rollErr) {
			taken.add(`${nextFree.dateStr}T${nextFree.timeStr.slice(0, 5)}`);
			console.log(
				`[Autopilot] Rolled stale draft ${draft.id} forward to ${nextFree.dateStr} ${nextFree.timeStr}`
			);
		}
	}

	// Exactly one high-production cinematic post per day — always the day's
	// first slot (deterministic regardless of run history), everything else
	// stays the cheap standard single-shot path. Keeps cinematic mode off the
	// 2-hourly cadence by default per cost (~$2.30/post vs ~$0.70) while still
	// guaranteeing one per day.
	const firstSlotTimeStr = `${String(startH).padStart(2, '0')}:00:00`;

	let created = 0;
	for (const slot of slots) {
		if (created >= opts.maxToCreate) break;
		const key = `${slot.dateStr}T${slot.timeStr.slice(0, 5)}`;
		if (taken.has(key)) continue;
		// Only fill future slots — don't backfill times that already passed today.
		if (zonedWallTimeToEpoch(slot.dateStr, slot.timeStr, tz) <= Date.now()) continue;

		const isCinematicSlot = slot.timeStr === firstSlotTimeStr;

		try {
			const genInput = { supabase, userId, agentId, platform: platforms[0], autopilot: true };
			let pack;
			if (isCinematicSlot) {
				try {
					pack = await generateCinematicUgcPack(genInput);
				} catch (cinematicErr) {
					// Don't leave the day's slot empty over a cinematic-only failure
					// (e.g. no product photo yet) — fall back to the standard path.
					console.warn(
						'[Autopilot] Cinematic generation failed, falling back to standard for',
						key,
						(cinematicErr as Error).message
					);
					pack = await generateUgcPack(genInput);
				}
			} else {
				pack = await generateUgcPack(genInput);
			}

			const slotPlatforms =
				pack.content?.media_type === 'video'
					? platforms
					: platforms.filter((p: string) => !(VIDEO_ONLY_PLATFORMS as readonly string[]).includes(p.toLowerCase()));
			if (slotPlatforms.length === 0) {
				console.warn('[Autopilot] Slot skipped: image-only content, no image-capable platform connected for agent', agentId);
				continue;
			}

			const { error } = await supabase.from('posts').insert({
				user_id: userId,
				agent_id: agentId,
				content: JSON.stringify(pack.content),
				platforms: slotPlatforms,
				status,
				scheduled_date: slot.dateStr,
				scheduled_time: slot.timeStr,
				published_at: null,
				token_cost: pack.content?.costBreakdown?.total ?? 0
			});
			if (!error) {
				created++;
				taken.add(key);
			} else {
				console.error('[Autopilot] Failed to insert draft for', key, error);
			}
		} catch (e) {
			const msg = (e as Error).message;
			console.error('[Autopilot] Generation failed for slot', key, msg);
			// Hard config/account errors won't fix themselves mid-run — stop this
			// agent instead of burning LLM tokens on every remaining slot.
			// "Exhausted balance"/"User is locked" = fal account lock (seen live).
			if (/No AI provider|No image generation|Exhausted balance|User is locked/i.test(msg)) break;
		}
	}
	return created;
}

/** Resolves a usable config for a single agent, synthesizing defaults if none exists. */
async function resolveAgentConfig(supabase: any, agentId: string): Promise<AgentConfig | null> {
	const { data: cfg } = await supabase
		.from('agent_configs')
		.select(
			'agent_id, user_id, autonomy_level, active_hours_start, active_hours_end, timezone, posts_per_day'
		)
		.eq('agent_id', agentId)
		.maybeSingle();
	if (cfg) return cfg as AgentConfig;

	const { data: agent } = await supabase
		.from('agents')
		.select('id, user_id')
		.eq('id', agentId)
		.maybeSingle();
	if (!agent) return null;
	return {
		agent_id: agent.id,
		user_id: agent.user_id,
		autonomy_level: 'semi_autonomous',
		active_hours_start: 8,
		active_hours_end: 20,
		timezone: DEFAULT_TZ,
		posts_per_day: 3
	};
}

/**
 * Top up drafts for all enabled agents (or a single agent when `agentId` is given,
 * regardless of its level — used by the "Generate drafts now" button).
 */
export async function runAutopilotDraftGeneration(opts?: {
	agentId?: string;
}): Promise<{ generated: number; agents: number }> {
	const supabase = getServiceSupabase();
	// 7-day runway of drafts ahead of the calendar (the review window), topped
	// up incrementally each run — maxPerRun caps per-run spend, not the runway.
	const lookaheadDays = intFromEnv('AUTOPILOT_LOOKAHEAD_DAYS', 7);
	const maxPerRun = intFromEnv('AUTOPILOT_MAX_PER_RUN', 24);

	let configs: AgentConfig[] = [];
	if (opts?.agentId) {
		const cfg = await resolveAgentConfig(supabase, opts.agentId);
		if (cfg) configs = [cfg];
	} else {
		const { data } = await supabase
			.from('agent_configs')
			.select(
				'agent_id, user_id, autonomy_level, active_hours_start, active_hours_end, timezone, posts_per_day'
			)
			.in('autonomy_level', ['semi_autonomous', 'fully_autonomous']);
		configs = (data || []) as AgentConfig[];
	}

	if (configs.length === 0) return { generated: 0, agents: 0 };

	let totalGenerated = 0;
	for (const cfg of configs) {
		if (totalGenerated >= maxPerRun) break;
		const created = await generateDraftsForAgent(supabase, cfg, {
			lookaheadDays,
			maxToCreate: maxPerRun - totalGenerated
		});
		totalGenerated += created;
	}

	if (totalGenerated > 0) {
		console.log(
			`[Autopilot] Generated ${totalGenerated} post(s) across ${configs.length} agent(s).`
		);
	}
	return { generated: totalGenerated, agents: configs.length };
}
