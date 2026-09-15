#!/usr/bin/env node
// Prepares a login for the EXISTING `verify@personagen.test` fixture account.
//
// Why this instead of seeding a tenant: the audit needs a session, not data
// ownership. This account already exists, owns zero personas / posts / briefs /
// connections, and last signed in on 2026-07-22. Setting a password on it
// touches one auth row, creates nothing, and cannot affect any real user's
// content. Credentials are written to .ux-audit/ (gitignored) and never logged.
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { pg, q, SB, KEY, appRoot } from './sql.mjs';

const EMAIL = 'verify-kit-69a88f@personagen.test';
const svc = createClient(SB, KEY, { auth: { autoRefreshToken: false, persistSession: false } });

const rows = await pg(`select id, email from auth.users where email = ${q(EMAIL)}`);
if (!rows?.length) { console.error(`${EMAIL} does not exist — refusing to create it`); process.exit(1); }
const user = rows[0];

// Refuse if it has acquired content since this was written.
const owned = await pg(`select
  (select count(*) from agents where user_id = ${q(user.id)}) personas,
  (select count(*) from posts where user_id = ${q(user.id)}) posts,
  (select count(*) from brand_briefs where user_id = ${q(user.id)}) briefs`);
const o = owned[0];
if (Number(o.personas) + Number(o.posts) + Number(o.briefs) > 0) {
  console.error(`${EMAIL} now owns content (${JSON.stringify(o)}) — refusing to touch it`);
  process.exit(1);
}

const password = `Ux!${randomBytes(12).toString('base64url')}`;
const { error } = await svc.auth.admin.updateUserById(user.id, { password, email_confirm: true });
if (error) { console.error('password set failed:', error.message); process.exit(1); }

mkdirSync(join(appRoot, '.ux-audit'), { recursive: true });
writeFileSync(
  join(appRoot, '.ux-audit', 'accounts.json'),
  JSON.stringify({ createdAt: new Date().toISOString(), accounts: { fixture: { email: EMAIL, password, id: user.id, label: 'Existing empty fixture account', seat: null } } }, null, 2)
);
console.log(`ready: ${EMAIL} (owns nothing) → .ux-audit/accounts.json`);
