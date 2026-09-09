import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createDbService } from '$lib/server/db';
import { checkAgentAccess } from '$lib/server/workspaces';
import { getServiceSupabase } from '$lib/server/service-supabase';
import { persistBufferToStorage, deleteFromStorage } from '$lib/server/storage';
import { videoIngestEnabled } from '$lib/server/flags';
import {
	hasFfprobe,
	probeVideo,
	clipExtForMime,
	clipRejectionReason,
	MAX_CLIP_BYTES,
	MAX_CLIP_SECONDS,
	MIN_CLIP_SECONDS
} from '$lib/server/video';

/**
 * Accepts the SOURCE CLIP for a video-to-video run: the user's own footage,
 * which fal's animate models re-perform as this persona (see the 'reel-remake'
 * and 'motion-transfer' formats). Stores it in the durable bucket and hands
 * back its measured length.
 *
 * SYNCHRONOUS, unlike generate-avatar's detached job — and deliberately so.
 * Nothing here is generation; it is a probe and an upload, seconds not minutes.
 * More to the point, the response IS the answer the composer is waiting for:
 * these models bill per output SECOND, so without `durationSec` the caller
 * cannot quote the run, and a 202 with a promise of a duration later would put
 * a price on screen that nothing had measured. The route finishes before it
 * replies.
 *
 * The bounds and the verdict live in $lib/server/video (MAX_CLIP_BYTES,
 * MAX_CLIP_SECONDS, MIN_CLIP_SECONDS, clipRejectionReason) beside the probe
 * that produces the numbers they judge, and are unit-tested there.
 *
 * Two gates sit in front of the upload and answer different questions:
 * `video_ingest` (flags.ts) is the operator's decision that this deployment
 * MAY take third-party footage at all, and the `attest` field is the
 * uploader's assertion that THIS clip is theirs to use. Neither is inferable
 * from the other, so neither has a default.
 */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	const { session, user } = await locals.safeGetSession();
	if (!session || !user) {
		return json({ success: false, error: 'Unauthorized' }, { status: 401 });
	}

	const agentId = params.agentId;
	if (!agentId) {
		return json({ success: false, error: 'Missing agentId' }, { status: 400 });
	}

	const db = createDbService(locals.supabase);
	const { data: agent, error: agentErr } = await db.agents.get(agentId);
	if (agentErr || !agent) {
		return json(
			{ success: false, error: 'Persona not found or ownership mismatch' },
			{ status: 404 }
		);
	}
	const access = await checkAgentAccess(locals.supabase, user.id, agentId, 'creator');
	if (!access.ok) {
		return json({ success: false, error: access.message }, { status: access.status });
	}

	// The operator switch, checked before the host probe and stated as a
	// DIFFERENT condition: 403 (this deployment does not do this) rather than
	// 503 (this deployment cannot do this). Read the other way round, an
	// operator's deliberate refusal would look like an outage worth paging
	// someone about, and installing ffprobe would look like the fix.
	if (!videoIngestEnabled()) {
		return json(
			{
				success: false,
				error:
					'Source clips are turned off for this account. Ask your administrator to enable video-to-video.',
				code: 'VIDEO_INGEST_DISABLED'
			},
			{ status: 403 }
		);
	}

	// The server half of the `videoIngest` host capability. Checked BEFORE the
	// body is drained: on a host without ffprobe every clip would be rejected as
	// unreadable, which reads to the user as "my file is broken" rather than
	// "this deployment can't do this". 503, because it is the host that is
	// missing something, not the request.
	if (!(await hasFfprobe())) {
		return json(
			{
				success: false,
				error:
					'This server cannot accept source clips — the video tools (ffprobe) are not installed on the host.'
			},
			{ status: 503 }
		);
	}

	let svc: ReturnType<typeof getServiceSupabase>;
	try {
		svc = getServiceSupabase();
	} catch {
		return json(
			{ success: false, error: 'Storage service is not configured on this server.' },
			{ status: 500 }
		);
	}

	const contentType = request.headers.get('content-type') || '';
	if (!contentType.includes('multipart/form-data')) {
		return json(
			{ success: false, error: 'Upload the clip as multipart/form-data.' },
			{ status: 400 }
		);
	}

	const form = await request.formData();
	const file = form.get('clip');
	if (!(file instanceof File)) {
		return json({ success: false, error: 'Missing clip file.' }, { status: 400 });
	}

	// The uploader's assertion that this clip is theirs to use, taken from the
	// form and never inferred. Absent, blank or anything other than an explicit
	// affirmative is a refusal: a checkbox that arrives missing when the user
	// never ticked it is exactly the case this has to catch, so "not sent" can
	// only mean no. 422 — the request is well-formed, the assertion it needs is
	// not there.
	const attest = String(form.get('attest') ?? '')
		.trim()
		.toLowerCase();
	if (!(attest === 'true' || attest === 'on' || attest === '1' || attest === 'yes')) {
		return json(
			{
				success: false,
				error: 'Confirm you have the right to use this clip before uploading it.',
				code: 'ATTESTATION_REQUIRED'
			},
			{ status: 422 }
		);
	}

	// Type and DECLARED size first: both are known from the part header, so a
	// wrong-format or oversized upload is refused without buffering it. The size
	// is re-checked against the real byte count below — `file.size` is whatever
	// the multipart parser measured, and the buffer is what we would store.
	if (!clipExtForMime(file.type)) {
		return json(
			{
				success: false,
				error: 'That file type is not supported. Upload an MP4, MOV or WebM clip.'
			},
			{ status: 400 }
		);
	}
	if (file.size > MAX_CLIP_BYTES) {
		return json(
			{
				success: false,
				error: `That clip is too large (max ${Math.round(MAX_CLIP_BYTES / (1024 * 1024))}MB).`
			},
			{ status: 400 }
		);
	}

	// Drain the upload now — the request body is gone once we respond, and the
	// probe needs the bytes on disk.
	const buffer = Buffer.from(await file.arrayBuffer());
	const ext = clipExtForMime(file.type) as string;

	// The measurement the quote is built on. probeVideo never throws; a null is
	// an UNMEASURED clip, and an unmeasured clip is not stored — see the reason
	// text, and probeVideo's own note on why null is fatal here and harmless
	// everywhere else in that module.
	const probe = await probeVideo(buffer);

	const rejection = clipRejectionReason(buffer.length, file.type, probe);
	if (rejection || !probe) {
		return json(
			{ success: false, error: rejection ?? 'Could not read that video file.' },
			{ status: 400 }
		);
	}

	let url: string;
	try {
		url = await persistBufferToStorage(svc, buffer, user.id, ext, file.type.split(';')[0].trim());
	} catch (e) {
		console.error('[source-clip] Failed to store source clip:', e);
		return json(
			{ success: false, error: 'Could not store that clip. Try again.' },
			{ status: 500 }
		);
	}

	// The attestation, recorded against the clip that was actually stored — WHO
	// (user_id + workspace + persona), WHEN, and WHICH object. Written after the
	// upload, because an assertion about a clip that was never stored has nothing
	// to be about.
	//
	// It goes to `source_clip_attestations`, NOT the activity log. That store is
	// gated by ACTIVITY_LOG and every emitter is a no-op while it is off, so the
	// route would have taken the assertion, dropped it, and kept the clip anyway.
	// A consent record that exists only when an observability flag happens to be
	// on is not a consent record.
	//
	// The bucket PATH rather than the public URL: URLs expire and rotate, the path
	// still identifies the object later, which is the only time this row matters.
	const clipPath = url.split('/object/public/')[1] ?? '';
	const { error: attestErr } = await svc.from('source_clip_attestations').insert({
		user_id: user.id,
		workspace_id: agent.workspace_id ?? null,
		agent_id: agentId,
		clip_path: clipPath,
		mime: file.type.split(';')[0].trim(),
		bytes: buffer.length,
		duration_sec: probe.durationSec,
		statement: 'source-clip-rights-v1',
		request_id: locals.requestId ?? null
	});

	if (attestErr) {
		// FAIL CLOSED. The clip is already in the bucket, so leaving it addressable
		// would mean third-party footage held with no record of anyone claiming the
		// right to use it — the exact state this endpoint exists to prevent. Refuse
		// the upload and tell the caller, rather than returning a URL the pipeline
		// would happily go on to re-perform.
		console.error('[source-clip] attestation write failed — refusing the clip:', attestErr.message);
		await deleteFromStorage(svc, url);
		return json(
			{
				success: false,
				error:
					'Could not record the rights confirmation for that clip, so it was not kept. Try again.',
				code: 'ATTESTATION_NOT_RECORDED'
			},
			{ status: 503 }
		);
	}

	// durationSec is the contract: the caller multiplies it by the model's
	// per-second price to quote the run, so it is returned as MEASURED, never
	// rounded to a whole second here — rounding is the quote's decision, and
	// doing it twice is how a quote drifts from the invoice.
	return json({
		success: true,
		url,
		durationSec: probe.durationSec,
		width: probe.width,
		height: probe.height,
		limits: { maxSeconds: MAX_CLIP_SECONDS, minSeconds: MIN_CLIP_SECONDS, maxBytes: MAX_CLIP_BYTES }
	});
};
