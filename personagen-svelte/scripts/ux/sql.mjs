// Thin SQL helper for the UX audit tooling. Service-role; use read-only unless seeding.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
export const appRoot = resolve(here, '..', '..');
export const env = { ...process.env };
const envPath = join(appRoot, '.env');
if (existsSync(envPath)) {
	for (const line of readFileSync(envPath, 'utf8').split('\n')) {
		const m = line.match(/^\s*([\w_]+)\s*=\s*(.*)\s*$/);
		if (!m) continue;
		let v = m[2].trim();
		if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
		if (!(m[1] in process.env)) env[m[1]] = v;
	}
}
export const SB = (env.PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
export const KEY = env.SUPABASE_SERVICE_ROLE_KEY || '';
export const ANON = env.PUBLIC_SUPABASE_ANON_KEY || '';
export async function pg(query) {
	const r = await fetch(`${SB}/pg/query`, {
		method: 'POST',
		headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({ query })
	});
	const t = await r.text();
	if (!r.ok) throw new Error(`pg/query ${r.status}: ${t.slice(0, 400)}`);
	try { return JSON.parse(t); } catch { return t; }
}
export const q = (s) => (s === null || s === undefined ? 'null' : `'${String(s).replace(/'/g, "''")}'`);
