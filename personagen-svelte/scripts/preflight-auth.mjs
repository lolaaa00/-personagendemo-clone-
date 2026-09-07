#!/usr/bin/env node
/**
 * Auth signup-gate preflight.
 *
 * /signup asks for an Admin PIN when ADMIN_PIN is set. That gate is only real
 * while the Supabase project itself refuses public registration: the anon key
 * ships inside the browser bundle, so anyone holding it can POST straight to
 *   <supabase>/auth/v1/signup
 * and get an account without ever touching our route or its PIN.
 *
 * This was the live state of production on 2026-09-05 (`disable_signup: false`,
 * `mailer_autoconfirm: true`). The route was changed to create users with the
 * service role, which is what lets the project run with signups disabled — but
 * the project setting is the half that actually closes the hole, and a setting
 * is exactly the kind of thing that silently comes back on a re-provision.
 * Hence a probe on the deploy path rather than a note in a document.
 *
 * Remediation when this fails:
 *   self-hosted : GOTRUE_DISABLE_SIGNUP=true on the Supabase auth service, restart
 *   hosted      : Authentication -> Providers -> Email -> "Allow new users to sign up" OFF
 * Registration keeps working after the flip because the route creates users
 * with the service role.
 *
 * Usage:
 *   node scripts/preflight-auth.mjs              # enforce (exit 1 when the gate is bypassable)
 *   node scripts/preflight-auth.mjs --warn-only  # report only (exit 0)
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '..');
const warnOnly = process.argv.includes('--warn-only');

function loadEnv() {
	const out = { ...process.env };
	// The app's own .env wins; the repo-root .env is the fallback the deploy host uses.
	for (const envPath of [join(appRoot, '.env'), join(appRoot, '..', '.env')]) {
		if (!existsSync(envPath)) continue;
		for (const line of readFileSync(envPath, 'utf8').split('\n')) {
			const m = line.match(/^\s*([\w_]+)\s*=\s*(.*)\s*$/);
			if (!m) continue;
			let v = m[2].trim();
			if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
				v = v.slice(1, -1);
			}
			if (!(m[1] in out) || out[m[1]] === '') out[m[1]] = v;
		}
	}
	return out;
}

/** Non-zero unless --warn-only, so the caller decides how loud a failure is. */
function fail(lines) {
	for (const l of lines) console.error(l);
	if (warnOnly) {
		console.error('  [preflight-auth] --warn-only: NOT blocking this deploy.');
		process.exit(0);
	}
	process.exit(1);
}

const env = loadEnv();
const url = (env.PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '');
const anon = env.PUBLIC_SUPABASE_ANON_KEY;
const pin = env.ADMIN_PIN;

if (!pin) {
	console.log('  [preflight-auth] ADMIN_PIN is not set — open registration is the deliberate configuration. OK.');
	process.exit(0);
}

if (!url || !anon) {
	// Not a security verdict, just an un-runnable probe. Never block on this.
	console.log('  [preflight-auth] PUBLIC_SUPABASE_URL / ANON_KEY not readable here — skipping probe.');
	process.exit(0);
}

let settings;
try {
	const res = await fetch(`${url}/auth/v1/settings`, {
		headers: { apikey: anon },
		signal: AbortSignal.timeout(10_000)
	});
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	settings = await res.json();
} catch (e) {
	// Fail OPEN on an unreachable auth server: a transient network blip must not
	// block shipping. The line is loud enough to notice if it becomes permanent.
	console.warn(`  [preflight-auth] WARNING: could not reach ${url}/auth/v1/settings (${e.message}).`);
	console.warn('  [preflight-auth] Signup-gate state UNVERIFIED for this deploy.');
	process.exit(0);
}

if (settings.disable_signup === false) {
	fail([
		'  [preflight-auth] ADMIN_PIN is set, but the Supabase project ACCEPTS PUBLIC SIGNUPS.',
		`  [preflight-auth] ${url} reports disable_signup=false, mailer_autoconfirm=${settings.mailer_autoconfirm}.`,
		'  [preflight-auth] The anon key is in the browser bundle, so the PIN can be bypassed with:',
		`  [preflight-auth]     POST ${url}/auth/v1/signup`,
		'  [preflight-auth] Fix: GOTRUE_DISABLE_SIGNUP=true on the auth service (self-hosted), or',
		'  [preflight-auth]      Authentication > Providers > Email > "Allow new users to sign up" OFF.',
		'  [preflight-auth] Registration keeps working: the route creates users with the service role.'
	]);
}

console.log('  [preflight-auth] OK — ADMIN_PIN is set and the project refuses public signups.');
