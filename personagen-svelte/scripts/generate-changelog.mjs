#!/usr/bin/env node
/**
 * Regenerates src/lib/changelog.ts from the real git history.
 *
 * This is the script changelog.ts's header always claimed existed. It didn't,
 * which is why the file was hand-run once and then drifted from git.
 *
 * It produces two things:
 *   CHANGELOG      every commit, oldest first (the raw ledger)
 *   CHANGE_GROUPS  those commits clustered into intent-sized releases
 *
 * Grouping is deterministic: a new group starts when a curated milestone
 * begins, when the theme changes, or when more than GAP_DAYS pass. Titles and
 * summaries are auto-written in plain language, and any group whose id appears
 * in changelog-copy.ts uses the hand-written copy instead — so regenerating
 * never clobbers writing.
 *
 * Usage:  node scripts/generate-changelog.mjs [--check]
 *         --check exits 1 if the file is out of date (for CI / predeploy)
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const OUT = resolve(HERE, '..', 'src', 'lib', 'changelog.ts');
const COPY = resolve(HERE, '..', 'src', 'lib', 'changelog-copy.ts');
const GAP_DAYS = 3;

// ── User-facing categories ────────────────────────────────────────────────
// Conventional-commit types answer "what kind of edit"; these answer "what
// changed for me", which is what a filter on a user-facing page needs.
const CATEGORY_RULES = [
	['security', /\b(auth|login|signin|sign-in|session|token|secret|credential|password|encrypt|rls|permission|pin gate|api key|service[- ]role|sanitiz|xss|csrf)\b/i],
	['automation', /\b(scheduler|autopilot|cron|auto-?post|auto-?publish|queue worker|background|tick|lease|worker|automation|backfill)\b/i],
	['publishing', /\b(publish|post now|zernio|postiz|blotato|connection|platform|instagram|tiktok|youtube|scheduled? post)\b/i],
	['generation', /\b(generat|prompt|model|fal|gemini|openrouter|kling|veo|image|video|voice|tts|avatar|reference kit|persona profile|composer|studio)\b/i],
	['performance', /\b(perf|performance|faster|speed|cache|lazy|thumbnail|webp|resize|payload|bundle|optimi[sz])\b/i],
	['design', /\b(design|ui|ux|style|styling|layout|theme|dark mode|light mode|contrast|redesign|polish|responsive|spacing|typography|icon)\b/i],
	['docs', /\b(docs?|guide|readme|walkthrough|changelog|roadmap|documentation)\b/i],
	['infrastructure', /\b(deploy|build|docker|easypanel|migration|env|config|ci|pipeline|gitignore|dependency|dependencies|upgrade)\b/i]
];
const TYPE_FALLBACK = {
	feat: 'feature', fix: 'fix', perf: 'performance', docs: 'docs',
	redesign: 'design', polish: 'design', style: 'design',
	deploy: 'infrastructure', chore: 'infrastructure', refactor: 'maintenance',
	test: 'maintenance', other: 'maintenance'
};

function categorize(type, title) {
	for (const [cat, re] of CATEGORY_RULES) if (re.test(title)) return cat;
	return TYPE_FALLBACK[type] ?? 'maintenance';
}

function classifyType(subject) {
	const m = subject.match(/^(\w+)(\([^)]*\))?!?:/);
	const raw = m ? m[1].toLowerCase() : '';
	const known = ['feat', 'fix', 'chore', 'docs', 'perf', 'refactor', 'test', 'style'];
	if (known.includes(raw)) return raw;
	if (/^redesign/i.test(subject)) return 'redesign';
	if (/^polish/i.test(subject)) return 'polish';
	if (/^deploy/i.test(subject)) return 'deploy';
	return 'other';
}

const stripPrefix = (s) => s.replace(/^\w+(\([^)]*\))?!?:\s*/, '').trim();
const scopeOf = (s) => {
	const m = s.match(/^\w+\(([^)]*)\)!?:/);
	return m ? m[1] : null;
};

// ── Read history ──────────────────────────────────────────────────────────
// execFileSync (not execSync): on Windows a shell would read the "|" in the
// format string as a pipe. The separator is US (\x1f) rather than "|" so a
// commit subject containing a pipe cannot break parsing either.
const SEP = '\x1f';
let raw;
try {
	raw = execFileSync('git', ['log', '--reverse', `--format=%ad${SEP}%h${SEP}%s`, '--date=short'], {
		cwd: REPO,
		encoding: 'utf8',
		maxBuffer: 32 * 1024 * 1024,
		stdio: ['ignore', 'pipe', 'pipe']
	});
} catch {
	// This runs in the build pipeline, and some build hosts export the source
	// without a .git directory. Failing the whole build over a changelog would
	// be a terrible trade — keep whatever is committed and say so.
	console.warn(
		'[changelog] no git history available here — keeping the committed changelog.ts as-is.'
	);
	process.exit(0);
}

