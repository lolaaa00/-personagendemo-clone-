import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'http://127.0.0.1:54321';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!serviceRoleKey) {
	console.error('Error: SUPABASE_SERVICE_ROLE_KEY environment variable is not set!');
	process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
	auth: {
		autoRefreshToken: false,
		persistSession: false
	}
});

async function run() {
	console.log('Fetching users from local Supabase...');
	try {
		const {
			data: { users },
			error
		} = await supabase.auth.admin.listUsers();
		if (error) {
			console.error('Error listing users:', error);
			return;
		}
		console.log('Local Registered users:');
		users.forEach((u) => {
			console.log(`ID: ${u.id} | Email: ${u.email} | Created: ${u.created_at}`);
		});
	} catch (err) {
		console.error('Catch error:', err);
	}
}

run();
