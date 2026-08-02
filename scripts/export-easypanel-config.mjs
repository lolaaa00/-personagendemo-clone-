#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// export-easypanel-config.mjs
//
// Pulls a COMPLETE snapshot of an EasyPanel project — every service, every env
// var (values included), domains, mounts, ports, and any inline compose YAML —
// into a single JSON file. Built for client handover and disaster recovery.
//
// Why it exists: several things live ONLY inside the panel and are in no repo:
//   - inline compose services (personagen-hermes is one: ~1 KB of YAML)
//   - every secret (Supabase keys, JWT_SECRET, USER_SECRETS_ENCRYPTION_KEY,
//     provider API keys) — .env files are gitignored, so the repo has none
//   - domain -> service routing, including the compose `composeService` field
// Losing the panel today would lose all of the above irrecoverably.
//
// Usage (PowerShell):
//   $env:PANEL_URL="https://sxzqx7.easypanel.host"
//   $env:PANEL_TOKEN="<panel api token>"
//   node scripts/export-easypanel-config.mjs honeyx
//
// Output: easypanel-export-<project>-<timestamp>.json in the current directory.
//
// ⚠ The output contains PLAINTEXT SECRETS. Treat it like a password vault
//   export: store encrypted, never commit it. The script refuses to write
//   inside a git work tree unless you pass --allow-in-repo.
// ═══════════════════════════════════════════════════════════════════════════

import { writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const PANEL_URL = (process.env.PANEL_URL || '').replace(/\/+$/, '');
const PANEL_TOKEN = process.env.PANEL_TOKEN || '';
const project = process.argv.find((a) => !a.startsWith('-') && !a.endsWith('.mjs') && !a.includes('node')) || 'honeyx';
const allowInRepo = process.argv.includes('--allow-in-repo');

if (!PANEL_URL || !PANEL_TOKEN) {
	console.error('Set PANEL_URL and PANEL_TOKEN environment variables first.');
	process.exit(1);
}
if (existsSync(join(process.cwd(), '.git')) && !allowInRepo) {
	console.error('Refusing to write a secret-bearing export into a git work tree.');
	console.error('cd somewhere outside the repo, or pass --allow-in-repo if you know what you are doing.');
	process.exit(1);
}

// EasyPanel's tRPC uses POST for EVERYTHING (queries included — GET returns 405)
// and a superjson transformer, so payloads are wrapped/unwrapped as {json: ...}.
// Errors come back 200-or-4xx with the fault inside the same `json` envelope.
async function query(procedure, input) {
	const res = await fetch(`${PANEL_URL}/api/trpc/${procedure}`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${PANEL_TOKEN}` },
		body: JSON.stringify({ json: input ?? {} }),
	});
	const text = await res.text();
	let body;
	try { body = JSON.parse(text); } catch { throw new Error(`${procedure}: non-JSON response (${res.status}) ${text.slice(0, 120)}`); }
	const data = body?.json ?? body?.result?.data?.json ?? body?.result?.data;
	if (data && data.defined === false && data.code) throw new Error(`${procedure}: ${data.code} ${data.message ?? ''}`);
	if (body?.error) throw new Error(`${procedure}: ${body.error?.message ?? 'unknown error'}`);
	return data;
}

const parseEnv = (raw) =>
	Object.fromEntries(
		String(raw ?? '')
			.split(/\r?\n/)
			.map((l) => {
				const i = l.indexOf('=');
				return i < 1 || l.trimStart().startsWith('#') ? null : [l.slice(0, i).trim(), l.slice(i + 1)];
			})
			.filter(Boolean)
	);

const main = async () => {
	const stamp = new Date().toISOString().replace(/[:.]/g, '-');
	const out = { exportedAt: new Date().toISOString(), panel: PANEL_URL, project, services: [], domains: [], warnings: [] };

	const inspected = await query('projects.inspectProject', { projectName: project });
	const services = inspected?.services ?? [];

	for (const s of services) {
		const kind = s.type === 'compose' ? 'compose' : 'app';
		let detail = null;
		try { detail = await query(`services.${kind}.inspectService`, { projectName: project, serviceName: s.name }); }
		catch (e) { out.warnings.push(`inspect ${s.name}: ${e.message}`); }

		const entry = {
			name: s.name,
			type: s.type,
			enabled: s.enabled,
			source: s.source ?? null,
			build: s.build ?? null,
			deploy: s.deploy ?? null,
			mounts: s.mounts ?? [],
			ports: s.ports ?? [],
			deployedCommit: s.commit?.sha ?? null,
			env: parseEnv(detail?.env ?? s.env),
		};

		// Inline compose YAML exists nowhere else — capture it verbatim.
		if (s.type === 'compose') {
			const content = detail?.source?.content ?? s.source?.content ?? null;
			if (content) entry.inlineComposeYaml = content;
			try { entry.composeServices = await query('services.compose.getDockerServices', { projectName: project, serviceName: s.name }); }
			catch { /* non-fatal */ }
		}

		const blanks = Object.entries(entry.env).filter(([, v]) => v === '').map(([k]) => k);
		if (blanks.length) out.warnings.push(`${s.name}: env set-but-empty -> ${blanks.join(', ')}`);

		out.services.push(entry);
	}

	try {
		out.domains = (await query('domains.listDomains', { projectName: project })) ?? [];
	} catch (e) { out.warnings.push(`domains: ${e.message}`); }

	const file = join(process.cwd(), `easypanel-export-${project}-${stamp}.json`);
	writeFileSync(file, JSON.stringify(out, null, 2), 'utf8');

	const secretCount = out.services.reduce((n, s) => n + Object.keys(s.env).length, 0);
	console.log(`Wrote ${file}`);
	console.log(`  services: ${out.services.length}   env vars captured: ${secretCount}   domains: ${out.domains.length}`);
	if (out.services.some((s) => s.inlineComposeYaml)) {
		console.log(`  inline compose recovered: ${out.services.filter((s) => s.inlineComposeYaml).map((s) => s.name).join(', ')}`);
	}
	if (out.warnings.length) {
		console.log('\n  warnings:');
		for (const w of out.warnings) console.log(`    - ${w}`);
	}
	console.log('\n  This file contains plaintext secrets. Store it encrypted; do not commit.');
};

main().catch((e) => { console.error('Export failed:', e.message); process.exit(1); });
