export const meta = {
	name: 'blotato-publish-queue',
	description: 'Deterministically publish approved PersonaGen posts via the Blotato MCP',
	whenToUse:
		'When approved posts need publishing through the Blotato MCP connector as an exact-payload courier (trial validation or interactive ops).',
	phases: [
		{ title: 'Publish', detail: 'one courier agent per approved post, exact payload' },
		{ title: 'Verify', detail: 'confirm each post exists on Blotato' }
	]
};

// args: { posts: [{ postId, accountId, platform, text, mediaUrls: [..], pageId? }] }
// The payloads come from PersonaGen's review queue (already human-approved).
// This script adds ZERO creative latitude: each agent is ordered to call the
// Blotato publish tool with exactly one payload and report the raw result.
// The PreToolUse hook (.claude/hooks/validate-blotato-publish.mjs) hard-blocks
// any call that drifts from the allowlist.

const posts = Array.isArray(args?.posts) ? args.posts : [];
if (posts.length === 0) {
	return { error: 'No posts provided. Pass args.posts = [{ postId, accountId, platform, text, mediaUrls }].' };
}
if (posts.length > 25) {
	return { error: `Refusing ${posts.length} posts (max 25/run — Blotato rate limit is 30/min).` };
}

const PUBLISH_SCHEMA = {
	type: 'object',
	properties: {
		ok: { type: 'boolean' },
		externalId: { type: 'string' },
		error: { type: 'string' }
	},
	required: ['ok']
};

const VERIFY_SCHEMA = {
	type: 'object',
	properties: {
		found: { type: 'boolean' },
		detail: { type: 'string' }
	},
	required: ['found']
};

const results = await pipeline(
	posts,
	(p) =>
		agent(
			`You are a deterministic publishing courier. Use ToolSearch to load the Blotato MCP publish tool (query "+blotato publish post"), then call it EXACTLY ONCE with EXACTLY this payload — do not rewrite, trim, augment, or "improve" any field:

accountId: ${JSON.stringify(p.accountId)}
platform: ${JSON.stringify(p.platform)}
text: ${JSON.stringify(p.text)}
mediaUrls: ${JSON.stringify(p.mediaUrls)}
${p.pageId ? `pageId: ${JSON.stringify(p.pageId)}` : ''}

If the tool call is blocked or errors, DO NOT retry with modified arguments — report the failure verbatim. Return { ok, externalId?, error? }.`,
			{ label: `publish:${p.postId}`, phase: 'Publish', schema: PUBLISH_SCHEMA }
		),
	(pub, p) =>
		pub && pub.ok
			? agent(
					`Verify via the Blotato MCP (load list/get tools with ToolSearch) that a post exists for account ${p.accountId}${pub.externalId ? ` with id ${pub.externalId}` : ''} matching this caption prefix: ${JSON.stringify((p.text || '').slice(0, 60))}. Read-only — make no publish calls. Return { found, detail }.`,
					{ label: `verify:${p.postId}`, phase: 'Verify', schema: VERIFY_SCHEMA }
				).then((v) => ({ postId: p.postId, published: true, verified: !!v?.found, externalId: pub.externalId ?? null, detail: v?.detail ?? null }))
			: { postId: p.postId, published: false, verified: false, error: pub?.error ?? 'courier agent returned nothing' }
);

const flat = results.filter(Boolean);
log(`${flat.filter((r) => r.published).length}/${posts.length} published, ${flat.filter((r) => r.verified).length} verified`);
return { results: flat };
