/**
 * Turns domain objects into the preview rows ConfirmDialog renders.
 *
 * The point of the preview is that "Delete 3 posts?" tells you nothing, while
 * three thumbnails and captions tell you exactly what you are about to lose.
 * That was the actual failure: the per-card trash can deleted permanently with
 * no confirmation and no way to see what went.
 */
import { getPostDisplay } from '$lib/components/feed/postDisplay';
import { thumbUrl } from '$lib/image-url';
import { confirmAction, type ConfirmPreviewItem } from '$lib/stores/confirm.svelte';

const STATUS_BADGE: Record<string, string> = {
	published: 'Live',
	publishing: 'Publishing',
	scheduled: 'Scheduled',
	partial: 'Partly live',
	failed: 'Failed',
	generating: 'Generating',
	draft: 'Draft',
	rejected: 'Rejected'
};

/**
 * The pages that delete posts each hold a different shape, and the dialog is
 * called from all of them:
 *
 *   raw DB row     — { content: '<json>', agents: {...}, scheduled_date }
 *   calendar       — { text: '<json>', agentName, date, time }  (+page.server maps it)
 *   review queue   — { text: '<caption>', media_url, poster_url, agent_name }
 *
 * Rather than make every caller convert, normalise here. Calendar and the raw
 * row both carry the un-parsed content blob, so they go through the shared
 * classifier; the review item is already flattened and is used as-is.
 */
function normalize(post: any): {
	caption: string;
	image: string | null;
	agentName: string | null;
	gradient: string | null;
	initial: string | null;
	title: string | null;
} {
	const blob = post?.content ?? post?.text;
	const looksLikeContent =
		blob && typeof blob === 'object'
			? true
			: typeof blob === 'string' && blob.trim().startsWith('{');

	if (looksLikeContent) {
		const display = getPostDisplay({ ...post, content: blob });
		return {
			caption: (display.text || '').trim().replace(/\s+/g, ' '),
			image: display.mediaType === 'video' ? display.posterUrl : display.mediaUrl,
			agentName: post?.agents?.name ?? post?.agentName ?? post?.agent_name ?? null,
			gradient: post?.agents?.gradient ?? post?.gradient ?? null,
			initial: post?.agents?.initial ?? null,
			title: display.templateTitle
		};
	}

	// Already-flattened (review queue). A video's mp4 must never end up as an
	// <img> src, so fall back to its poster and accept no thumbnail otherwise.
	const isVideo = post?.media_type === 'video';
	return {
		caption: String(post?.text ?? '')
			.trim()
			.replace(/\s+/g, ' '),
		image: isVideo ? (post?.poster_url ?? null) : (post?.media_url ?? post?.poster_url ?? null),
		agentName: post?.agent_name ?? post?.agentName ?? null,
		gradient: post?.gradient ?? null,
		initial: null,
		title: post?.template_title ?? null
	};
}

/** Human date for a post's slot — "Mon 3 Sep, 14:30" — or null when unscheduled. */
function slotLabel(post: any): string | null {
	const date = post?.scheduled_date ?? post?.date ?? null;
	if (!date) return null;
	const time = String(post?.scheduled_time ?? post?.time ?? '').slice(0, 5);
	const d = new Date(`${date}T${time || '00:00'}`);
	if (Number.isNaN(d.getTime())) return String(date);
	const shown = d.toLocaleDateString(undefined, {
		weekday: 'short',
		day: 'numeric',
		month: 'short'
	});
	return time ? `${shown}, ${time}` : shown;
}

/** One post → one preview row. Videos show their poster, never a blank tile. */
export function postPreview(post: any): ConfirmPreviewItem {
	const { caption, image, agentName, gradient, initial, title } = normalize(post);

	return {
		// 76px = the 38px thumb at 2x.
		image: image ? (thumbUrl(image, 76) ?? null) : null,
		gradient,
		initial: initial || agentName?.charAt(0) || null,
		label: caption ? truncate(caption, 64) : title || 'Untitled post',
		meta: [agentName, slotLabel(post)].filter(Boolean).join(' · ') || null,
		badge: STATUS_BADGE[post?.status] ?? null
	};
}

export function postPreviews(posts: any[]): ConfirmPreviewItem[] {
	return posts.map(postPreview);
}

/**
 * How many of these posts are live on a platform right now. Deleting one of
 * those is the case worth spelling out — it comes down off the platforms whose
 * API allows it, and restoring from Trash brings back the record, not the live
 * post.
 */
export function countLive(posts: any[]): number {
	return posts.filter((p) => p?.status === 'published' || p?.status === 'partial').length;
}

function truncate(value: string, max: number): string {
	return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/**
 * The one confirmation every post delete goes through — persona feed, calendar,
 * review queue, drawer, bulk bar. Having it here is the point: the copy used to
 * differ per page ("cannot be undone" on three of them, nothing at all on the
 * per-card trash can), and only one of those was even true.
 *
 * Returns false on cancel, so it drops in as
 * `if (!(await confirmDeletePosts(posts))) return;`
 */
export async function confirmDeletePosts(posts: any[]): Promise<boolean> {
	const n = posts.length;
	if (n === 0) return false;
	const live = countLive(posts);

	return confirmAction({
		title: n === 1 ? 'Move this post to Trash?' : `Move ${n} posts to Trash?`,
		body:
			n === 1
				? 'It leaves your feed and calendar but stays restorable from Trash for 30 days.'
				: 'They leave your feed and calendar but stay restorable from Trash for 30 days.',
		// Only warn about the part that genuinely cannot be undone.
		warning:
			live > 0
				? `${
						live === n ? (n === 1 ? 'This post is' : 'They are') : `${live} of them are`
					} live right now. Taking it down from the platforms happens immediately and is NOT ` +
					'undone by restoring — restore brings back the record, not the live post.'
				: undefined,
		preview: postPreviews(posts),
		confirmLabel: n === 1 ? 'Move to Trash' : `Move ${n} to Trash`,
		tone: live > 0 ? 'danger' : 'caution'
	});
}

/** Restoring is not destructive — neutral tone, no scare copy. */
export async function confirmRestorePosts(posts: any[]): Promise<boolean> {
	const n = posts.length;
	if (n === 0) return false;
	return confirmAction({
		title: n === 1 ? 'Restore this post?' : `Restore ${n} posts?`,
		body:
			'It goes back to your feed and calendar. Anything whose scheduled slot has ' +
			'already passed comes back as a draft, so nothing publishes by surprise.',
		preview: postPreviews(posts),
		confirmLabel: 'Restore',
		tone: 'neutral'
	});
}

/** Permanent. This is the one that earns a type-to-confirm. */
export async function confirmPurgePosts(posts: any[], all = false): Promise<boolean> {
	const n = posts.length;
	if (n === 0) return false;
	return confirmAction({
		title: all
			? 'Empty the Trash?'
			: n === 1
				? 'Delete this post forever?'
				: `Delete ${n} posts forever?`,
		body:
			'This is the permanent one. The post and its generation history are removed ' +
			'from the database and cannot be recovered by anyone, including support.',
		warning: 'There is no undo for this.',
		preview: postPreviews(posts),
		confirmLabel: all ? 'Empty Trash' : 'Delete forever',
		tone: 'danger',
		typeToConfirm: all ? 'empty trash' : null
	});
}
