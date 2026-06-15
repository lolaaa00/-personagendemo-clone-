import pg from 'pg';
const { Client } = pg;

async function run() {
	const hosts = ['l2g-supabase.zi1cc5.easypanel.host', 'localhost', '127.0.0.1'];
	const passwords = ['postgres_password_change_me', 'postgres'];

	for (const host of hosts) {
		for (const password of passwords) {
			console.log(`Trying host: ${host}, password: ${password}...`);
			const client = new Client({
				host,
				port: 5432,
				user: 'postgres',
				password,
				database: 'postgres',
				connectionTimeoutMillis: 5000
			});
			try {
				await client.connect();
				console.log(`SUCCESS connected to ${host}!`);
				await client.end();
				return;
			} catch (err) {
				console.log(`Failed for ${host}:`, err.message);
			}
		}
	}
}

run();
