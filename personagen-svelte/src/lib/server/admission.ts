/**
 * Admission posture — who can create an account, measured rather than assumed.
 *
 * There are TWO doors:
 *
 *   1. The Supabase project's own signup setting. The anon key ships inside the
 *      browser bundle, so while `disable_signup` is false anyone can POST to
 *      `<supabase>/auth/v1/signup` and get an account without ever touching our
 *      route. Only an operator can close this (GOTRUE_DISABLE_SIGNUP=true).
 *   2. ADMIN_PIN. Without it `/api/auth/signup` asks for nothing.
 *
 * Both were measured open in production on 2026-09-09. `scripts/preflight-auth`
 * checks them on the deploy path, but a deploy-time probe says nothing about the
 * weeks between deploys and nothing at all about a setting that comes back on a
 * re-provision. This is the same question asked at runtime.
 *
 * It is a MEASURED FACT, not an operator switch, so it lives here with a status
 * getter rather than in flags.ts — the shape maintenance.ts uses.
 *
 * Fail-safe direction: unreachable, unparseable or not yet checked all read as
 * 'unverified', never as 'closed'. A posture check that fails into "looks fine"
 * is the thing this file exists to stop.
 */

import { env } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';

export type DoorState = 'open' | 'closed' | 'unverified';

export interface AdmissionPosture {
	/** The Supabase project's own signup setting. */
	anonSignup: DoorState;
	/** Whether /api/auth/signup has a PIN to ask for. */
	routePin: 'set' | 'unset';
	/** True when either door admits anyone. */
	open: boolean;
	checkedAt: string | null;
	/** Why anonSignup is 'unverified', when it is. */
	note: string | null;
}

/** How long a probe result is trusted before another is allowed. */
const TTL_MS = 5 * 60 * 1000;

const state: { anonSignup: DoorState; checkedAt: number; note: string | null; inFlight: Promise<void> | null } = {
	anonSignup: 'unverified',
	checkedAt: 0,
	note: 'not checked yet',
	inFlight: null
};

function pinSet(): boolean {
	return Boolean((env.ADMIN_PIN ?? process.env.ADMIN_PIN ?? '').trim());
}

/** Synchronous read. Never probes; call refreshAdmission() to update it. */
export function admissionStatus(): AdmissionPosture {
	const routePin = pinSet() ? 'set' : 'unset';
	return {
		anonSignup: state.anonSignup,
		routePin,
		// 'unverified' is NOT counted as open — it is counted as unknown, and the
		// caller is told so. Only a measured 'open' or a missing PIN is a finding.
		open: state.anonSignup === 'open' || routePin === 'unset',
		checkedAt: state.checkedAt ? new Date(state.checkedAt).toISOString() : null,
		note: state.note
	};
}

/**
 * Ask GoTrue whether it still accepts public signups. One unauthenticated GET
 * with the anon key; at most one in flight; at most one per TTL. Never throws —
 * a failure downgrades to 'unverified' and says why.
 */
export async function refreshAdmission(force = false): Promise<AdmissionPosture> {
	if (!force && Date.now() - state.checkedAt < TTL_MS) return admissionStatus();
	if (state.inFlight) {
		await state.inFlight;
		return admissionStatus();
	}
	state.inFlight = (async () => {
		const url = (publicEnv.PUBLIC_SUPABASE_URL ?? '').replace(/\/+$/, '');
		const anon = publicEnv.PUBLIC_SUPABASE_ANON_KEY ?? '';
		if (!url || !anon) {
			state.anonSignup = 'unverified';
			state.note = 'PUBLIC_SUPABASE_URL / ANON_KEY not readable here';
			state.checkedAt = Date.now();
			return;
		}
		try {
			const res = await fetch(`${url}/auth/v1/settings`, {
				headers: { apikey: anon },
				signal: AbortSignal.timeout(8000)
			});
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const body = (await res.json()) as { disable_signup?: unknown };
			if (typeof body.disable_signup !== 'boolean') {
				state.anonSignup = 'unverified';
				state.note = 'auth settings did not report disable_signup';
			} else {
				state.anonSignup = body.disable_signup ? 'closed' : 'open';
				state.note = null;
			}
		} catch (e) {
			state.anonSignup = 'unverified';
			state.note = `could not reach the auth service (${(e as Error).message})`;
		} finally {
			state.checkedAt = Date.now();
		}
	})();
	try {
		await state.inFlight;
	} finally {
		state.inFlight = null;
	}
	return admissionStatus();
}

/**
 * One coarse word for the PUBLIC health endpoint.
 *
 * /api/health is unauthenticated, so it must not publish which door is open —
 * that would hand a passer-by the finding. 'review' says an operator has
 * something to look at; the Admin Console says what.
 */
export function admissionSummary(): 'ok' | 'review' | 'unverified' {
	const p = admissionStatus();
	if (p.open) return 'review';
	if (p.anonSignup === 'unverified') return 'unverified';
	return 'ok';
}

/** Reset for tests. */
export function _resetAdmissionForTests(): void {
	state.anonSignup = 'unverified';
	state.checkedAt = 0;
	state.note = 'not checked yet';
	state.inFlight = null;
}
