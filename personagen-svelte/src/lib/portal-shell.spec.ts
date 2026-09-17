/**
 * The portal's structural invariants.
 *
 * Four rounds of UX work fixed instance after instance while the things
 * PRODUCING those instances stayed in place — every route free to invent its
 * own width and heading size, every component free to delete its focus ring,
 * every legend free to invent its own status buckets. Round 4 re-measured the
 * layout numbers and got results identical to round 2, because nothing stopped
 * the next page from drifting the same way.
 *
 * So these are not tests of the fixes. They are tests of the rules the fixes
 * established, written against the source so that the NEXT page to be added has
 * to obey them too. Each one failed before the change it guards.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const srcDir = join(__dirname, '..');
const portalDir = join(srcDir, 'routes', '(portal)');

function walk(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) out.push(...walk(full));
		else out.push(full);
	}
	return out;
}

const svelteFiles = walk(join(srcDir)).filter((f) => f.endsWith('.svelte'));
const portalPages = walk(portalDir).filter((f) => f.endsWith('+page.svelte'));
const read = (f: string) => readFileSync(f, 'utf8');
/** Comments explain these rules; they must not be mistaken for breaking them. */
const stripComments = (s: string) => s.replace(/[/][*][^]*?[*][/]/g, '');
const rel = (f: string) => f.slice(srcDir.length + 1).replace(/\\/g, '/');

/**
 * /guides is the one documented exception: it is a full-bleed docs hub with a
 * sticky bar that the shell's centred column would break. It still has to agree
 * on the h1 size and on where its content column starts — the rules below check
 * that separately rather than simply excusing it.
 */
const SHELL_EXEMPT = ['routes/(portal)/guides/+page.svelte'];

describe('every portal page sits in the shared shell', () => {
	it('imports PageShell', () => {
		const missing = portalPages
			.filter((f) => !SHELL_EXEMPT.includes(rel(f)))
			.filter((f) => !read(f).includes("from '$lib/components/ui/PageShell.svelte'"))
			.map(rel);
		expect(missing).toEqual([]);
	});

	it('does not set its own container width', () => {
		// Ten different max-widths from 800px to 100% is how the h1 left edge came
		// to swing 441px between routes at 1920. Width is the shell's to choose.
		const offenders: string[] = [];
		// /guides is exempt here for the same reason it is exempt from the shell:
		// its `.cl-body` / `.uv-body` are reading columns INSIDE the docs hub, not
		// the page frame, which the sticky full-bleed bar owns. Its h1 size and
		// content alignment are still checked, below and in the alignment rule.
		for (const f of portalPages.filter((f) => !SHELL_EXEMPT.includes(rel(f)))) {
			const styles = stripComments(read(f).split('<style>')[1] ?? '');
			// A page-level container rule is one that pairs a pixel max-width with
			// the centring margin. Inner cards and columns are untouched by this.
			const re = /max-width:\s*\d{3,4}px;[\s\S]{0,80}?margin:\s*0 auto;/g;
			if (re.test(styles)) offenders.push(rel(f));
		}
		expect(offenders).toEqual([]);
	});

	it('does not set its own h1 size', () => {
		// Eight sizes for one semantic level, from 21.6px to 67.2px — a 3.1x swing
		// that made every navigation a small relearning.
		const offenders: string[] = [];
		for (const f of [...portalPages, ...SHELL_EXEMPT.map((r) => join(srcDir, r))]) {
			const styles = stripComments(read(f).split('<style>')[1] ?? '');
			for (const m of styles.matchAll(/([^{}]*\bh1\b[^{}]*)\{([^}]*)\}/g)) {
				const [, selector, body] = m;
				if (!/font-size:/.test(body)) continue;
				// The shared token is the only allowed answer.
				if (/font-size:\s*var\(--text-xl\)/.test(body)) continue;
				offenders.push(`${rel(f)}: ${selector.trim()}`);
			}
		}
		expect(offenders).toEqual([]);
	});
});

describe('the one shell exception still agrees with the shell', () => {
	it('aligns /guides content to the shared column', () => {
		const guides = read(join(srcDir, 'routes', '(portal)', 'guides', '+page.svelte'));
		// The full-bleed bar and body centre their CONTENTS on --page-wide, so the
		// h1 lands where every other portal h1 lands despite the different frame.
		const aligned = [...guides.matchAll(/padding-inline:\s*max\([^;]*--page-wide[^;]*\);/g)];
		expect(aligned.length).toBeGreaterThanOrEqual(2);
	});
});

