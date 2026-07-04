#!/usr/bin/env node
/**
 * PreToolUse hook: hard gate on Blotato MCP publish calls.
 *
 * Enforces (harness-level, not model-promised):
 *   1. accountId must be in .claude/blotato-allowlist.json
 *   2. mediaUrls must be non-empty and https
 *   3. text must be non-empty
 *   4. Optional strict mode: text+mediaUrls must match an entry in the
 *      allowlist's approvedPayloads (byte-exact courier discipline).
 *
 * Wire-up (merge into .claude/settings.json — see blotato-rig/README):
 *   PreToolUse matcher "mcp__blotato__*" → command: node .claude/hooks/validate-blotato-publish.mjs
 *
 * Exit 0 = allow, exit 2 = block (stderr is shown to the model).
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ALLOWLIST_PATH = resolve(here, '..', 'blotato-allowlist.json');

function block(msg) {
	console.error(`[blotato-gate] BLOCKED: ${msg}`);
	process.exit(2);
}

let input = '';
process.stdin.on('data', (d) => (input += d));
process.stdin.on('end', () => {
	let call;
	try {
		call = JSON.parse(input);
	} catch {
		block('unparseable hook input');
	}

	const toolName = call.tool_name || '';
	const args = call.tool_input || {};

	// Only police publish-shaped tools; listing/reading tools pass through.
	if (!/publish|create.*post|post.*create|schedule/i.test(toolName)) {
		process.exit(0);
	}

	let allow;
	try {
		allow = JSON.parse(readFileSync(ALLOWLIST_PATH, 'utf8'));
	} catch {
		block(`allowlist missing/unreadable at ${ALLOWLIST_PATH} — refusing to publish without policy`);
	}

	// Blotato MCP arg shapes vary; probe the common nestings.
	const post = args.post || args;
	const content = post.content || post;
	const accountId = String(post.accountId ?? content.accountId ?? '');
	const text = String(content.text ?? '');
	const mediaUrls = content.mediaUrls || post.mediaUrls || [];

	if (!accountId) block('no accountId in publish call');
	if (!Array.isArray(allow.accountIds) || !allow.accountIds.includes(accountId)) {
		block(`accountId "${accountId}" is not in the approved allowlist`);
	}
	if (!text.trim()) block('empty caption/text');
	if (!Array.isArray(mediaUrls) || mediaUrls.length === 0) block('no mediaUrls');
	for (const u of mediaUrls) {
		if (typeof u !== 'string' || !u.startsWith('https://')) block(`non-https media URL: ${u}`);
	}

	// Strict courier mode: payload must byte-match an approved draft.
	if (allow.strict) {
		const match = (allow.approvedPayloads || []).some(
			(p) =>
				p.text === text &&
				Array.isArray(p.mediaUrls) &&
				p.mediaUrls.length === mediaUrls.length &&
				p.mediaUrls.every((u, i) => u === mediaUrls[i])
		);
		if (!match) block('payload does not byte-match any approved draft (strict mode)');
	}

	process.exit(0);
});