const entries = raw
	.split('\n')
	.map((l) => l.replace(/\r$/, ''))
	.filter(Boolean)
	.map((line) => {
		const i1 = line.indexOf(SEP);
		const i2 = line.indexOf(SEP, i1 + 1);
		const date = line.slice(0, i1);
		const hash = line.slice(i1 + 1, i2);
		const subject = line.slice(i2 + 1);
		const type = classifyType(subject);
		const title = stripPrefix(subject);
		return { date, hash, type, scope: scopeOf(subject), title, category: categorize(type, title) };
	});

// ── Curation comes from changelog-copy.ts, which this script never writes ──
// Reading curation back out of the generated file was a data-loss trap: the
// emitted quote style differs from the hand-written original, so the second
// consecutive run silently dropped every milestone.
const copySrc = (() => {
	try {
		return readFileSync(COPY, 'utf8');
	} catch {
		return '';
	}
})();

const milestones = {};
{
	const block = copySrc.match(/MILESTONES[^{]*\{([\s\S]*?)\n\};/);
	if (block) {
		for (const m of block[1].matchAll(/"([a-f0-9]{7,})":\s*("(?:[^"\\]|\\.)*")/g)) {
			milestones[m[1]] = JSON.parse(m[2]);
		}
	}
}
for (const e of entries) if (milestones[e.hash]) e.milestone = milestones[e.hash];

// Curation that no longer matches a commit (rebased, squashed) is silently
// dead weight unless we say so.
const unknownMilestones = Object.keys(milestones).filter(
	(h) => !entries.some((e) => e.hash === h)
);

// ── Group into intents ────────────────────────────────────────────────────
// Breaking on every theme change produced 230 groups from 302 commits — 1.3
// commits each, which is just the raw list again. Real work interleaves
// features, fixes and chores within one intent, so a group ends at an era
// boundary, a quiet stretch, or when it simply gets too big to summarise.
const daysApart = (a, b) => Math.abs((new Date(a) - new Date(b)) / 86400000);
const MAX_GROUP = 14;
const groups = [];
for (const e of entries) {
	const g = groups[groups.length - 1];
	const startsEra = !!e.milestone;
	const tooFarApart = g && daysApart(g.to, e.date) > GAP_DAYS;
	const tooBig = g && g.entries.length >= MAX_GROUP;
	if (!g || startsEra || tooFarApart || tooBig) {
		groups.push({ id: e.hash, from: e.date, to: e.date, entries: [e] });
	} else {
		g.entries.push(e);
		g.to = e.date;
	}
}
// A group's category is whichever theme dominates it, not whichever happened
// to come first.
for (const g of groups) {
	const tally = {};
	for (const e of g.entries) tally[e.category] = (tally[e.category] ?? 0) + 1;
	g.category = Object.entries(tally).sort((a, b) => b[1] - a[1])[0][0];
}

// ── Plain-language copy ───────────────────────────────────────────────────
const CATEGORY_WORDS = {
	feature: ['New', 'things you can now do'],
	fix: ['Fixed', 'things that were broken'],
	performance: ['Faster', 'speed and size'],
	security: ['Safer', 'sign-in and account protection'],
	automation: ['Automatic', 'work the app does on its own'],
	publishing: ['Publishing', 'getting posts onto your accounts'],
	generation: ['Creating', 'making posts, images and video'],
	design: ['Look and feel', 'layout, colours and readability'],
	docs: ['Help', 'guides and explanations'],
	infrastructure: ['Behind the scenes', 'setup and deployment'],
	maintenance: ['Tidying', 'internal cleanup']
};

/** Trim to a word boundary rather than mid-word, and only ellipsise if cut. */
function clip(text, max) {
	if (text.length <= max) return text;
	const cut = text.slice(0, max);
	const at = cut.lastIndexOf(' ');
	return `${(at > max * 0.6 ? cut.slice(0, at) : cut).replace(/[\s,;:—-]+$/, '')}…`;
}

const sentence = (s) => `${s[0].toUpperCase()}${s.slice(1)}`.replace(/\.?$/, '.');

function autoCopy(g) {
	const [word] = CATEGORY_WORDS[g.category] ?? CATEGORY_WORDS.maintenance;
	const n = g.entries.length;
	const era = g.entries.find((e) => e.milestone)?.milestone;
	const first = g.entries[0].title;

	if (era) return { title: era.split(/[—:.]/)[0].trim(), summary: era };

	const title = `${word}: ${clip(first, 52)}`;
	// Name the other themes present instead of the bare count — "also touches
	// publishing and design" tells you more than "8 changes".
	const others = [...new Set(g.entries.map((e) => e.category))]
		.filter((c) => c !== g.category)
		.slice(0, 3)
		.map((c) => (CATEGORY_WORDS[c] ?? CATEGORY_WORDS.maintenance)[1]);
	const extra =
		n === 1
			? ''
			: ` Plus ${n - 1} more change${n - 1 === 1 ? '' : 's'}${others.length ? `, touching ${others.join(' and ')}` : ''}.`;
	return { title, summary: `${sentence(first)}${extra}` };
}

const curated = {};
{
	const block = copySrc.match(/GROUP_COPY[^{]*\{([\s\S]*)\n\};/);
	if (block) {
		const re =
			/"([a-f0-9]{7,})":\s*\{\s*title:\s*("(?:[^"\\]|\\.)*"),\s*summary:\s*("(?:[^"\\]|\\.)*")/g;
		for (const m of block[1].matchAll(re)) {
			curated[m[1]] = { title: JSON.parse(m[2]), summary: JSON.parse(m[3]) };
		}
	}
}

for (const g of groups) {
	const c = curated[g.id] ?? autoCopy(g);
	g.title = c.title;
	g.summary = c.summary;
	g.curated = !!curated[g.id];
	g.categories = [...new Set(g.entries.map((e) => e.category))];
	g.major = g.entries.some((e) => e.milestone) || g.entries.length >= 5;
}

// ── Emit ──────────────────────────────────────────────────────────────────
const J = (v) => JSON.stringify(v);
const types = [...new Set(entries.map((e) => e.type))].sort();
const cats = [...new Set(entries.map((e) => e.category))].sort();

const out = `/**
 * Changelog — GENERATED from the real git history by scripts/generate-changelog.mjs.
 *
 * DO NOT hand-edit. Run:  node scripts/generate-changelog.mjs
 * Plain-language copy lives in changelog-copy.ts and survives regeneration;
 * milestones are read back out of this file, so they survive too.
 */

export type ChangeType = ${types.map(J).join(' | ')};
export type ChangeCategory = ${cats.map(J).join(' | ')};

export interface ChangeEntry {
	date: string;
	hash: string;
	type: ChangeType;
	category: ChangeCategory;
	scope: string | null;
	title: string;
	milestone?: string;
}

/** One intent-sized release: a themed run of commits, with plain-language copy. */
export interface ChangeGroup {
	id: string;
	from: string;
	to: string;
	category: ChangeCategory;
	categories: ChangeCategory[];
	title: string;
	summary: string;
	major: boolean;
	curated: boolean;
	entries: ChangeEntry[];
}

export const CHANGELOG: ChangeEntry[] = [
${entries
	.map(
		(e) =>
			`	{ date: ${J(e.date)}, hash: ${J(e.hash)}, type: ${J(e.type)}, category: ${J(e.category)}, scope: ${J(e.scope)}, title: ${J(e.title)}${e.milestone ? `, milestone: ${J(e.milestone)}` : ''} }`
	)
	.join(',\n')}
];

export const CHANGE_GROUPS: ChangeGroup[] = [
${groups
	.map(
		(g) => `	{
		id: ${J(g.id)}, from: ${J(g.from)}, to: ${J(g.to)},
		category: ${J(g.category)}, categories: ${J(g.categories)},
		title: ${J(g.title)},
		summary: ${J(g.summary)},
		major: ${g.major}, curated: ${g.curated},
		entries: [${g.entries.map((e) => `CHANGELOG[${entries.indexOf(e)}]`).join(', ')}]
	}`
	)
	.join(',\n')}
];

export const CHANGELOG_GENERATED_FROM = ${J(entries[entries.length - 1]?.hash ?? '')};
`;

// --list prints every group with the commits inside it, so whoever writes the
// plain-language copy can see exactly what they are summarising.
if (process.argv.includes('--list')) {
	for (const g of groups) {
		const flag = g.curated ? 'CURATED' : 'auto';
		console.log(`
${g.id}  ${g.from}..${g.to}  [${g.category}]  ${g.entries.length} commit(s)  ${flag}`);
		console.log(`   title:   ${g.title}`);
		console.log(`   summary: ${g.summary}`);
		for (const e of g.entries) console.log(`     - (${e.category}) ${e.title}`);
	}
	process.exit(0);
}

if (process.argv.includes('--check')) {
	let current = '';
	try {
		current = readFileSync(OUT, 'utf8');
	} catch {
		/* missing counts as out of date */
	}
	if (current.trim() !== out.trim()) {
		console.error('changelog.ts is out of date — run: node scripts/generate-changelog.mjs');
		process.exit(1);
	}
	console.log('changelog.ts is up to date');
	process.exit(0);
}

writeFileSync(OUT, out, 'utf8');
console.log(`wrote ${entries.length} entries in ${groups.length} groups -> src/lib/changelog.ts`);
console.log(`curated copy applied to ${groups.filter((g) => g.curated).length} group(s)`);
if (unknownMilestones.length) {
	console.warn(`WARNING: ${unknownMilestones.length} milestone hash(es) match no commit (rebased away?): ${unknownMilestones.join(', ')}`);
}
const orphanCopy = Object.keys(curated).filter((id) => !groups.some((g) => g.id === id));
if (orphanCopy.length) {
	console.warn(`WARNING: ${orphanCopy.length} curated group id(s) no longer start a group — their copy is unused: ${orphanCopy.join(', ')}`);
}
const byCat = {};
for (const e of entries) byCat[e.category] = (byCat[e.category] ?? 0) + 1;
console.log(
	'categories:',
	Object.entries(byCat)
		.sort((a, b) => b[1] - a[1])
		.map(([k, v]) => `${k}=${v}`)
		.join(' ')
);
