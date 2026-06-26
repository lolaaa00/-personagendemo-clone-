import fs from 'fs';
import path from 'path';

function loadEnv() {
	const envPath = path.resolve('.env');
	const env = {};
	const envContent = fs.readFileSync(envPath, 'utf-8');
	envContent.split(/\r?\n/).forEach((line) => {
		const match = line.match(/^\s*([\w_]+)\s*=\s*(.*)\s*$/);
		if (!match) return;
		let value = match[2].trim();
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		}
		env[match[1]] = value;
	});
	return env;
}

const loadedEnv = loadEnv();
const supabaseUrl = loadedEnv.PUBLIC_SUPABASE_URL;
const serviceRoleKey = loadedEnv.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
	throw new Error('Missing PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
}

const migrationSql = fs.readFileSync(
	path.resolve('supabase/connections_provider_metadata_migration.sql'),
	'utf-8'
);

const response = await fetch(`${supabaseUrl}/pg/query`, {
	method: 'POST',
	headers: {
		apikey: serviceRoleKey,
		Authorization: `Bearer ${serviceRoleKey}`,
		'Content-Type': 'application/json'
	},
	body: JSON.stringify({ query: migrationSql })
});

const responseText = await response.text();
console.log('Status:', response.status);
console.log(responseText.replaceAll(serviceRoleKey, '[redacted]'));

if (!response.ok) {
	process.exit(1);
}