describe('focus is always visible', () => {
	it('no focus rule removes the outline without replacing it', () => {
		// `outline: none` paired with a 22%-alpha border drew a ring measuring
		// about 1.2:1 — invisible, against WCAG 2.2 SC 2.4.11's 3:1 floor. The
		// baseline ring in app.css is out-specified by any component rule, so the
		// floor only holds if nothing quietly re-adds the suppression.
		//
		// Containers that take PROGRAMMATIC focus (a modal, a lightbox, the main
		// region after a skip link) are allowed to suppress it on `:focus`: they
		// are not controls, and a ring on script-driven focus is noise. They are
		// listed by name so that adding another is a deliberate act.
		const ALLOWED = ['.modal:focus', '.lb-content:focus', '.portal-content:focus'];
		const offenders: string[] = [];
		for (const f of [...svelteFiles, join(srcDir, 'app.css')]) {
			const text = read(f);
			const styles = stripComments(
				f.endsWith('.css') ? text : (text.split('<style>')[1] ?? '')
			);
			for (const m of styles.matchAll(/([^{}]*:focus(?:-visible)?[^{}]*)\{([^}]*)\}/g)) {
				const [, selector, body] = m;
				if (!/outline:\s*none/.test(body)) continue;
				if (ALLOWED.some((a) => selector.includes(a))) continue;
				offenders.push(`${rel(f)}: ${selector.trim()}`);
			}
		}
		expect(offenders).toEqual([]);
	});

	it('app.css defines an opaque focus ring for both themes', () => {
		const css = read(join(srcDir, 'app.css'));
		// Two definitions minimum: the light default and the dark override. An
		// alpha-bearing colour function here would reintroduce the original bug.
		const rings = [...css.matchAll(/--focus-ring:\s*([^;]+);/g)].map((m) => m[1].trim());
		expect(rings.length).toBeGreaterThanOrEqual(2);
		for (const r of rings) {
			expect(r).toMatch(/^#[0-9a-f]{6}$/i);
		}
	});
});

describe('the calendar legend counts what it says it counts', () => {
	const view = read(join(srcDir, 'lib', 'components', 'calendar', 'CalendarView.svelte'));

	it('offers exactly one chip per post status', () => {
		// The legend used to fold `partial` into published, `publishing` into
		// scheduled and `rejected` into FAILED — so a post you turned down was
		// reported back as one the system failed to make.
		const block = view.match(/const CHIP_ORDER: PostStatus\[\] = \[([\s\S]*?)\];/);
		expect(block, 'CHIP_ORDER not found').toBeTruthy();
		const chips = [...block![1].matchAll(/'([a-z]+)'/g)].map((m) => m[1]);

		// Compared against the module that owns the status vocabulary, not a list
		// retyped here: a status added there must get a chip.
		const statusSrc = read(join(srcDir, 'lib', 'status-color.ts'));
		const statuses = [
			...statusSrc
				.match(/export const POST_STATUSES = \[([\s\S]*?)\] as const;/)![1]
				.matchAll(/'([a-z]+)'/g)
		].map((m) => m[1]);

		expect([...chips].sort()).toEqual([...statuses].sort());
		expect(new Set(chips).size).toBe(chips.length);
	});

	it('filters by status equality, not by a bucket lookup', () => {
		expect(view).toMatch(/agentFiltered\.filter\(\(p\) => p\.status === statusChip\)/);
		expect(view).not.toContain('STATUS_GROUPS');
	});
});

describe('user-facing copy', () => {
	it('never ships a "(s)" plural placeholder', () => {
		const offenders: string[] = [];
		for (const f of svelteFiles) {
			const text = read(f);
			const markup = text.split('<style>')[0];
			// A call like `payer(s)` is code, not copy. Anything the file declares
			// as a name is treated as a call site rather than a lazy plural.
			const declared = new Set(
				[...markup.matchAll(/(?:function|const|let|var)\s+(\w+)/g)].map((m) => m[1])
			);
			// `post(s)`, `item(s)` — the lazy plural, on strings users read every day.
			// `.includes(s)` and friends are calls, not copy, so a preceding dot or
			// word character is not a match.
			for (const m of markup.matchAll(/(^|[^.\w])([a-z]{3,})\(s\)/gm)) {
				if (declared.has(m[2])) continue;
				offenders.push(`${rel(f)}: ${m[2]}(s)`);
			}
		}
		expect(offenders).toEqual([]);
	});
});
