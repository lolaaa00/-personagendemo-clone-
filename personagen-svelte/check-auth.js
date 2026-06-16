import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.PUBLIC_SUPABASE_URL;
if (!supabaseUrl) {
	console.error('Error: PUBLIC_SUPABASE_URL environment variable is not set!');
	process.exit(1);
}
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
	const {
		data: { users },
		error
	} = await supabase.auth.admin.listUsers();
	if (error) {
		console.error('Error listing users:', error);
		return;
	}
	console.log(
		'Registered users:',
		users.map((u) => ({ id: u.id, email: u.email, created_at: u.created_at }))
	);
}

run();
