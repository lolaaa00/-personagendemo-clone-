import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'http://127.0.0.1:54321';
const serviceRoleKey =
	'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyAgCiAgICAicm9sZSI6ICJzZXJ2aWNlX3JvbGUiLAogICAgImlzcyI6ICJzdXBhYmFzZS1kZW1vIiwKICAgICJpYXQiOiAxNjQxNzY5MjAwLAogICAgImV4cCI6IDE3OTk1MzU2MDAKfQ.DaYlNEoUrrEn2Ig7tqibS-PHK5vgusbcbo7X36XVt4Q';

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
