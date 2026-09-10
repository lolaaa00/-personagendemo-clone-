/**
 * The button must not promise what the gate forbids.
 *
 * `autonomy-publish.spec.ts` pins the GATE: only a 'fully_autonomous' persona
 * publishes unattended, everything else is held as a draft. This file pins the
 * WORDS on top of it, because for a while the two disagreed in the one direction
 * nobody notices — safely.
 *
 * GenerationComposer's deliver control read "Approve & publish now / Output:
 * LIVE post — publishes immediately …" for EVERY persona, and both host pages
 * toasted "Post generated!" when the server had quietly filed the post in the
 * review queue. Nothing published, nothing failed, and nothing told the user
 * where the post went — so a marketer who had never opened /review had no reason
 * to look there for the post they thought was live.
 *
 * A wrong promise in the safe direction is still a wrong promise: it costs the
 * user the post.
 *
 * Everything here is derived from the shipped source — the level union from
 * $lib/types, the publishing level from the route's own guard — so the day a
 * fourth autonomy level lands, or the route changes which level may publish,
 * this suite goes red instead of quietly drifting.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(__dirname, '..', '..');

const COMPOSER_PATH = join(SRC, 'lib', 'components', 'generation', 'GenerationComposer.svelte');
const ROUTE_PATH = join(SRC, 'routes', 'api', 'agent', '[agentId]', 'generate-post', '+server.ts');
const TYPES_PATH = join(SRC, 'lib', 'types.ts');
const PERSONA_PAGE_PATH = join(SRC, 'routes', '(portal)', 'personas', '[agentId]', '+page.svelte');
const CALENDAR_PAGE_PATH = join(SRC, 'routes', '(portal)', 'calendar', '+page.svelte');

const composer = readFileSync(COMPOSER_PATH, 'utf8');
const route = readFileSync(ROUTE_PATH, 'utf8');
const types = readFileSync(TYPES_PATH, 'utf8');
const personaPage = readFileSync(PERSONA_PAGE_PATH, 'utf8');
const calendarPage = readFileSync(CALENDAR_PAGE_PATH, 'utf8');

const FILES_UNDER_TEST = {
	'GenerationComposer.svelte': composer,
	'generate-post/+server.ts': route,
	'lib/types.ts': types,
	'personas/[agentId]/+page.svelte': personaPage,
	'calendar/+page.svelte': calendarPage
};

/** Strips comments, so every claim below is about CODE and not about prose. */
function codeOnly(s: string): string {
	return s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/**
 * The `destination` derived block — the composer's entire promise about output.
 *
 * Parsing is deliberately non-throwing: a composer that stopped gating its copy
 * must fail as a NAMED assertion ("promises a publish outside the gate"), not as
 * a collection crash that reports "no tests" and buries the reason.
 */
function destinationBlock(): string {
	const start = composer.indexOf('let destination = $derived.by(() => {');
	if (start < 0) return '';
	const end = composer.indexOf('\n\t});', start);
	return end > start ? composer.slice(start, end) : '';
}

/** Every autonomy level the product has, read out of the union type itself. */
const LEVELS: string[] = (() => {
	const m = types.match(/export type AutonomyLevel\s*=\s*([^;]+);/);
	return m ? Array.from(m[1].matchAll(/'([a-z_]+)'/g)).map((x) => x[1]) : [];
})();

/** The one level the ROUTE lets publish itself, read out of the route's guard. */
const ROUTE_PUBLISHING_LEVEL: string | null =
	route.match(/autonomy === '([a-z_]+)' \|\| body\.publish_now === true/)?.[1] ?? null;

/** The one level the COMPOSER promises an immediate publish for. */
const COPY_PUBLISHING_LEVEL: string | null =
	codeOnly(destinationBlock()).match(/autonomyLevel !== '([a-z_]+)'/)?.[1] ?? null;

describe('the sources this suite reasons about were actually read', () => {
	// An empty or mis-pathed read makes every `toContain` below pass vacuously,
	// which is precisely the failure mode this file exists to prevent elsewhere.
	it.each(Object.entries(FILES_UNDER_TEST))('%s is non-empty', (_name, text) => {
		expect(typeof text).toBe('string');
		expect(text.length).toBeGreaterThan(500);
	});

	it('the composer file really is the composer', () => {
		expect(composer).toContain('interface Props');
		expect(composer).toContain('let destination = $derived.by');
	});

	it('the level union parsed into real levels', () => {
		expect(LEVELS.length).toBeGreaterThanOrEqual(3);
		expect(LEVELS).toContain('advisor');
		expect(LEVELS).toContain('fully_autonomous');
	});

	it('both guards parsed — the copy one and the gate one', () => {
		expect(destinationBlock().length, 'found the destination block').toBeGreaterThan(200);
		expect(
			ROUTE_PUBLISHING_LEVEL,
			"the route's mayPublishItself guard is still shaped as expected"
		).not.toBeNull();
		expect(
			COPY_PUBLISHING_LEVEL,
			'the composer gates its publish-now copy on the persona autonomy level'
		).not.toBeNull();
	});
});

describe('the composer knows which persona it is talking about', () => {
	it('takes the saved autonomy level as a prop', () => {
		expect(composer).toMatch(/autonomyLevel\?:\s*AutonomyLevel \| null;/);
		expect(composer).toMatch(/autonomyLevel = null/);
	});

	it('an unknown level is treated as held, exactly as the route treats it', () => {
		// The route falls back to the safest level rather than to the publishing
		// one: `String(cfgRow?.autonomy_level ?? 'advisor')`. A composer that
		// defaulted the other way would promise a publish for a persona it could
		// not identify.
		expect(route).toMatch(/autonomy_level \?\? '([a-z_]+)'/);
		const routeFallback = route.match(/autonomy_level \?\? '([a-z_]+)'/)![1];
		expect(routeFallback).not.toBe(ROUTE_PUBLISHING_LEVEL);
		// `null !== 'fully_autonomous'` → the held branch. Same answer.
		expect(null !== COPY_PUBLISHING_LEVEL).toBe(true);
	});

	it('both host pages hand it the level', () => {
		for (const [name, page] of [
			['personas/[agentId]', personaPage],
			['calendar', calendarPage]
		] as const) {
			const tag = page.slice(
				page.indexOf('<GenerationComposer'),
				page.indexOf('/>', page.indexOf('<GenerationComposer'))
			);
			expect(tag.length, `${name} renders <GenerationComposer`).toBeGreaterThan(50);
			expect(tag, `${name} passes autonomyLevel`).toContain('autonomyLevel=');
		}
	});

	it('the persona page passes the SAVED level, not the unsaved form value', () => {
		// The form's `autonomyLevel` state changes as the user drags the picker;
		// the server reads the database row. Promising on the unsaved value would
		// reintroduce the same lie with extra steps.
		expect(personaPage).toContain('autonomyLevel={savedAutonomy}');
		expect(personaPage).toMatch(/savedAutonomy = \$derived\(\(agent\?\.autonomy_level/);
	});

	it('the calendar reads agent_configs, which is the row the route reads', () => {
		// `autonomy_level` is a column of agent_configs; `agents` has no such
		// column, so `data.agents[].autonomy_level` is always the load's fallback.
		// autopilotConfigs[].mode is the agent_configs mirror.
		expect(route).toContain("from('agent_configs')");
		expect(calendarPage).toMatch(/autopilotConfigs\?\.\[genAgentId\]\?\.mode/);
	});
});

describe('the copy and the gate agree about who may publish', () => {
	it('the composer promises an immediate publish for exactly the level the route publishes', () => {
		expect(COPY_PUBLISHING_LEVEL).toBe(ROUTE_PUBLISHING_LEVEL);
	});

	it('every declared level: copy and gate reach the same verdict', () => {
		expect(LEVELS.length).toBeGreaterThanOrEqual(3);
		const verdicts = LEVELS.map((level) => ({
			level,
			gateHolds: level !== ROUTE_PUBLISHING_LEVEL,
			copyHolds: level !== COPY_PUBLISHING_LEVEL
		}));
		expect(verdicts.map((v) => v.copyHolds)).toEqual(verdicts.map((v) => v.gateHolds));
		// And the split is real, not "everything is held" on both sides.
		expect(verdicts.filter((v) => !v.gateHolds).length).toBe(1);
	});

	it('no immediate-publish promise sits outside that gate', () => {
		// The real assertion: walk the destination block's CODE and require that
		// the level check appears before any wording that promises a live post.
		// Restoring the old unconditional "publishes immediately" wording removes
		// the check from everything preceding it, and this goes red.
		const code = codeOnly(destinationBlock());
		const promises = /publishes immediately|LIVE post|publish now/gi;
		const hits = Array.from(code.matchAll(promises));
		expect(
			hits.length,
			'the publish-now copy still exists for the level that earns it'
		).toBeGreaterThan(0);
		for (const hit of hits) {
			const before = code.slice(0, hit.index);
			expect(
				before,
				`"${hit[0]}" is promised before the composer checks the autonomy level`
			).toContain(`'${ROUTE_PUBLISHING_LEVEL}'`);
		}
	});

	it('a held post is called an approval, not a publish, and says where it went', () => {
		const code = codeOnly(destinationBlock());
		const guard = code.indexOf(`autonomyLevel !== '${COPY_PUBLISHING_LEVEL}'`);
		const held = code.slice(guard, code.indexOf('};', guard));
		expect(held).toContain('review queue');
		// The label is what the user reads before clicking. It must not say the
		// thing that does not happen.
		const label = held.match(/label: '([^']+)'/);
		expect(label, 'the held branch still names its button').not.toBeNull();
		expect(label![1].toLowerCase()).not.toContain('publish');
		expect(label![1].toLowerCase()).toContain('review');
	});

	it('a scheduled post keeps its promise at every level — the gate does not hold it', () => {
		// `if (!scheduledDate && !mayPublishItself)` — the hold applies only to the
		// immediate path, so "Approve & schedule … publishes on <date>" is true for
		// an advisor persona too. Pinned so nobody "fixes" honest copy.
		expect(route).toContain('if (!scheduledDate && !mayPublishItself)');
		expect(codeOnly(destinationBlock())).toContain("label: 'Approve & schedule'");
	});

	it('every level the type declares has a human label for the copy to use', () => {
		expect(composer).toContain('AUTONOMY_LABELS');
		for (const level of LEVELS) {
			expect(types, `AUTONOMY_LABELS covers ${level}`).toMatch(
				new RegExp(`${level}:\\s*\\{[\\s\\S]{0,80}?label:`)
			);
		}
	});
});

describe('nothing in the UI opts out of the gate', () => {
	it('no client sends publish_now', () => {
		// The route accepts an explicit `publish_now` as the deliberate "post this
		// now" override. If a caller ever starts sending it, the level-based copy
		// above becomes a lie again — in the UNSAFE direction — so the day that
		// happens this test must be the one that says so.
		const skip = new Set([ROUTE_PATH]);
		const offenders: string[] = [];
		let visited = 0;
		const walk = (dir: string) => {
			for (const entry of readdirSync(dir)) {
				if (entry === 'node_modules' || entry === '.svelte-kit') continue;
				const p = join(dir, entry);
				if (statSync(p).isDirectory()) {
					walk(p);
					continue;
				}
				if (!/\.(ts|js|svelte)$/.test(entry)) continue;
				if (entry.endsWith('.spec.ts') || entry.endsWith('.test.ts')) continue;
				if (skip.has(p)) continue;
				visited++;
				if (readFileSync(p, 'utf8').includes('publish_now')) offenders.push(p);
			}
		};
		walk(SRC);
		// Guard the guard: a walk that found nothing would pass regardless.
		expect(visited, 'the walk actually visited the source tree').toBeGreaterThan(100);
		expect(offenders).toEqual([]);
	});
});

describe('the toast says what happened to the post', () => {
	const hosts = [
		['personas/[agentId]/+page.svelte', personaPage],
		['calendar/+page.svelte', calendarPage]
	] as const;

	it.each(hosts)('%s reports the outcome from the row, not from hope', (_name, page) => {
		const fn = page.slice(
			page.indexOf('function postOutcomeMessage'),
			page.indexOf('\n\t}', page.indexOf('function postOutcomeMessage'))
		);
		expect(fn.length, 'the page has a postOutcomeMessage helper').toBeGreaterThan(50);
		expect(fn).toContain("status === 'published'");
		expect(fn).toContain("status === 'scheduled'");
		// The default arm is the held case — the one the old copy hid.
		expect(fn).toContain('review queue');
	});

	it.each(hosts)('%s states an outcome ONLY inside the helper', (_name, page) => {
		// The old copy asserted an ending at the call site — "Post generated!",
		// "Post generated and published successfully!" — which is exactly where the
		// row's real status is not being consulted. Cut the helper out and no
		// outcome wording may remain anywhere else in the file.
		const code = codeOnly(page);
		const helperAt = code.indexOf('function postOutcomeMessage');
		expect(helperAt, 'the page has a postOutcomeMessage helper').toBeGreaterThan(-1);
		const outsideHelper = code.slice(0, helperAt) + code.slice(code.indexOf('\n\t}', helperAt));
		for (const claim of [
			'Post generated!',
			"'Post generated'",
			'Post generated and published',
			'Post generated and scheduled'
		]) {
			expect(outsideHelper, `an outcome is hard-coded at a call site: ${claim}`).not.toContain(
				claim
			);
		}
	});

	it.each(hosts)('%s routes every success toast through the helper', (_name, page) => {
		// Both the polled (202) path and the legacy synchronous path end in a
		// success toast; both must derive it, or one of them starts lying again.
		const calls = Array.from(page.matchAll(/showToast\(\s*postOutcomeMessage\(/g));
		expect(calls.length).toBeGreaterThanOrEqual(2);
	});
});
