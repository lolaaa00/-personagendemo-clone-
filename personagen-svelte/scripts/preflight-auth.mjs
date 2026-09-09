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
 *   node scripts/preflight-auth.mjs              # enforce (exit 1 when either door is open)
 *   node scripts/preflight-auth.mjs --warn-only  # report only (exit 0)
 *
 * There are TWO doors and this checks both: the Supabase project's own signup
 * setting, and whether ADMIN_PIN gives /api/auth/signup anything to ask for.
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

// NOT an early exit any more. This said "ADMIN_PIN is not set — open
// registration is the deliberate configuration. OK." and returned 0, which
// meant the second gap silenced the check for the first: with no PIN the probe
// never contacted GoTrue at all, so the deploy reported a clean signup gate
// while BOTH doors stood open. That is the exact configuration production was
// measured in on 2026-09-09. The probe now always asks GoTrue, and the verdict
// is about the pair.
if (!pin) {
	console.warn('  [preflight-auth] ADMIN_PIN is NOT set — /api/auth/signup admits anyone who finds it.');
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

// The verdict is about BOTH doors. Either one open is a finding; naming only
// the one that happens to be open is how this stayed quiet.
const anonDoorOpen = settings.disable_signup === false;
const routeDoorOpen = !pin;

if (anonDoorOpen || routeDoorOpen) {
	const lines = ['  [preflight-auth] REGISTRATION IS OPEN.'];
	if (anonDoorOpen) {
		lines.push(
			`  [preflight-auth]   · ${url} reports disable_signup=false (mailer_autoconfirm=${settings.mailer_autoconfirm}).`,
			'  [preflight-auth]     The anon key ships in the browser bundle, so anyone can POST straight to',
			`  [preflight-auth]     ${url}/auth/v1/signup and get an account.`,
			'  [preflight-auth]     Fix: GOTRUE_DISABLE_SIGNUP=true on the auth service (self-hosted), or',
			'  [preflight-auth]          Authentication > Providers > Email > "Allow new users to sign up" OFF.'
		);
	}
	if (routeDoorOpen) {
		lines.push(
			'  [preflight-auth]   · ADMIN_PIN is not set, so /api/auth/signup asks for nothing.',
			'  [preflight-auth]     Fix: set ADMIN_PIN on the app service.'
		);
	}
	if (anonDoorOpen && routeDoorOpen) {
		lines.push('  [preflight-auth]   Both doors are open. Close the anon one FIRST — shutting only the');
		lines.push('  [preflight-auth]   front door leaves the bypass, which is the worse half.');
	}
	lines.push('  [preflight-auth] Registration keeps working after the flip: the route creates users');
	lines.push('  [preflight-auth] with the service role, which GOTRUE_DISABLE_SIGNUP does not affect.');
	fail(lines);
}

console.log('  [preflight-auth] OK — ADMIN_PIN is set and the project refuses public signups.');
