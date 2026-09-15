// READ-ONLY introspection of the live Supabase instance. Prints counts only.
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const env = Object.fromEntries(
  readFileSync('.env', 'utf8').split(/\r?\n/).filter(l => l && !l.startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)]; })
);
const svc = createClient(env.PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

const { data: users, error: uErr } = await svc.auth.admin.listUsers({ page: 1, perPage: 200 });
if (uErr) { console.log('listUsers error:', uErr.message); }
const list = users?.users ?? [];
console.log('auth users:', list.length);
for (const u of list) {
  const mask = u.email ? u.email.replace(/^(.{2})[^@]*/, '$1***') : '(none)';
  console.log(`  ${mask}  created=${(u.created_at||'').slice(0,10)}  confirmed=${!!u.email_confirmed_at}  meta=${JSON.stringify(u.app_metadata?.role ?? u.app_metadata ?? {}).slice(0,60)}`);
}

const tables = ['workspaces','workspace_members','workspace_invites','platform_admins','agents','posts','brand_briefs','credit_ledger','wallets','plan_catalog','model_registry','persona_groups','feature_requests','user_api_keys','connections','activity_events'];
for (const t of tables) {
  const { count, error } = await svc.from(t).select('*', { count: 'exact', head: true });
  console.log(`${t.padEnd(20)} ${error ? 'ERR ' + error.message.slice(0, 60) : count}`);
}
