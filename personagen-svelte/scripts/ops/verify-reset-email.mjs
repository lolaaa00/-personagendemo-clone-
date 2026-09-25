// Proves password-reset email delivery end to end after SMTP is configured on GoTrue.
//
//   node --env-file=.env scripts/ops/verify-reset-email.mjs <recipient> [--resend-key re_...]
//
// 1. Asks GoTrue to send a recovery email to <recipient> (a REAL inbox you can read —
//    GoTrue only mails addresses that exist as users, so the recipient must be a user).
// 2. If a Resend API key is given, polls Resend's /emails list for that recipient and
//    prints the delivery status ("delivered" / "bounced" / …) so nobody has to eyeball
//    an inbox to know it worked.
// Nothing is written to the app database; GoTrue's own recovery flow is what runs.
const [recipient, ...rest] = process.argv.slice(2);
const flag = (n) => { const i = rest.indexOf(n); return i >= 0 ? rest[i + 1] : undefined; };
const RESEND = flag('--resend-key') || process.env.RESEND_API_KEY;
const URL = (process.env.PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
const ANON = process.env.PUBLIC_SUPABASE_ANON_KEY || '';
if (!recipient || !URL || !ANON) {
	console.error('usage: node --env-file=.env scripts/ops/verify-reset-email.mjs <recipient> [--resend-key re_...]');
	process.exit(2);
}
const t0 = Date.now();
const r = await fetch(`${URL}/auth/v1/recover`, {
	method: 'POST',
	headers: { apikey: ANON, 'Content-Type': 'application/json' },
	body: JSON.stringify({ email: recipient })
});
const text = await r.text();
console.log(`GoTrue /recover → ${r.status} ${text.slice(0, 200) || '(empty body = accepted)'}`);
if (r.status >= 400) {
	console.error('GoTrue refused to send. "Error sending recovery email" means SMTP is still not configured or the SMTP login failed; check the supabase service env and its logs.');
	process.exit(1);
}
if (!RESEND) {
	console.log('No Resend key given — check the inbox for the email (from GOTRUE_SMTP_ADMIN_EMAIL, subject "Reset Your Password").');
	process.exit(0);
}
for (let i = 0; i < 12; i++) {
	await new Promise((res) => setTimeout(res, 5000));
	const list = await fetch('https://api.resend.com/emails?limit=20', { headers: { Authorization: `Bearer ${RESEND}` } });
	if (!list.ok) { console.error(`Resend /emails → ${list.status}`); break; }
	const { data = [] } = await list.json();
	const hit = data.find((e) => (e.to || []).includes(recipient) && new Date(e.created_at).getTime() >= t0 - 60000);
	if (hit) {
		console.log(`Resend: id=${hit.id} status=${hit.last_event} from=${hit.from} subject="${hit.subject}" at ${hit.created_at}`);
		process.exit(/delivered|sent/.test(hit.last_event) ? 0 : 1);
	}
	console.log(`… not in Resend's list yet (${(i + 1) * 5}s)`);
}
console.error('The email never reached Resend: GoTrue accepted the request but did not hand it to SMTP. Check GOTRUE_SMTP_* on the supabase service and its logs.');
process.exit(1);
