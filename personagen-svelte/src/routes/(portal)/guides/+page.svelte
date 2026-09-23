<script lang="ts">
	import { goto, afterNavigate } from '$app/navigation';
	import { onMount, tick } from 'svelte';
	import { syncParam } from '$lib/url-state';
	import {
		CHANGELOG,
		CHANGE_GROUPS,
		type ChangeGroup,
		type ChangeCategory
	} from '$lib/changelog';
	import { ROADMAP, ROADMAP_STATUSES } from '$lib/roadmap';
	import { confirmAction } from '$lib/stores/confirm.svelte';
	import { DEMOS, ShotFigure, type DemoId } from '$lib/components/docs';

	// ── Guide catalog ────────────────────────────────────────────────────────
	// Screenshots are imported through Vite's asset pipeline so every capture
	// gets a CONTENT-HASHED immutable URL — a changed image is a changed URL,
	// which makes stale browser/edge caches structurally impossible.
	const SHOT_URLS = import.meta.glob('$lib/assets/guide-shots/*.png', {
		eager: true,
		query: '?url',
		import: 'default'
	}) as Record<string, string>;
	function shotUrl(name: string): string {
		for (const [path, url] of Object.entries(SHOT_URLS)) {
			if (path.endsWith(`/${name}.png`)) return url;
		}
		return '';
	}

	// Static, code-defined how-tos with real app screenshots (src/lib/assets/guide-shots,
	// captured against the monarchstackteam account so every image shows the real
	// workspace users see in these docs). Every step names the REAL buttons and
	// tabs as they appear in the app; screenshots are re-captured with Playwright
	// when the UI changes. This page is user documentation, not marketing.
	interface Step {
		t: string;
		img?: string; // filename (no extension) in /guide-shots/
		alt?: string;
		/** One line under the screenshot, when the step text alone does not say what to look at. */
		caption?: string;
		/**
		 * The captures are full pages; a step is usually about ONE region of one.
		 * focus = which point (0–100 %) stays centred, zoom = how far to magnify it.
		 * Unset = the whole capture, top-aligned.
		 */
		focus?: { x: number; y: number };
		zoom?: number;
		/** A LIVE miniature of the UI instead of a picture — see $lib/components/docs. */
		demo?: DemoId;
	}
	interface Guide {
		id: string;
		category: string;
		title: string;
		when: string; // "you need this when…" — symptom-first, in the user's words
		steps: Step[];
		tip?: string;
		/** Quick facts — the 3-4 elementary answers someone came for, endpoint-style. */
		facts?: string[];
	}

	// ── Providers ────────────────────────────────────────────────────────────
	// A second axis over the same guides. Someone with an OpenRouter problem
	// does not think in "Keys & credits" vs "Fixing problems" — they think
	// "OpenRouter". The dropdown in the index narrows every category to the
	// guides that touch one provider; a guide can touch several.
	type ProviderId = 'openrouter' | 'zernio' | 'fal' | 'gemini' | 'firecrawl';
	const PROVIDERS: Array<{ id: ProviderId; label: string; role: string }> = [
		{ id: 'openrouter', label: 'OpenRouter', role: 'writing — captions, scripts, ideas' },
		{ id: 'zernio', label: 'Zernio', role: 'publishing — connected accounts, posting' },
		{ id: 'fal', label: 'Fal AI', role: 'media — images, video, voice' },
		{ id: 'gemini', label: 'Gemini', role: 'writing — the alternative to OpenRouter' },
		{ id: 'firecrawl', label: 'Firecrawl', role: 'brand reading — Scrape & Populate' }
	];
	const GUIDE_PROVIDERS: Record<string, ProviderId[]> = {
		'openrouter-key': ['openrouter'],
		'which-key-pays': ['openrouter', 'fal', 'gemini'],
		'zernio-key': ['zernio'],
		'all-keys': ['openrouter', 'zernio', 'fal', 'gemini', 'firecrawl'],
		'zernio-billing': ['zernio'],
		'brand-brief': ['firecrawl'],
		glossary: ['openrouter', 'fal'],
		'generate-post': ['openrouter', 'fal'],
		'composer-costs': ['openrouter', 'fal'],
		'studio-templates': ['fal'],
		'reference-kit': ['fal'],
		voice: ['fal'],
		'identity-kit': ['openrouter', 'gemini'],
		'connect-account': ['zernio'],
		'schedule-autonomy': ['zernio'],
		'confirm-live': ['zernio'],
		reschedule: ['zernio'],
		'delete-live': ['zernio'],
		'model-manager': ['fal', 'openrouter'],
		'intel-wizard': ['openrouter', 'firecrawl'],
		'generation-failing': ['openrouter', 'fal', 'gemini'],
		'publish-failing': ['zernio']
	};
	const providersOf = (g: Guide): ProviderId[] => GUIDE_PROVIDERS[g.id] ?? [];

	const CATEGORIES = [
		'Getting started',
		'Keys & credits',
		'Creating content',
		'Publishing',
		'Library & organization',
		'Power tools',
		'Fixing problems'
	] as const;

	const GUIDES: Guide[] = [
		// ── Getting started ──────────────────────────────────────────────────
		{
			id: 'getting-around',
			category: 'Getting started',
			title: 'Find your way around',
			when: 'You’re new, or you can’t find a page you saw before.',
			facts: [
				'Sidebar groups: Network · Library · Publish · Setup · Personas',
				'Home base is the Dashboard',
				'Moon button (top right) switches dark / light',
				'Lost? Setup → Docs + the search box',
			],
			steps: [
				{
					t: 'Everything lives in the left sidebar, in five groups: Network (Dashboard) · Library (All Generations, My Favorites, Trash) · Personas (every persona you have + New Persona) · Publish (Review Queue, Calendar) · Setup (Brand Brief, Docs, Developer API, Billing, Settings). Model Manager also appears under Setup if your account administers the platform.',
					demo: 'sidebar-map'
				},
				{
					t: 'The Dashboard is your home base: persona health, engagement charts, and quick actions.',
					img: 'dashboard',
					alt: 'The Dashboard page with KPIs and the persona roster',
					caption: 'The Dashboard — KPIs across the top, the persona roster below.'
				},
				{ t: 'The moon/sun button in the top-right switches dark and light mode. Your name next to it opens the menu with Log Out.' },
				{ t: 'Stuck anywhere? Come back to this Docs page (Setup → Docs): Guides for how-tos, Changelog for what changed, Roadmap for what is coming.' }
			]
		},
		{
			// The composer makes people choose between words the rest of the product
			// never defines — spokesperson vs b-roll is the FIRST question a new user
			// is asked, and nothing else in the app explains either one. This is the
			// page they land on when they don't know what they're picking, so every
			// entry is one or two sentences in the user's language, not the model's.
			id: 'glossary',
			category: 'Getting started',
			title: 'What the words mean (glossary)',
			when: 'The app asks you to pick between spokesperson and b-roll, or shows a status you don’t recognise, and you want the one-line answer.',
			facts: [
				'Persona = the character · Brand Brief = the brand',
				'Spokesperson talks · b-roll doesn’t',
				'Cinematic = the multi-shot premium format',
				'Draft → Scheduled → Published is the post’s life',
			],
			steps: [
				{ t: 'Persona — one AI character: a face, a voice, a personality and its own social accounts. Everything in the app hangs off a persona; they live under Personas in the sidebar.' },
				{ t: 'Brand Brief — what your brand is, in one place (Setup → Brand Brief): products and photos, visual identity, voice and tone, audience, competitors. Every persona you point at a brief writes from it, so one fix there changes every future post.' },
				{ t: 'Platform Identity Kit — the persona’s public profile, per platform: display name, username candidates and a bio, ready to paste into Instagram or TikTok when you set the account up. It is text, not pictures.' },
				{ t: 'Reference Kit — the staged set of images of the persona’s face and body (character sheet, full body, side profiles, close-up, feature grid). Every future image and video is generated against these, which is what keeps the same face across posts.' },
				{ t: 'Pinned face — the reference image the persona is currently using. Leaving the composer’s character field blank does not mean "no face": the pinned face is sent anyway, which is why your persona still looks like themselves.' },
				{ t: 'Spokesperson — a video where the persona speaks to camera: their voice, lip-synced, talking head. Pick it when the words are the point (a review, a tip, an announcement).' },
				{ t: 'B-roll — a silent video with no talking: product motion, hands, lifestyle shots. No voiceover, so the caption carries the message. Pick it when the product is the point, or when you want something that works with the sound off.' },
				{ t: 'Cinematic — the premium multi-shot format: several scenes cut together instead of one clip. It costs the most and takes the longest, so save it for hero content.' },
				{ t: 'Text card — a still that is pure typography: your line IS the artwork, no photo, no face, no product. The card itself is typeset on our servers for nothing; the only cost is the writing step that comes up with the line, which is a fraction of a cent.' },
				{
					t: 'Every format is a short list of stages, and each stage bills a different key — or nothing. Pick one below to see exactly what runs.',
					demo: 'format-explorer'
				},
				{ t: 'Draft — generated and waiting for you. Nothing has been published and nothing goes out until you approve it in the Review Queue.' },
				{ t: 'Scheduled — approved, with a date and time. It publishes itself when that moment arrives; you can still move or cancel it from the Calendar.' },
				{ t: 'Published — live on every account it was aimed at. Partly published — live on some of them and failed on the rest, usually because one account needs re-linking; open the post to see which platform missed.' }
			],
			tip: 'The two you’ll be asked about most: spokesperson if you want the persona to say something, b-roll if you want the product to show something.'
		},
		{
			id: 'daily-routine',
			category: 'Getting started',
			title: 'The 5-minute daily routine',
			when: 'Every day. This is the whole job once your personas are set up.',
			facts: [
				'Where: Review Queue',
				'Takes about 5 minutes',
				'Approve = it posts · Reject = free redo',
				'Nothing posts without your OK in Semi mode',
			],
			steps: [
				{
					t: 'Open Review Queue in the left sidebar — your personas’ new drafts are waiting there.',
					img: 'review-queue',
					alt: 'The Review Queue page'
				},
				{ t: 'For each draft: read the caption, look at the image or play the video.' },
				{ t: 'Approve the good ones. Use the caption’s edit control to reword it first if you want — what you write is exactly what gets published.' },
				{ t: 'Reject the misses and pick a reason ("Bad caption", "Off-brand look"…). Rejecting is free — the persona makes a replacement, and your reasons teach it your taste.' },
				{
					t: 'Glance at Calendar to see when approved posts go out. Done.',
					img: 'calendar',
					alt: 'The Content Calendar in month view'
				}
			],
			tip: 'Nothing ever posts without your approval while a persona is in Semi-Autonomous mode (the default).'
		},
		{
			id: 'brand-brief',
			category: 'Getting started',
			title: 'Fix your brand voice in one place',
			when: 'Captions feel off-brand, or a product is missing / has no photo.',
			facts: [
				'Where: Setup → Brand Brief',
				'One fix here fixes every future post',
				'Every product needs a photo',
				'Saves apply to new drafts immediately',
			],
			steps: [
				{
					t: 'Open Brand Brief (sidebar → Setup). Tabs across the top cover Overview · Products & UGC · Visual Identity · Voice & Tone · Target Audience · Competitors.',
					img: 'brand-brief',
					alt: 'The Brand Brief page with its tabs'
				},
				{ t: 'On Overview you can paste your store URL into the scraper card and click Scrape & Populate — it fills the brief from your website.' },
				{ t: 'Read what’s written: this is what your personas believe about your brand. Edit anything that’s off. One fix here changes every future post from every persona.' },
				{ t: 'Most fields have Generate and Spin buttons — Spin offers numbered variations; click one to apply it.' },
				{ t: 'Check Products & UGC: every product needs a photo — that’s what personas hold and show on camera.' },
				{ t: 'Click Save (top right). New drafts use the corrected version immediately.' }
			]
		},
		{
			id: 'meet-creators',
			category: 'Getting started',
			title: 'Tour a persona’s page',
			when: 'You want to understand what a persona is and what each tab does.',
			facts: [
				'Three tabs: Profile · Content · Studio',
				'Profile = who they are',
				'Content = everything they made',
				'Studio = one-click templates',
			],
			steps: [
				{
					t: 'Pick a persona under Personas in the sidebar. The top shows their identity, stats, and a ♥ to favorite them. Three tabs below: Profile · Content · Studio.',
					img: 'persona-profile',
					alt: 'A persona page open on the Profile tab'
				},
				{ t: 'Profile tab — who they are: Brand Brief, Persona Profile, Platform Identity Kit, Character & Visuals (picture + Reference Kit), Automation (schedule, voice, autonomy), and Spend. A toggle at the top switches to the Connections view (their linked social accounts).' },
				{
					t: 'Content tab — everything they’ve made, with a Posts | Assets | Calendar switch, filters, and the composer to make something new.',
					img: 'persona-content',
					alt: 'The Content tab with the post grid'
				},
				{
					t: 'Studio tab — ready-made post templates that pre-fill the composer.',
					img: 'studio',
					alt: 'The Studio tab template gallery'
				}
			]
		},
		{
			id: 'docs-hub',
			category: 'Getting started',
			title: 'Use this Docs page (guides, changelog, roadmap)',
			when: 'You want to know how something works, what changed, or what is coming next.',
			facts: [
				'Where: sidebar → Setup → Docs',
				'Four tabs across the top',
				'Guides = how-tos · Changelog = what changed',
				'Roadmap = what is next · User Voice = your requests',
			],
			steps: [
				{ t: 'Guides (this tab) — step-by-step how-tos for every feature, with real screenshots. Pick a guide on the left; each one opens with Quick facts (the short answer) before the numbered steps.' },
				{ t: 'Changelog — every change ever made to PersonaGen, newest first, grouped by month. It is generated from the project’s real development history, so it can never drift from what actually shipped. Tick “Major changes only” to see just the big ones, or search for a feature by name.' },
				{ t: 'Roadmap — three columns: In progress, Planned, and Exploring. This is what the team is building next; nothing here is a promise with a date, it is an honest ordering.' },
				{ t: 'User Voice — request a feature and vote on everyone else’s. See the “Request a feature” guide for how voting works.' },
				{ t: 'Every tab has its own web address, so you can bookmark or share a direct link (for example the Changelog tab, or one specific guide).' }
			],
			tip: 'Searching only looks inside the tab you are on — the Guides search finds how-tos, the Changelog search finds changes.'
		},
		{
			id: 'user-voice',
			category: 'Getting started',
			title: 'Request a feature & vote (User Voice)',
			when: 'PersonaGen is missing something you need, or you want to back someone else’s idea.',
			facts: [
				'Where: Docs → User Voice',
				'Upvote what you want built',
				'Anyone can add a request',
				'The team sets each request’s status',
			],
			steps: [
				{ t: 'Open Docs (sidebar → Setup) and click the User Voice tab. Requests are sorted by score, so the most-wanted ideas sit at the top.' },
				{ t: 'Vote with the ▲ and ▼ buttons on the left of each request. Click the same arrow again to take your vote back. One vote per person per request.' },
				{ t: 'To add your own: click “+ Request a feature”, write one clear sentence as the title, and add detail about the problem it solves. Your request starts with your own upvote.' },
				{ t: 'Each request carries a status: Under review → Planned → In progress → Shipped (or Declined). Switch to the Board view to see everything sorted into those columns at a glance.' },
				{ t: 'Requests you wrote are marked “yours” and can be deleted by you. Only the team can change a status — so scores stay honest.' }
			],
			tip: 'Detail beats volume: a request that explains when you last needed the feature is far more likely to get built than one that just names it.'
		},
		{
			id: 'new-persona',
			category: 'Getting started',
			title: 'Create a new persona',
			when: 'You want another persona for a different audience or product line.',
			facts: [
				'Where: sidebar → New Persona',
				'3 steps: Identity → Persona → Review',
				'The Vault offers 3 ready-made options',
				'Next: Reference Kit, then connect an account',
			],
			steps: [
				{
					t: 'Click New Persona in the sidebar (the dashed + button). A 3-step wizard opens: Identity → Persona → Review.',
					img: 'generator',
					alt: 'The Create a Persona wizard on step 1'
				},
				{ t: 'Step 1 — Identity: pick your brand brief, optionally type a direction ("busy mom, gentle humor"), and click Generate persona for this brand. Or open the Vault to get 3 ready-made options and pick one.' },
				{ t: 'Step 2 — Persona: review and tweak the personality, voice, content skills, and audience fields.' },
				{ t: 'Step 3 — Review & Create: check the summary and click Create Persona.' },
				{ t: 'The new persona appears in the sidebar. Next: give them a face (Reference Kit guide) and connect an account when ready.' }
			]
		},

		// ── Keys & credits ───────────────────────────────────────────────────
		{
			// Rewritten 2026-09-22. This used to walk the customer through creating an
			// OpenRouter key and saving it, closing with a promise that their own key
			// would be charged instead of the wallet. Customer BYOK was withdrawn for
			// every generation provider
			// on 2026-09-21, so those steps now describe a field that no longer
			// exists and a rule that no longer holds. The TRIGGER is unchanged — a
			// 402 still happens — so the guide keeps its place and answers what to
			// actually do about it.
			id: 'openrouter-key',
			category: 'Keys & credits',
			title: 'Generation stopped: "out of credits"',
			when: 'Content generation fails with "ran out of credits", "402", or "insufficient credits". Writing captions and scripts costs a little on every format, so when the balance behind your account runs out, generation stops.',
			facts: [
				'Fixes: “ran out of credits” / “402” errors',
				'There is no key for you to add — generation runs on our keys',
				'A text post costs only its writing — a few cents; the Studio shows the exact price in your currency',
				'If the persona belongs to a workspace, the OWNER’s wallet is the one that pays'
			],
			steps: [
				{ t: 'Look at the balance pill in the sidebar: it names the wallet that pays for what you are generating. If that is a workspace you hold a seat in, the wallet is the workspace owner’s — only the owner can top it up, so ask them. Your own balance is not the one in play.' },
				{ t: 'If the wallet is yours — your own account, or a workspace you own — open Billing. While card payments are switched off, press “Ask us to load” on a pack: the request reaches us privately, and we load it by hand.' },
				{ t: 'Retry whatever failed — generate a post or approve a draft. Nothing is lost by a failed attempt.' }
			],
			tip: 'You do not need a provider account of your own. Generation runs on our keys and is charged to your balance, so every post is priced the same way.'
		},
		{
			// Rewritten 2026-09-22. This used to answer "your wallet or your own key?" —
			// a question with two answers only while customers could bring keys for
			// generation providers. That was withdrawn: a key you bring is an IDENTITY
			// (Zernio, your own social accounts), never a COST. The live question, and
			// the one people do get wrong, is WHICH wallet: a persona that belongs to a
			// workspace bills that workspace's owner, not the person generating.
			id: 'which-key-pays',
			category: 'Keys & credits',
			title: 'Which wallet pays for a generation?',
			when: 'The balance in the sidebar is not moving after you generate — or it is moving and you did not expect it to be your money.',
			facts: [
				'Every generation runs on our provider accounts and bills a wallet',
				'A persona in a workspace bills that workspace OWNER, not you',
				'The pill shows the wallet that will actually be charged, and names it',
				'Zernio is the one key you bring — it publishes, it never generates'
			],
			steps: [
				{ t: 'There is one place money comes from: a Credits wallet. Images, video, voice and every word written for a post run on our provider accounts, and the wallet is debited at the rate the composer quotes before you confirm.' },
				{ t: 'WHICH wallet depends on the persona, not on you. A persona that belongs to a workspace bills that workspace owner’s wallet. A persona of your own, outside any workspace, bills yours.' },
				{ t: 'That is why a seat in someone else’s workspace can generate all day and watch their personal balance sit still: it was never the balance in play. The sidebar names the workspace whenever the wallet on screen belongs to its owner.' },
				{
					t: 'See it for yourself: move the persona between a workspace and your own account, and watch who is charged for each stage.',
					demo: 'key-routing'
				},
				{ t: 'Bringing your own OpenRouter, Gemini, Fal or Firecrawl key no longer changes any of this. Customer keys for generation were withdrawn — they gave away margin and split one bill in two with no rule a customer could see. A key still saved from before is inert.' },
				{ t: 'Zernio is the exception and stays: it connects your own social accounts for publishing, Zernio bills you per connected account per month, and it never changes what a generation costs.' }
			],
			tip: 'The common mistake is topping up your own wallet while generating for a workspace persona. If the sidebar names a workspace you are a seat in, only its owner can top it up — your own balance will not be touched.'
		},
		{
			// Rewritten 2026-09-22 to match Settings and the product owner's rule:
			// the Zernio key is the CUSTOMER'S to create. This guide used to say
			// "provisioned on our side — ask us" while Settings said "yours to
			// create", and a client re-audit filed the contradiction.
			id: 'zernio-key',
			category: 'Keys & credits',
			title: 'Get publishing working (the Zernio key)',
			when: 'Settings shows Zernio as “Not set”, or connecting a social account says there is no publishing key. Nothing can publish until this is in place.',
			facts: [
				'Zernio connects your social accounts and sends posts to them',
				'The key is yours to create — free, with Google sign-in at zernio.com',
				'The free account includes 2 connected accounts',
				'Workspace members publish through the workspace owner’s key'
			],
			steps: [
				{ t: 'Zernio is the publishing layer: it holds the connection to each social account and sends approved posts to them. Without a key, generation still works but nothing can go live.' },
				{ t: 'Go to zernio.com and sign in with Google. There is no card to enter — the free account includes 2 connected accounts.' },
				{ t: 'In Zernio, open your API keys and create one. Copy it — it is shown once.' },
				{ t: 'Back here: Settings → Provider API Keys → the Zernio card. Paste the key, press Save Key, then Test Connection. The badge turns Valid.' },
				{ t: 'Member of someone else’s workspace? You do not need a key of your own for that workspace’s personas — they publish through the owner’s Zernio key. You only need your own for personas outside the workspace.' },
				{ t: 'Then connect accounts: open a persona → Connections → Connect. See the “Connect a social account” guide for the walk-through.' },
				{ t: 'Running several brands? Each Zernio key is its own account with 2 free connected-account slots. Settings → Zernio Key Manager lets you add more keys and assign personas to them.' }
			],
			tip: 'Zernio is billed per connected account (first 2 free), not per post — so a key sitting unused costs nothing.'
		},
		{
			// Rewritten 2026-09-22: customer keys for generation were withdrawn on
			// 2026-09-21. This guide still said "Saving a key here changes who
			// pays" and "either OpenRouter or Gemini is enough" — instructions for
			// fields that no longer exist.
			id: 'all-keys',
			category: 'Keys & credits',
			title: 'What each provider does',
			when: 'You’re looking at Provider API Keys in Settings and wondering what’s what.',
			facts: [
				'Zernio = publishing — the one key you bring',
				'Images, video, voice, writing and research run on our keys',
				'All of it is charged to your balance, priced before you spend',
				'Nothing here needs a key of yours except Zernio'
			],
			steps: [
				{ t: 'Open Settings → Provider API Keys (left menu inside Settings). The Zernio card is the only one with a field — it is your publishing connection, and it is yours.' },
				{ t: 'Zernio — publishing. Connects social accounts and sends approved posts to them. Without it, nothing publishes. See the Zernio guide to create yours.' },
				{ t: 'Fal AI — pictures, video and voice. Runs on our key.' },
				{ t: 'OpenRouter and Gemini — writing: captions, scripts, ideas. Run on our keys.' },
				{ t: 'Firecrawl — brand reading. Powers “Scrape & Populate” in the Brand Brief. Runs on our key.' },
				{ t: 'Everything that runs on our keys is charged to your balance — the sidebar pill shows which wallet pays. If generation stops with “out of credits”, see the out-of-credits guide.' },
				{ t: 'Settings also has a Zernio Key Manager section: add extra Zernio keys (each is its own account with its own 2 free slots) and assign specific personas to them.' }
			],
			tip: 'A Zernio card with a red status shows the reason right there — fix it on the card rather than guessing.'
		},
		{
			id: 'zernio-billing',
			category: 'Keys & credits',
			title: 'Understand publishing billing (per connected account)',
			when: 'You’re deciding how many social accounts to connect.',
			facts: [
				'Billed per connected account, not per post',
				'First 2 accounts on a key are free',
				'After that: about $6 per account per month',
				'Disconnecting stops the charge immediately',
			],
			steps: [
				{ t: 'Publishing is billed per connected social account, metered daily — not per post.' },
				{ t: 'Your first 2 connected accounts on a key are free; beyond that it’s about $6/account/month (cheaper at volume).' },
				{
					t: 'The Connections view (persona’s Profile tab → Connections toggle) shows a live meter of what your connected accounts cost.',
					img: 'connections',
					alt: 'The Connections view with the account meter'
				},
				{ t: 'Want more free slots? Add another Zernio key in Settings → Zernio Key Manager and assign some personas to it.' },
				{ t: 'Disconnecting an account stops its charge immediately — and its posting.' }
			]
		},

		// ── Creating content ─────────────────────────────────────────────────
		{
			id: 'generate-post',
			category: 'Creating content',
			title: 'Generate a post right now',
			when: 'You don’t want to wait for the schedule — you want a post on demand.',
			facts: [
				'Button: Content tab → Generate Now',
				'Nothing is spent until you approve',
				'Images take 1–2 min · video a few minutes',
				'The result lands as a Draft',
			],
			steps: [
				{
					t: 'Open the persona’s page → Content tab, and click Generate Now. (The Calendar page’s Generate Post Now button works too.)',
					img: 'persona-content',
					alt: 'The Content tab with the Generate Now button'
				},
				{
					t: 'The composer opens. Nothing is spent until you approve: review the topic, pick Image / Video, and check the price preview at the bottom ("What builds it?" with the price of each step).',
					img: 'composer',
					alt: 'The generation composer with the cost preview'
				},
				{ t: 'Click Approve & generate. It runs in the background with progress shown — a minute or two for images, a few minutes for video.' },
				{ t: 'The finished post appears as a Draft. Edit the caption if you like, then approve it like any other draft.' }
			],
			tip: 'Video posts come with the persona’s own voice and sound. Cinematic is the premium multi-scene format — best for hero content.'
		},
		{
			// The Director is the only paid stage of a card format. When the user
			// brings the words there is nothing to write and nothing to grade, so a
			// batch of a hundred runs with no model at all — the route that makes
			// them (/api/agent/[id]/cards) cannot reach a provider even by fallback.
			id: 'own-words-cards',
			category: 'Creating content',
			title: 'Make cards from your own quotes (free, up to 100 at once)',
			when: 'You already have the lines — quotes, tips, a numbered list — and want them as cards without paying for the Director, or you want a month of text posts in one sitting.',
			facts: [
				'Pick Text card or Motion text card, then Words → “My own words — free”',
				'One quote per line; a blank line separates quotes that need their own line breaks',
				'Up to 100 cards per batch — no model runs, so nothing is charged',
				'Every card lands as a draft in the Review Queue; nothing publishes by itself',
			],
			steps: [
				{ t: 'Open the composer for a persona (Generate a post, or a Studio template on the Text card shelf) and choose Text card — or Motion text card for the same card put in motion.' },
				{ t: 'In the Look step, switch Words from “The Director writes it” to “My own words — free”. The single card-text box becomes a quote box.' },
				{ t: 'Paste your quotes: one per line. A quote that needs its own line breaks (a list, a myth/fact pair) goes as its own block with a blank line before and after. The counter shows how many cards that makes — up to 100.' },
				{ t: 'Choose the look across the set: Matching set (one palette, each line takes the layout that fits it), Same look (one palette and one layout — a uniform grid), or Every card different. Layout and Palette below apply to every card.' },
				{ t: 'Notice the Craft step is gone: with the Director and the quality gate skipped there is nothing left to choose a model for, and the quote reads free. Pick a format below and toggle “I bring the words” to see why.', demo: 'format-explorer' },
				{ t: 'Approve — the button reads “Create N cards — free”. The cards appear in the feed as each one is typeset (a few seconds each) and every one lands as a draft in the Review Queue.' },
				{ t: 'A quote the card font cannot draw (emoji, non-Latin script) is flagged before you send and skipped if you send it anyway; the rest of the batch still runs.' }
			],
			tip: 'The receipt on each card says $0 and names the typesetter, not a model — and “My own words” is the one place in the product where the wallet is never touched at all.'
		},
		{
			id: 'composer-costs',
			category: 'Creating content',
			title: 'The composer: approve exactly what you spend',
			when: 'You want control over what a generation costs and what gets sent to the AI.',
			facts: [
				'Opens before every post generation',
				'Shows the exact prompt and the price you will be charged',
				'Cancel costs nothing',
				'Platforms + schedule are set right here',
			],
			steps: [
				{
					t: 'Every post generation opens this composer first — nothing is spent until you click Approve & generate. (Generate drafts, the campaign planner and the identity-kit buttons spend without it — each of those shows its price and wallet on the button or its confirm.)',
					img: 'composer',
					alt: 'The generation composer'
				},
				{ t: 'Pick a format. Each one shows its price; one you cannot use says why on the tile — for example “Cinematic — needs a product photo” until a product in your Brand Brief has one.' },
				{ t: '"Prompt sent to the model" shows the exact text the AI receives — edit it if you want something specific.' },
				{
					t: '"What builds it?" lists each step with its model and its price in your currency, plus the total and whose wallet pays it. The total is the exact charge; each step is rounded to the cent, so in a converted currency the steps can differ from the total by a cent.',
					img: 'composer-costs',
					alt: 'The composer scrolled to the What builds it? cost breakdown'
				},
				{ t: 'Two optional switches: Burn on-screen captions (subtitles baked into the video) and the "AI GENERATED" disclosure badge.' },
				{ t: '"Publish to" chips choose which connected accounts the post targets; you can also set a schedule date and time right here.' },
				{ t: 'Not happy? Cancel costs nothing.' }
			]
		},
		{
			id: 'studio-templates',
			category: 'Creating content',
			title: 'Use Studio templates',
			when: 'You want proven post formats without writing a prompt.',
			facts: [
				'Where: persona page → Studio tab',
				'Ready-made formats in 4 categories',
				'Output switch: Review draft or Asset only',
				'Templates pre-fill the composer for you',
			],
			steps: [
				{
					t: 'Open the persona’s page → Studio tab. Dozens of ready-made templates — This Saved Me, Before & After, Unboxing Reveal, TV Spot, and more — on the Text, Photo, Video and Cinematic shelves, each priced before you click.',
					img: 'studio',
					alt: 'The Studio template gallery'
				},
				{ t: 'The Output switch at the top decides where results go: "Review draft" (into your Review Queue — default) or "Asset only" (straight to Content → Assets, skipping review).' },
				{ t: 'Click Use template — it pre-fills the composer with that template’s structure.' },
				{ t: 'Adjust anything, check the cost preview, and Approve & generate.' },
				{ t: 'Templates you’ve used show a "Used" badge with a thumbnail of your last result.' }
			]
		},
		{
			id: 'reference-kit',
			category: 'Creating content',
			title: 'Keep a persona’s face consistent (Reference Kit)',
			when: 'A persona’s kit tiles are empty, or their look varies between posts.',
			facts: [
				'Where: Profile tab → Character & Visuals',
				'⚡ Generate all remaining builds the whole kit',
				'A real photo upload works too',
				'Every stage keeps history — Restore anytime',
			],
			steps: [
				{
					t: 'Open the persona’s page → Profile tab → Character & Visuals section.',
					img: 'reference-kit',
					alt: 'The Reference Kit section with its staged tiles'
				},
				{ t: 'Click ⚡ Generate all remaining. The kit builds in order — character sheet, full body, side profiles, close-up, feature grid. A minute or two per tile, in the background.' },
				{ t: 'Prefer a real face? Use the upload button on the Profile Picture, or Generate Character Sheet From This Photo.' },
				{ t: 'Every stage keeps history: the Restore button opens a picker ("This stage" / "All images") so you can go back to any earlier version.' },
				{ t: 'Done — every future image and video uses these to keep the same face.' }
			]
		},
		{
			id: 'voice',
			category: 'Creating content',
			title: 'Choose a persona’s voice',
			when: 'You want to hear or change how a persona sounds in videos.',
			facts: [
				'Where: Profile tab → Automation',
				'The preview button plays the voice out loud',
				'No two personas sound alike',
				'Save Profile applies it to new videos',
			],
			steps: [
				{ t: 'Open the persona’s page → Profile tab → Automation section.' },
				{ t: 'The UGC Voice dropdown lists the catalog; press the preview button to hear the current one.' },
				{ t: 'Pick a different voice if it doesn’t fit — voices are matched to the persona, and no two personas sound alike.' },
				{ t: 'Save Profile. New videos use the new voice.' }
			]
		},
		{
			id: 'identity-kit',
			category: 'Creating content',
			title: 'Generate bios & usernames (Platform Identity Kit)',
			when: 'You’re setting up a persona’s social profiles and want ready-to-paste bios and handle ideas.',
			facts: [
				'Where: Profile tab → Platform Identity Kit',
				'Writes names, usernames, and bios',
				'Copy-paste on purpose — platform rules',
				'Autosaves as you type',
			],
			steps: [
				{ t: 'Open the persona’s page → Profile tab → Platform Identity Kit section.' },
				{ t: 'Click Generate starter kit — it writes a display name, a profile-picture suggestion, username candidates, and a bio.' },
				{ t: 'Username Candidates: copy any, mark ones that are taken, or click Use to set your pick. Add your own ideas too.' },
				{ t: 'Bios are per platform — pick the platform, then Generate/Regenerate that platform’s bio. Copy-paste into the real account.' },
				{ t: 'Everything autosaves ("Saving… → Saved") as you go.' }
			],
			tip: 'Bios and usernames are copy-paste on purpose — platforms don’t allow apps to change them for you.'
		},

		// ── Publishing ───────────────────────────────────────────────────────
		{
			id: 'connect-account',
			category: 'Publishing',
			title: 'Connect a social account',
			when: 'A persona’s approved posts should start going to a real account.',
			facts: [
				'Where: Profile tab → Connections toggle',
				'13 platforms supported',
				'A normal social login — nothing technical',
				'A Reconnect badge fixes broken links in one click',
			],
			steps: [
				{
					t: 'Open the persona’s page → Profile tab → switch the toggle from Profile to Connections.',
					img: 'connections',
					alt: 'The Connections view of a persona'
				},
				{ t: 'Click + Connect on the platform (Instagram, TikTok, YouTube… 13 supported) and log in to the account in the window that opens — a normal social-media login, nothing technical.' },
				{ t: 'A green badge appears with the handle, follower count, and last sync. From now on, this persona’s approved posts publish there automatically.' },
				{ t: 'If a platform ever needs re-linking (password change, expired session), a Reconnect badge appears here — one click fixes it.' }
			],
			tip: 'You can approve drafts before connecting — they simply wait, and publish once an account exists.'
		},
		{
			id: 'schedule-autonomy',
			category: 'Publishing',
			title: 'Set the posting schedule & autonomy',
			when: 'You want to control how often and when a persona posts.',
			facts: [
				'Where: Profile tab → Automation',
				'Semi-Autonomous is the recommended mode',
				'Set the timezone to the audience\'s clock',
				'RSS mode turns articles into posts',
			],
			steps: [
				{ t: 'Open the persona’s page → Profile tab → Automation section.' },
				{ t: 'Set Posts Per Day and the Timezone — posts spread across the persona’s posting window on their local clock, so match it to the audience.' },
				{ t: 'Autonomy: Advisor = manual only · Semi-Autonomous = drafts wait for your approval (recommended) · Fully Autonomous = publishes unattended (the app asks you to confirm before switching).' },
				{ t: 'Content Source: Dynamic Generation (the AI invents on-brand topics) or RSS Auto-Repurpose (paste a feed URL and the persona turns articles into posts).' },
				{ t: 'Save Profile. The schedule starts filling from the next cycle.' }
			]
		},
		{
			id: 'confirm-live',
			category: 'Publishing',
			title: 'Confirm a post is really live',
			when: 'A post’s time has passed and you want proof it published.',
			facts: [
				'Publishing… = waiting for the platform',
				'Published = confirmed, with a real link',
				'Multi-platform posts list each result',
				'It never claims more than the platform confirmed',
			],
			steps: [
				{ t: 'Open the post (Calendar or the persona’s Content tab).' },
				{ t: 'For a minute or two it reads Publishing… — sent, waiting for the platform to confirm.' },
				{ t: 'When the platform confirms, it flips to Published with a View live post ↗ link — click it to open the actual post on the actual account.' },
				{ t: 'Multi-platform posts list each platform’s result separately in the post panel.' }
			],
			tip: 'PersonaGen never says Published until the platform itself confirms — the link always opens something real.'
		},
		{
			id: 'reschedule',
			category: 'Publishing',
			title: 'Move or edit a scheduled post',
			when: 'A post is queued for the wrong day or needs a caption change.',
			facts: [
				'Where: Calendar → click the post',
				'Captions stay editable until publish time',
				'The + on any day creates a post for that day',
			],
			steps: [
				{
					t: 'Open Calendar and click the post. Use ‹ › and the Day | Week | Month switch to find it; the Personas rail filters by persona.',
					img: 'calendar',
					alt: 'The Content Calendar'
				},
				{ t: 'In the post panel, change the date/time and hit Reschedule — or edit the caption (works right up to publish time).' },
				{ t: 'The little + on any day cell creates a post for that day; the New Post button writes one by hand.' }
			]
		},
		{
			id: 'delete-live',
			category: 'Publishing',
			title: 'Take down a published post',
			when: 'Something went out that you want removed.',
			facts: [
				'Delete always asks to confirm first',
				'Most platforms: removed automatically',
				'Instagram, TikTok and Snapchat: manual — the panel gives the link',
			],
			steps: [
				{ t: 'Open the post and click Delete (it asks "Confirm delete?").' },
				{ t: 'Platforms that allow removal by software are taken down automatically.' },
				{ t: 'Instagram, TikTok and Snapchat don’t allow apps to delete posts — for those the panel shows the direct link: open the post in that app → ⋯ → Delete. Ten seconds.' }
			]
		},

		// ── Library & organization ───────────────────────────────────────────
		{
			id: 'all-generations',
			category: 'Library & organization',
			title: 'Browse everything your personas made',
			when: 'You’re hunting for a specific image or video, across all personas.',
			facts: [
				'Where: Library → All Generations',
				'Two lenses: Content outputs · Profile assets',
				'Filters live in the page address — bookmarkable',
				'♥ on any card adds it to My Favorites',
			],
			steps: [
				{
					t: 'Open All Generations (sidebar → Library). Two lenses at the top: Content outputs (posts) and Profile assets (profile pictures + Reference Kit images — this is the only place those appear together).',
					img: 'generations',
					alt: 'The All Generations page'
				},
				{ t: 'Filter by persona, by media type (All / Images / Videos), or tap the ♥ toggle to see favorites only. Filters stay in the page address, so you can bookmark a view.' },
				{ t: 'Click any card to open it; from the panel you can Approve & Schedule a draft directly.' },
				{ t: 'The ♥ on each card adds it to My Favorites.' }
			]
		},
		{
			id: 'favorites',
			category: 'Library & organization',
			title: 'Save your favorites',
			when: 'You want your best posts and go-to personas one tap away.',
			facts: [
				'♥ works on posts and on personas',
				'Where: Library → My Favorites',
				'Two tabs: Posts · Personas',
				'Un-heart removes it on the spot',
			],
			steps: [
				{ t: 'Tap the ♥ on any post card (in a persona’s Content tab or All Generations) to favorite the post.' },
				{ t: 'Tap the ♥ next to a persona’s name at the top of their page to favorite the persona.' },
				{
					t: 'Open My Favorites (sidebar → Library): a Posts tab and a Personas tab hold everything you’ve hearted.',
					img: 'favorites',
					alt: 'The My Favorites page'
				},
				{ t: 'Un-hearting removes it from the list on the spot.' }
			]
		},
		{
			id: 'persona-projects',
			category: 'Library & organization',
			title: 'Organize personas into projects',
			when: 'You have many personas and the sidebar list is getting long.',
			facts: [
				'Folder icon sits next to the Personas label',
				'Projects become collapsible sidebar folders',
				'Deleting a project never deletes personas',
			],
			steps: [
				{
					t: 'Click the small folder icon next to the "Personas" label in the sidebar — it opens the Projects window.',
					img: 'projects-modal',
					alt: 'The Projects window for grouping personas'
				},
				{ t: 'Type a name ("Honey X", "Client B"…) and click Create.' },
				{ t: 'In the File personas list, use each persona’s dropdown to file it into a project.' },
				{ t: 'The sidebar reorganizes into collapsible project folders (plus Ungrouped). Rename or Delete projects anytime — deleting a project never deletes its personas.' }
			]
		},

		// ── Power tools ──────────────────────────────────────────────────────
		{
			id: 'review-power',
			category: 'Power tools',
			title: 'Review faster: views & keyboard',
			when: 'The queue is long and clicking every card feels slow.',
			facts: [
				'5 views: Table · Split · Deck · Board · Grid',
				'Keyboard: j k move · a approve · r reject',
				'The bulk bar handles many posts at once',
				'Board view lanes: Needs review · Scheduled · Rejected',
			],
			steps: [
				{
					t: 'The Review Queue has five views (buttons at the top): Table (bulk-first) · Split (list + preview) · Deck (one card at a time) · Board (pipeline lanes) · Grid. Your choice is remembered.',
					img: 'review-queue',
					alt: 'The Review Queue'
				},
				{ t: 'Keyboard triage in Table/Split/Deck: j / k move · a approve · r reject · o open · z zoom. Hands never leave the keyboard.' },
				{ t: 'Select several posts and use the bulk bar: Approve & Schedule (N), Reject (N), or Move to Trash (N).' },
				{ t: 'Board view lays the queue out as lanes — Needs review, Scheduled and Rejected — and you can drag a card between them: into Scheduled to approve it, into Rejected to reject it with a reason, or back into Needs review to restore it.' },
				{ t: 'Filters at the top narrow by persona, platform and status — the status list is Needs a decision (the default), Draft only, Scheduled only, and Rejected.' }
			]
		},
		{
			id: 'model-manager',
			category: 'Power tools',
			title: 'Model Manager: control quality & cost',
			when: 'You want to choose which AI models your personas use, or cut generation costs.',
			facts: [
				'Where: Setup → Model Manager (platform administrators only)',
				'Value ranking = quality ÷ price',
				'★ sets the default · Enabled shows it in the composer',
				'“Check for new models” scans new releases',
			],
			steps: [
				{
					t: 'If your account administers the platform, Model Manager appears in the sidebar under Setup — if it does not, this page is not open to your seat and the rest of this guide is background reading. Tabs split models by type: Image · Image Edit · Video · Voice.',
					img: 'models',
					alt: 'The Model Manager roster'
				},
				{ t: 'Your roster shows each model’s release age, price per call, latency, and a 1–10 quality score — with a Value ranking (quality ÷ price) and a BEST VALUE pill.' },
				{ t: 'The Enabled switch controls which models appear in the composer; the ★ star sets the default.' },
				{ t: 'Sort by "Best value" to find cheap-but-good; price and quality are editable inline if your experience differs. Filters narrow the list by provider, release age, or quality.' },
				{ t: '"Check for new models" scans for newly released models; discovered ones can be probed for compatibility before adoption.' },
				{ t: 'Found something better in the discovered list? Click Probe & build adapter (a quick compatibility check), then Choose a slot… and Swap in — a second click confirms, and the new model takes that slot everywhere it’s used. The old model stays in the roster, so you can always swap back.' }
			]
		},
		{
			id: 'intel-wizard',
			category: 'Power tools',
			title: 'Build a content plan',
			when: 'You want content pillars, a weekly posting schedule and a platform order, built from your brand brief.',
			facts: [
				'Where: Brand Brief → Content Plan',
				'6 steps, and it costs nothing — no model is called',
				'You get pillars, a weekly schedule and a platform order',
				'It reports no performance figures, because it measures nothing',
			],
			steps: [
				{
					t: 'Open Brand Brief and click Content Plan beside the tabs.',
					img: 'intel-wizard',
					alt: 'The Content Plan wizard'
				},
				{ t: 'Steps 1–4: confirm your brand & audience, add competitor URLs, paste any existing content, and tag audience interests. Each step says what it still needs before it will let you forward.' },
				{ t: 'Step 5: review the summary and click “Build my content plan”.' },
				{ t: 'Step 6: your plan — Content Pillars, a weekly schedule and a platform order, each citing the input it came from. It makes no claim about your reach: these are commitments, not predictions.' },
				{ t: 'The plan is saved onto the brief. Reopen it any time from Brand Brief → Content Plan without rebuilding.' }
			]
		},
		{
			id: 'restore-history',
			category: 'Power tools',
			title: 'Restore an older image',
			when: 'A regenerated profile picture or kit image was better before.',
			facts: [
				'Regenerating never loses the old image',
				'Restore lives on the picture and every kit stage',
				'Two tabs in the picker: This stage · All images',
			],
			steps: [
				{ t: 'Profile pictures and every Reference Kit stage keep full history — nothing is lost when you regenerate.' },
				{ t: 'On the persona’s Profile tab → Character & Visuals, click Restore on the profile picture or on any kit stage.' },
				{ t: 'The picker has two tabs: "This stage" (that image’s history) and "All images" (everything the persona has). Click the one you want back.' },
				{ t: 'Deleted images stay in your library too — restore works on them the same way.' }
			]
		},

		// ── Fixing problems ──────────────────────────────────────────────────
		{
			id: 'generation-failing',
			category: 'Fixing problems',
			title: 'Content generation keeps failing',
			when: 'Drafts error out, or the composer shows a failure message.',
			// Keyed to the sentences the product ACTUALLY shows (server/failure-text.ts
			// and the tile's summary). The old tree branched on "openrouter" / "402"
			// / "fal" — words the app never shows a customer — and told a 402 to top
			// up, when a provider 402 is on us (round-3 re-audit).
			facts: [
				'The tile and the post drawer show the cause in plain words',
				'“On us” / “paused on our side” → wait and retry; nothing was charged',
				'“Too low for this” (before a run starts) → top up, or ask the workspace owner',
				'Still failing? Open the post → Report this problem',
			],
			steps: [
				{ t: 'Open the failed post. The drawer says what happened, and whether anything was taken from your wallet.' },
				{ t: '"Paused on our side", "that’s on us", "key was rejected", or "is unavailable right now … not set up" → a problem with our provider account, not yours. Nothing was taken from your wallet. Try again in a little while.' },
				{ t: '"Rate-limiting us" → the provider is busy. Wait a few minutes, then Retry.' },
				{ t: '"Took too long and the run was stopped", "returned 503", or "interrupted" → a one-off; Retry usually works.' },
				{ t: '"Blocked by the model’s content policy" or a quality-check message → change the topic or scene, then Retry.' },
				{ t: 'Your wallet only stops a run BEFORE it starts: the composer says your balance is too low. Top up on Billing — or, for a workspace persona, ask its owner, because their wallet pays.' },
				{ t: 'Retried and it still fails? Open the post and press "Report this problem". It reaches us privately with the post attached.' }
			]
		},
		{
			id: 'publish-failing',
			category: 'Fixing problems',
			title: 'A post shows Failed instead of Published',
			when: 'A scheduled post didn’t go out.',
			facts: [
				'Open the post — the reason is written on it',
				'Most common fix: Reconnect the account',
				'Temporary failures retry themselves',
			],
			steps: [
				{ t: 'Open the post — the exact reason is written on it, per platform.' },
				{ t: 'Most common: the account needs re-linking. Persona’s Profile → Connections (a Manager seat or above) — reconnect the account there.' },
				{ t: 'Then open the post and use “Publish to a connected platform” to send it again to the platforms that failed. Posts that failed for a temporary reason (network hiccup) retry themselves automatically.' }
			],
			tip: 'A “Partly published” label on a multi-platform post means some platforms succeeded — only the listed ones failed. “Publish to a connected platform” sends it only to the connected platforms you pick; the ones it is already live on are shown but cannot be selected.'
		},
		{
			id: 'status-glossary',
			category: 'Fixing problems',
			title: 'What every label means',
			when: 'You see a label on a post and want to know if action is needed.',
			facts: [
				'Draft = needs you',
				'Scheduled = will post itself on time',
				'Failed = the reason is on the post',
				'Nothing fails silently',
			],
			steps: [
				{ t: 'The whole life of a post, on one line — click a label to see what it means and whether it needs you.', demo: 'post-lifecycle' },
				{ t: 'Generating — being created right now. Do nothing; it appears when ready.' },
				{ t: 'Draft — waiting for you in the Review Queue. Approve, edit, or reject.' },
				{ t: 'Scheduled — approved; goes out at its time slot. Nothing to do, or reschedule it.' },
				{ t: 'Publishing… — sent; waiting for the platform to confirm. Flips within minutes.' },
				{ t: 'Published — confirmed live; View live post opens the real thing.' },
				{ t: 'Partly published — landed on some platforms, not others; open it to see each reason.' },
				{ t: 'Failed — didn’t go out; the post shows exactly why. Fix that, then retry.' },
				{ t: 'Rejected — you said no in review; a new draft replaces it.' }
			],
			tip: 'One promise throughout: no label ever claims more than the platform has confirmed, and nothing fails silently.'
		}
	];

	// ── Quick fixes: symptom → guide, endpoint-style ─────────────────────────
	// One-tap answers for the situations users actually arrive with.
	// ── Selection + search ───────────────────────────────────────────────────
	// null = the docs HOME: nothing auto-opened, every category folded. The page
	// used to land on the first guide with "Getting started" forced open, which
	// read as a wall of steps before the reader had chosen anything.
	let selectedId = $state<string | null>(null);
	let query = $state('');
	// Read ?provider= when the state is CREATED. It used to be read in onMount,
	// after this sync effect had already run with 'all' and stripped the
	// parameter from the URL — so every "?provider=zernio" link landed on the
	// unfiltered docs home.
	function initialProvider(): 'all' | ProviderId {
		if (typeof window === 'undefined') return 'all';
		const p = new URLSearchParams(window.location.search).get('provider');
		return p && PROVIDERS.some((x) => x.id === p) ? (p as ProviderId) : 'all';
	}
	let provider = $state<'all' | ProviderId>(initialProvider());
	$effect(() => syncParam('provider', provider, 'all'));

	let filtered = $derived.by(() => {
		const q = query.trim().toLowerCase();
		const p = provider;
		let list = p === 'all' ? GUIDES : GUIDES.filter((g) => providersOf(g).includes(p));
		if (q)
			list = list.filter(
				(g) =>
					g.title.toLowerCase().includes(q) ||
					g.when.toLowerCase().includes(q) ||
					g.steps.some((s) => s.t.toLowerCase().includes(q))
			);
		return list;
	});
	let selected = $derived(selectedId ? (GUIDES.find((g) => g.id === selectedId) ?? null) : null);
	let providerMeta = $derived(PROVIDERS.find((p) => p.id === provider) ?? null);
	/** Guides per provider, for the home page's "by provider" row. */
	let providerCounts = $derived(
		PROVIDERS.map((p) => ({ ...p, count: GUIDES.filter((g) => providersOf(g).includes(p.id)).length }))
	);

	/** The first-run path, in the dashboard checklist's own order. */
	// Setup order for a new account. It skipped creating a persona and put
	// "generate a post" second — a step a brand-new account cannot take
	// (round-2 re-audit) — so it now follows the setup checklist.
	const START_HERE = ['getting-around', 'new-persona', 'brand-brief', 'zernio-key', 'connect-account', 'generate-post'];
	let startHere = $derived(
		START_HERE.map((id) => GUIDES.find((g) => g.id === id)).filter((g): g is Guide => !!g)
	);

	function goHome() {
		selectedId = null;
		history.replaceState(null, '', location.pathname + location.search);
		document.getElementById('guide-article')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
	}

	/**
	 * Put the guide's title just under whatever sticky bar covers the top of the
	 * scroller — measured, not assumed. scrollIntoView + scroll-margin landed
	 * 149–987px past the title in Firefox and WebKit (the sticky docs header
	 * only becomes sticky after the first scroll) and under the top bar on
	 * phones (round-5 re-audit). Called several times as the page settles.
	 */
	function landOnArticle() {
		const art = document.getElementById('guide-article');
		if (!art) return;
		const scroller = art.closest<HTMLElement>('.portal-content');
		const edge = scroller ? scroller.getBoundingClientRect().top : 0;
		let cover = edge;
		for (const el of document.querySelectorAll<HTMLElement>('header, .gd-top, .portal-header, [class*="topbar"]')) {
			const pos = getComputedStyle(el).position;
			if (pos !== 'sticky' && pos !== 'fixed') continue;
			const r = el.getBoundingClientRect();
			if (r.height > 0 && r.top <= edge + 2 && r.bottom > cover) cover = r.bottom;
		}
		const delta = art.getBoundingClientRect().top - cover - 16;
		if (Math.abs(delta) < 2) return;
		if (scroller) scroller.scrollTop += delta;
		else window.scrollBy(0, delta);
	}
	// The reader's own scroll ends the re-landing: the settle timers yanked a
	// reader who had already moved on back to the title (round-6 re-audit).
	let landToken = 0;
	function landSoon() {
		const token = ++landToken;
		const land = () => {
			if (token === landToken) landOnArticle();
		};
		const stop = () => {
			if (token === landToken) landToken++;
		};
		for (const ev of ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const) {
			window.addEventListener(ev, stop, { once: true, passive: true });
		}
		void tick().then(land);
		requestAnimationFrame(() => requestAnimationFrame(land));
		document.fonts?.ready.then(land).catch(() => {});
		setTimeout(land, 150);
		setTimeout(land, 450);
		setTimeout(land, 900);
	}

	function pick(id: string) {
		selectedId = id;
		// Navigating to a guide re-reveals its category even if it was explicitly
		// collapsed — the steps sub-nav lives under it, and arriving via search or
		// the prev/next pager must not leave the reader's own position folded away.
		const cat = GUIDES.find((g) => g.id === id)?.category;
		if (cat && expandedCats[cat] === false) {
			const { [cat]: _drop, ...rest } = expandedCats;
			expandedCats = rest;
		}
		// Deep-linkable, and a real history entry: Back after "Next" returns to
		// the previous guide instead of leaving /guides (round-5 re-audit).
		void goto(`#${id}`, { noScroll: true, keepFocus: true });
		landSoon();
		// Once landed, the article takes focus (a screen reader lands on the
		// guide, and Tab continues inside it) — focus fell to <body> (round-7).
		setTimeout(() => document.getElementById('guide-article')?.focus({ preventScroll: true }), 500);
	}
	// The URL's hash is the source of truth for which guide shows: Back,
	// Forward and a hand-edited hash all switch the article. Both hooks, on
	// purpose: the router's afterNavigate covers goto(), and the browser's own
	// hashchange covers history traversal and a hand-typed fragment, which
	// the router did not surface (round-5 re-audit: the URL changed, the
	// article did not).
	function selectFromHash() {
		const hash = location.hash.replace('#', '');
		if (hash && GUIDES.some((g) => g.id === hash) && selectedId !== hash) {
			selectedId = hash;
			landSoon();
		} else if (!hash && selectedId !== null) {
			// Back to /guides with no hash is the docs home, not the last article
			// (round-6 re-audit: the URL changed, the article stayed) — at the top
			// (round-7: the sidebar "Docs" link kept the article's scroll position).
			selectedId = null;
			void tick().then(() => {
				const sc = document.querySelector<HTMLElement>('main.portal-content');
				if (sc) sc.scrollTop = 0;
				else window.scrollTo(0, 0);
			});
		}
	}
	afterNavigate(selectFromHash);
	onMount(() => {
		window.addEventListener('hashchange', selectFromHash);
		return () => window.removeEventListener('hashchange', selectFromHash);
	});

	// ── Nav nesting ──────────────────────────────────────────────────────────
	// Categories are CLOSED by default: every group open at once turned the index
	// into a wall of links you had to read past to find anything. Two exceptions
	// DEFAULT open because closing them would hide what you are looking at — an
	// active search (matches must never sit behind a fold) and the category
	// holding the guide you are currently reading, which also carries its steps.
	// But an explicit click on the header ALWAYS wins over the reading-category
	// default: the old `selected.category === cat → true` short-circuit made
	// "Getting started" (home of the default guide) impossible to collapse — a
	// header whose chevron toggles state the open-check then ignores is a broken
	// control. Folding the nav never hides the article itself; it lives in the
	// center pane. (undefined = no explicit choice yet → the defaults apply.)
	let expandedCats = $state<Record<string, boolean>>({});
	function toggleCat(cat: string) {
		// Flip the EFFECTIVE state, not the raw flag — the first click on an
		// auto-opened category (raw flag still undefined) must close it.
		expandedCats = { ...expandedCats, [cat]: !catOpen(cat) };
	}
	function catOpen(cat: string): boolean {
		if (query.trim() || provider !== 'all') return true;
		const explicit = expandedCats[cat];
		if (explicit !== undefined) return explicit;
		// On the docs home nothing is selected, so every category starts folded.
		return selected?.category === cat;
	}

	/** Short label for a step's nested nav anchor — first words, no markup. */
	function stepLabel(t: string): string {
		const words = t.replace(/[·—→]/g, ' ').split(/\s+/).filter(Boolean);
		const label = words.slice(0, 5).join(' ');
		return label.length < t.length ? label + '…' : label;
	}

	function jumpToStep(i: number) {
		if (!selected) return;
		document
			.getElementById(`step-${selected.id}-${i + 1}`)
			?.scrollIntoView({ block: 'center', behavior: 'smooth' });
	}

	// Immersive reading: walk guides in catalog order without going back to the list.
	let guideIndex = $derived(selected ? GUIDES.findIndex((g) => g.id === selected!.id) : -1);
	let prevGuide = $derived(guideIndex > 0 ? GUIDES[guideIndex - 1] : null);
	let nextGuide = $derived(
		guideIndex >= 0 && guideIndex < GUIDES.length - 1 ? GUIDES[guideIndex + 1] : null
	);

	onMount(() => {
		const hash = location.hash.replace('#', '');
		if (hash && GUIDES.some((g) => g.id === hash)) {
			selectedId = hash;
			// Land ON the guide. On a phone the article sits below the whole index,
			// so every "What went wrong?" / "Where do I get a key?" link opened on
			// the list with the answer below the fold (round-2 re-audit). The
			// article's scroll-margin keeps its title clear of the sticky header.
			// Once is not enough: desktop Firefox lands 343–673px past the title
			// (the page above the article settles after the first scroll — round-4
			// re-audit). Re-land after paint, after fonts, and after a short settle.
			landSoon();
		}
	});

	// ── Docs hub: Guides | Changelog | Roadmap | User Voice ──────────────────
	type DocView = 'guides' | 'changelog' | 'roadmap' | 'uservoice';
	let docView = $state<DocView>('guides');
	onMount(() => {
		const params = new URLSearchParams(location.search);
		const v = params.get('view');
		if (v === 'changelog' || v === 'roadmap' || v === 'uservoice') docView = v;
		// The category filter wrote itself to the URL but never read itself back,
		// so a shared or reloaded link silently dropped to "Everything". Validate
		// against the categories that actually exist rather than a hardcoded list.
		const c = params.get('changes');
		if (c && CHANGE_GROUPS.some((g) => g.categories.includes(c as ChangeCategory))) {
			clCategory = c as ChangeCategory;
		}
	});
	$effect(() => syncParam('view', docView, 'guides'));

	// Changelog: intent-sized releases, newest first. The raw commit list is still
	// there — it just lives one click down, inside the release it belongs to,
	// because 302 individual commits is a ledger, not something you can read.
	let clQuery = $state('');
	let clMajorsOnly = $state(false);
	let clCategory = $state<'all' | ChangeCategory>('all');
	let clExpanded = $state<Record<string, boolean>>({});
	const clToggle = (id: string) => (clExpanded = { ...clExpanded, [id]: !clExpanded[id] });

	$effect(() => syncParam('changes', clCategory, 'all'));

	/** Every category actually present, with how many releases touch it. */
	let clCategories = $derived.by(() => {
		const tally = new Map<ChangeCategory, number>();
		for (const g of CHANGE_GROUPS)
			for (const c of g.categories) tally.set(c, (tally.get(c) ?? 0) + 1);
		return [...tally.entries()].sort((a, b) => b[1] - a[1]);
	});

	let clGroups = $derived.by(() => {
		const q = clQuery.trim().toLowerCase();
		let list = [...CHANGE_GROUPS].reverse();
		if (clMajorsOnly) list = list.filter((g) => g.major);
		// Snapshot before the closure: TS can't carry the !== 'all' narrowing on a
		// mutable $state binding into the filter callback.
		const cat = clCategory;
		if (cat !== 'all') list = list.filter((g) => g.categories.includes(cat));
		if (q)
			list = list.filter(
				(g) =>
					g.title.toLowerCase().includes(q) ||
					g.summary.toLowerCase().includes(q) ||
					g.entries.some(
						(e) => e.title.toLowerCase().includes(q) || (e.scope ?? '').toLowerCase().includes(q)
					)
			);
		return list;
	});
	let clShownChanges = $derived(clGroups.reduce((n, g) => n + g.entries.length, 0));

	/** Month headings still frame the timeline; a release is filed under its last day. */
	let clMonths = $derived.by(() => {
		const out: Array<{ month: string; label: string; groups: ChangeGroup[] }> = [];
		for (const g of clGroups) {
			const month = g.to.slice(0, 7);
			let bucket = out[out.length - 1];
			if (!bucket || bucket.month !== month) {
				bucket = {
					month,
					label: new Date(month + '-15').toLocaleDateString('en-US', {
						month: 'long',
						year: 'numeric'
					}),
					groups: []
				};
				out.push(bucket);
			}
			bucket.groups.push(g);
		}
		return out;
	});

	const CAT_LABEL: Record<string, string> = {
		feature: 'New features',
		fix: 'Fixes',
		security: 'Security',
		automation: 'Automation',
		publishing: 'Publishing',
		generation: 'Creating content',
		performance: 'Speed',
		design: 'Look & feel',
		docs: 'Help & docs',
		infrastructure: 'Behind the scenes',
		maintenance: 'Housekeeping'
	};

	const dayLabel = (d: string) =>
		new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
	const rangeLabel = (g: ChangeGroup) =>
		g.from === g.to ? dayLabel(g.to) : `${dayLabel(g.from)} – ${dayLabel(g.to)}`;
	const CL_FIRST = CHANGELOG[0]?.date ?? '';
	const CL_LAST = CHANGELOG[CHANGELOG.length - 1]?.date ?? '';
	const TYPE_LABEL: Record<string, string> = {
		feat: 'Feature',
		fix: 'Fix',
		perf: 'Performance',
		docs: 'Docs',
		chore: 'Chore',
		refactor: 'Refactor',
		redesign: 'Redesign',
		polish: 'Polish',
		deploy: 'Deploy',
		test: 'Tests',
		style: 'Style',
		other: 'Change'
	};

	let roadmapByStatus = $derived(
		ROADMAP_STATUSES.map((st) => ({
			...st,
			items: ROADMAP.filter((r) => r.status === st.id)
		}))
	);

	// ── User Voice ───────────────────────────────────────────────────────────
	interface UvItem {
		id: string;
		title: string;
		detail: string;
		status: string;
		created_at: string;
		mine: boolean;
		score: number;
		up: number;
		down: number;
		myVote: number;
	}
	const UV_STATUSES: Array<{ id: string; label: string }> = [
		{ id: 'under-review', label: 'Under review' },
		{ id: 'planned', label: 'Planned' },
		{ id: 'in-progress', label: 'In progress' },
		{ id: 'shipped', label: 'Shipped' },
		{ id: 'declined', label: 'Declined' }
	];
	let uvItems = $state<UvItem[]>([]);
	let uvLoading = $state(false);
	let uvError = $state('');
	let uvNeedsMigration = $state(false);
	let uvMode = $state<'list' | 'board'>('list');
	let uvQuery = $state('');
	let uvTitle = $state('');
	let uvDetail = $state('');
	let uvSubmitting = $state(false);
	let uvFormOpen = $state(false);

	async function uvApi(body: Record<string, unknown>) {
		const res = await fetch('/api/feature-requests', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		});
		return await res.json();
	}

	async function uvLoad() {
		uvLoading = true;
		uvError = '';
		try {
			const d = await uvApi({ action: 'list' });
			if (d.needsMigration) {
				uvNeedsMigration = true;
				uvError = d.error;
			} else if (!d.success) {
				uvError = d.error || 'Failed to load requests';
			} else {
				uvNeedsMigration = false;
				uvItems = d.items;
			}
		} catch (e: any) {
			uvError = e.message;
		} finally {
			uvLoading = false;
		}
	}
	$effect(() => {
		if (docView === 'uservoice') void uvLoad();
	});

	let uvFiltered = $derived.by(() => {
		const q = uvQuery.trim().toLowerCase();
		const list = q
			? uvItems.filter(
					(i) => i.title.toLowerCase().includes(q) || i.detail.toLowerCase().includes(q)
				)
			: [...uvItems];
		// Highest support first; ties by newest.
		return list.sort((a, b) => b.score - a.score || b.created_at.localeCompare(a.created_at));
	});
	let uvLanes = $derived(
		UV_STATUSES.map((st) => ({ ...st, items: uvFiltered.filter((i) => i.status === st.id) }))
	);

	async function uvVote(item: UvItem, dir: 1 | -1) {
		// Clicking your current vote clears it; otherwise it sets/flips.
		const next = item.myVote === dir ? 0 : dir;
		// Optimistic: reflect instantly, reconcile with a reload on failure.
		const prev = { myVote: item.myVote, score: item.score, up: item.up, down: item.down };
		item.score += next - item.myVote;
		if (item.myVote === 1) item.up--;
		if (item.myVote === -1) item.down--;
		if (next === 1) item.up++;
		if (next === -1) item.down++;
		item.myVote = next;
		const d = await uvApi({ action: 'vote', id: item.id, value: next });
		if (!d.success) {
			Object.assign(item, prev);
			uvError = d.error || 'Vote failed';
		}
	}

	async function uvSubmit() {
		if (uvSubmitting || uvTitle.trim().length < 3) return;
		uvSubmitting = true;
		uvError = '';
		try {
			const d = await uvApi({ action: 'create', title: uvTitle, detail: uvDetail });
			if (!d.success) {
				uvError = d.error || 'Could not add the request';
				return;
			}
			uvTitle = '';
			uvDetail = '';
			uvFormOpen = false;
			await uvLoad();
		} finally {
			uvSubmitting = false;
		}
	}

	async function uvDelete(item: UvItem) {
		const ok = await confirmAction({
			title: 'Delete your feature request?',
			body: `“${item.title}” and every vote it has collected are removed.`,
			warning: 'Votes cannot be recovered.',
			confirmLabel: 'Delete request',
			tone: 'danger'
		});
		if (!ok) return;
		const d = await uvApi({ action: 'delete', id: item.id });
		if (!d.success) uvError = d.error || 'Delete failed';
		else uvItems = uvItems.filter((i) => i.id !== item.id);
	}
</script>

<svelte:head>
	<title>Docs — PersonaGen</title>
</svelte:head>

<div class="guides-page">
	<!-- Slim sticky top bar: title + search, full width. -->
	<header class="gd-top">
		<div class="gd-top-titles">
			<h1>Docs</h1>
			<p>
				{#if docView === 'guides'}
					How to do everything in PersonaGen — plain English, step by step, with pictures.
				{:else if docView === 'changelog'}
					{CHANGE_GROUPS.length} releases covering every change since the first commit —
					{CHANGELOG.length} of them, from {CL_FIRST} to {CL_LAST}. Open a release to read the
					individual changes inside it.
				{:else if docView === 'roadmap'}
					What's being built, what's next, and what's under consideration — the honest ledger.
				{:else}
					Request features, vote on what matters — the most-wanted ideas rise to the top.
				{/if}
			</p>
		</div>
		<nav class="gd-docs-nav" aria-label="Documentation section">
			<button
				type="button"
				class="gd-docs-tab"
				class:active={docView === 'guides'}
				aria-current={docView === 'guides' ? 'true' : undefined}
				onclick={() => (docView = 'guides')}>Guides</button>
			<button
				type="button"
				class="gd-docs-tab"
				class:active={docView === 'changelog'}
				aria-current={docView === 'changelog' ? 'true' : undefined}
				onclick={() => (docView = 'changelog')}>Changelog</button>
			<button
				type="button"
				class="gd-docs-tab"
				class:active={docView === 'roadmap'}
				aria-current={docView === 'roadmap' ? 'true' : undefined}
				onclick={() => (docView = 'roadmap')}>Roadmap</button>
			<button
				type="button"
				class="gd-docs-tab"
				class:active={docView === 'uservoice'}
				aria-current={docView === 'uservoice' ? 'true' : undefined}
				onclick={() => (docView = 'uservoice')}>User Voice</button>
		</nav>
		{#if docView === 'guides'}
			<input
				type="search"
				placeholder="Search guides… (try: credits, connect, voice)"
				bind:value={query}
				aria-label="Search guides"
			/>
		{:else if docView === 'changelog'}
			<input
				type="search"
				placeholder="Search changes… (try: studio, calendar, fix)"
				bind:value={clQuery}
				aria-label="Search the changelog"
			/>
		{:else if docView === 'uservoice'}
			<input
				type="search"
				placeholder="Search requests…"
				bind:value={uvQuery}
				aria-label="Search feature requests"
			/>
		{/if}
	</header>

	{#if docView === 'guides'}
	<div class="gd-body">
		<!-- ── Left: nested index — category ▸ guide ▸ steps of the open guide ── -->
		<nav class="gd-nav" aria-label="Guide list">
			<button type="button" class="nav-home" class:active={!selected} onclick={goHome}>
				<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 11l9-8 9 8v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z" /></svg>
				Docs home
			</button>
			<!-- Second axis: the same guides, narrowed to one provider. -->
			<label class="nav-provider">
				<span class="nav-provider-label">By provider</span>
				<select bind:value={provider} aria-label="Show guides for one provider">
					<option value="all">All providers</option>
					{#each providerCounts as p (p.id)}
						<option value={p.id}>{p.label} ({p.count})</option>
					{/each}
				</select>
			</label>
			{#if providerMeta}
				<p class="nav-provider-role">{providerMeta.label}: {providerMeta.role}</p>
			{/if}
			{#each CATEGORIES as cat}
				{@const inCat = filtered.filter((g) => g.category === cat)}
				{#if inCat.length > 0}
					<div class="nav-cat">
						<button
							type="button"
							class="nav-cat-head"
							aria-expanded={catOpen(cat)}
							onclick={() => toggleCat(cat)}
						>
							<svg
								class="nav-chevron"
								class:open={catOpen(cat)}
								width="12"
								height="12"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2.5"
								stroke-linecap="round"
								stroke-linejoin="round"
								aria-hidden="true"><path d="M9 18l6-6-6-6" /></svg>
							{cat}
							<span class="nav-count">{inCat.length}<span class="sr-only"> {inCat.length === 1 ? 'guide' : 'guides'}</span></span>
						</button>
						{#if catOpen(cat)}
							<div class="nav-cat-items">
								{#each inCat as g (g.id)}
									<button
										type="button"
										class="nav-item"
										class:active={g.id === selectedId}
										aria-current={g.id === selectedId ? 'true' : undefined}
										onclick={() => pick(g.id)}
									>
										{g.title}
									</button>
									{#if g.id === selectedId}
										<!-- One level deeper: the open guide's steps as jump points. -->
										<ol class="nav-steps">
											{#each g.steps as step, i}
												<li>
													<button type="button" class="nav-step" onclick={() => jumpToStep(i)}>
														<span class="nav-step-n">{i + 1}</span>{stepLabel(step.t)}
													</button>
												</li>
											{/each}
										</ol>
									{/if}
								{/each}
							</div>
						{/if}
					</div>
				{/if}
			{/each}
			{#if filtered.length === 0}
				<p class="index-empty">
					No guides match {query ? `“${query}”` : ''}{query && providerMeta ? ' for ' : ''}{providerMeta ? providerMeta.label : ''}.
				</p>
			{/if}
		</nav>

		<!-- ── Center: the guide itself, or the docs home ── -->
		<article class="gd-article" id="guide-article" aria-live="polite" tabindex="-1">
		{#if !selected}
			<!-- Docs home: choose before you read. Nothing is opened for you. -->
			<div class="gd-home">
				<section class="home-start" aria-labelledby="home-start-title">
					<h2 id="home-start-title">Start here</h2>
					<p class="home-lede">{startHere.length} guides, in order, take a new account from login to a live post.</p>
					<ol class="home-path">
						{#each startHere as g, i (g.id)}
							<li>
								<button type="button" class="home-path-btn" onclick={() => pick(g.id)}>
									<span class="home-path-n">{i + 1}</span>
									<span class="home-path-text">
										<span class="home-path-title">{g.title}</span>
										<span class="home-path-when">{g.when}</span>
									</span>
								</button>
							</li>
						{/each}
					</ol>
				</section>

				<section class="home-cats" aria-labelledby="home-cats-title">
					<h3 id="home-cats-title">Browse by topic</h3>
					<div class="home-grid">
						{#each CATEGORIES as cat (cat)}
							{@const inCat = filtered.filter((g) => g.category === cat)}
							{#if inCat.length > 0}
								<button
									type="button"
									class="home-card"
									onclick={() => {
										expandedCats = { ...expandedCats, [cat]: true };
										pick(inCat[0].id);
									}}
								>
									<span class="home-card-title">{cat}</span>
									<span class="home-card-count">{inCat.length} {inCat.length === 1 ? 'guide' : 'guides'}</span>
									<span class="home-card-list">{inCat.slice(0, 3).map((g) => g.title).join(' · ')}{inCat.length > 3 ? ' · …' : ''}</span>
								</button>
							{/if}
						{/each}
					</div>
				</section>

				<section class="home-providers" aria-labelledby="home-prov-title">
					<h3 id="home-prov-title">Browse by provider</h3>
					<p class="home-lede">Every guide that touches one service — keys, billing, and the errors it throws.</p>
					<div class="home-prov-row">
						{#each providerCounts as p (p.id)}
							<button
								type="button"
								class="home-prov"
								class:active={provider === p.id}
								onclick={() => (provider = provider === p.id ? 'all' : p.id)}
							>
								<span class="home-prov-name">{p.label}</span>
								<span class="home-prov-role">{p.role}</span>
								<span class="home-prov-count">{p.count} {p.count === 1 ? 'guide' : 'guides'}</span>
							</button>
						{/each}
					</div>
					{#if providerMeta}
						<ul class="home-prov-list">
							{#each filtered as g (g.id)}
								<li>
									<button type="button" class="home-prov-link" onclick={() => pick(g.id)}>
										<span class="home-prov-link-cat">{g.category}</span>
										{g.title}
									</button>
								</li>
							{/each}
						</ul>
					{/if}
				</section>
			</div>
		{:else}
			<button type="button" class="article-back" onclick={goHome}>← Docs home</button>
			<span class="article-cat">{selected.category}</span>
			<h2>{selected.title}</h2>
			<p class="article-when"><b>You need this when:</b> {selected.when}</p>
			{#if providersOf(selected).length}
				<p class="article-providers">
					{#each providersOf(selected) as pid (pid)}
						<button type="button" class="article-provider" onclick={() => (provider = pid)}>
							{PROVIDERS.find((p) => p.id === pid)?.label}
						</button>
					{/each}
				</p>
			{/if}

			{#if selected.facts?.length}
				<section class="gd-facts" aria-label="Quick facts">
					<h3 class="facts-title">Quick facts</h3>
					<ul>
						{#each selected.facts as f}
							<li>{f}</li>
						{/each}
					</ul>
				</section>
			{/if}

			<ol class="article-steps">
				{#each selected.steps as step, i}
					<li id={`step-${selected.id}-${i + 1}`}>
						{step.t}
						{#if step.demo}
							{@const Demo = DEMOS[step.demo]}
							<Demo />
						{/if}
						{#if step.img}
							<ShotFigure
								src={shotUrl(step.img)}
								alt={step.alt ?? 'App screenshot for this step'}
								caption={step.caption}
								focus={step.focus}
								zoom={step.zoom}
								ratio={step.img === 'sidebar-guides' ? 'tall' : 'wide'}
							/>
						{/if}
					</li>
				{/each}
			</ol>
			{#if selected.tip}
				<p class="article-tip">💡 {selected.tip}</p>
			{/if}
		{/if}

			<!-- Walk the whole handbook without returning to the list. -->
			<footer class="gd-pager" class:hidden={!selected}>
				{#if prevGuide}
					<button type="button" class="pager-btn" onclick={() => pick(prevGuide!.id)}>
						<span class="pager-dir">← Previous</span>
						<span class="pager-title">{prevGuide.title}</span>
					</button>
				{:else}<span></span>{/if}
				{#if nextGuide}
					<button type="button" class="pager-btn pager-next" onclick={() => pick(nextGuide!.id)}>
						<span class="pager-dir">Next →</span>
						<span class="pager-title">{nextGuide.title}</span>
					</button>
				{/if}
			</footer>
		</article>

		<!-- ── Right: on-this-page rail ── -->
		<aside class="gd-rail" aria-label="On this page">
			{#if selected}
				<span class="rail-title">On this page</span>
				<ol class="rail-steps">
					{#each selected.steps as step, i}
						<li>
							<button type="button" class="rail-step" onclick={() => jumpToStep(i)}>
								<span class="rail-n">{i + 1}</span>{stepLabel(step.t)}
							</button>
						</li>
					{/each}
				</ol>
			{:else}
				<span class="rail-title">Handbook</span>
				<p class="rail-home">
					{GUIDES.length} guides across {CATEGORIES.length} topics and {PROVIDERS.length} providers.
					Pick one on the left, or start with the six-step path.
				</p>
			{/if}
		</aside>
	</div>

	{:else if docView === 'changelog'}
		<div class="cl-body">
			<div class="cl-controls">
				<div class="cl-cats" role="group" aria-label="Filter changes by what they affected">
					<button
						type="button"
						class="cl-cat"
						class:active={clCategory === 'all'}
						aria-pressed={clCategory === 'all'}
						onclick={() => (clCategory = 'all')}>Everything</button>
					{#each clCategories as [cat, n] (cat)}
						<button
							type="button"
							class="cl-cat cl-cat-{cat}"
							class:active={clCategory === cat}
							aria-pressed={clCategory === cat}
							onclick={() => (clCategory = cat)}>{CAT_LABEL[cat] ?? cat}<span class="cl-cat-n">{n}</span></button>
					{/each}
				</div>
				<div class="cl-controls-right">
					<label class="cl-majors">
						<input type="checkbox" bind:checked={clMajorsOnly} />
						Big releases only
					</label>
					<span class="cl-count" aria-live="polite"
						>{clGroups.length} of {CHANGE_GROUPS.length} releases · {clShownChanges} changes</span>
				</div>
			</div>

			{#if clGroups.length === 0}
				<p class="cl-empty">
					No releases match{clQuery ? ` “${clQuery}”` : ''}{clCategory !== 'all'
						? ` in ${CAT_LABEL[clCategory] ?? clCategory}`
						: ''}.
				</p>
			{/if}

			{#each clMonths as month (month.month)}
				<section class="cl-month">
					<h2 class="cl-month-title">{month.label}</h2>
					{#each month.groups as g (g.id)}
						{@const open = !!clExpanded[g.id]}
						<article class="cl-rel" class:major={g.major}>
							<div class="cl-rel-head">
								<span class="cl-rel-date">{rangeLabel(g)}</span>
								<div class="cl-rel-main">
									<h3 class="cl-rel-title">{g.title}</h3>
									<p class="cl-rel-summary">{g.summary}</p>
									<div class="cl-rel-cats">
										{#each g.categories as c (c)}
											<span class="cl-chip cl-cat-{c}">{CAT_LABEL[c] ?? c}</span>
										{/each}
									</div>
								</div>
							</div>
							<button
								type="button"
								class="cl-rel-toggle"
								aria-expanded={open}
								aria-controls="cl-detail-{g.id}"
								onclick={() => clToggle(g.id)}
							>
								<svg
									class="cl-rel-chevron"
									class:open
									width="13"
									height="13"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2.5"
									stroke-linecap="round"
									stroke-linejoin="round"
									aria-hidden="true"><path d="M9 18l6-6-6-6" /></svg>
								{open ? 'Hide' : 'Show'} the {g.entries.length} change{g.entries.length === 1
									? ''
									: 's'} in this release
							</button>
							{#if open}
								<ol class="cl-list" id="cl-detail-{g.id}">
									{#each g.entries as e (e.hash)}
										<li class="cl-entry" class:milestone={!!e.milestone}>
											<span class="cl-date">{dayLabel(e.date)}</span>
											<span class="cl-type cl-type-{e.type}">{TYPE_LABEL[e.type] ?? e.type}</span>
											<span class="cl-text">
												{#if e.scope}<span class="cl-scope">{e.scope}</span>{/if}
												{e.title}
												{#if e.milestone}
													<span class="cl-milestone-note">★ {e.milestone}</span>
												{/if}
											</span>
										</li>
									{/each}
								</ol>
							{/if}
						</article>
					{/each}
				</section>
			{/each}
		</div>

	{:else if docView === 'roadmap'}
		<div class="rm-body">
			{#each roadmapByStatus as lane (lane.id)}
				<section class="rm-lane rm-{lane.id}">
					<header class="rm-lane-head">
						<h2 class="rm-lane-title">{lane.label}</h2>
						<span class="rm-lane-hint">{lane.hint}</span>
						<span class="rm-lane-count">{lane.items.length}</span>
					</header>
					{#each lane.items as item (item.title)}
						<article class="rm-card">
							<span class="rm-area">{item.area}</span>
							<h3 class="rm-card-title">{item.title}</h3>
							<p class="rm-card-detail">{item.detail}</p>
						</article>
					{/each}
				</section>
			{/each}
		</div>

	{:else}
		<div class="uv-body">
			<div class="uv-controls">
				<div class="feed-view-toggle" role="group" aria-label="User Voice view">
					<button
						type="button"
						class="view-toggle-btn"
						class:active={uvMode === 'list'}
						aria-pressed={uvMode === 'list'}
						onclick={() => (uvMode = 'list')}>List</button>
					<button
						type="button"
						class="view-toggle-btn"
						class:active={uvMode === 'board'}
						aria-pressed={uvMode === 'board'}
						onclick={() => (uvMode = 'board')}>Board</button>
				</div>
				<span class="uv-count" aria-live="polite">{uvFiltered.length} request{uvFiltered.length === 1 ? '' : 's'}</span>
				<button type="button" class="uv-add-btn" onclick={() => (uvFormOpen = !uvFormOpen)} aria-expanded={uvFormOpen}>
					{uvFormOpen ? 'Close' : '+ Request a feature'}
				</button>
			</div>

			{#if uvFormOpen}
				<form
					class="uv-form"
					onsubmit={(e) => {
						e.preventDefault();
						void uvSubmit();
					}}
				>
					<label class="uv-label" for="uv-title">What should we build or fix?</label>
					<input
						id="uv-title"
						type="text"
						bind:value={uvTitle}
						minlength="3"
						maxlength="120"
						required
						placeholder="One clear sentence — e.g. “Bulk-reschedule posts by dragging on the calendar”"
					/>
					<label class="uv-label" for="uv-detail">Why / details <span class="uv-optional">(optional)</span></label>
					<textarea
						id="uv-detail"
						bind:value={uvDetail}
						maxlength="2000"
						rows="3"
						placeholder="What problem does it solve? When did you last need it?"
					></textarea>
					<div class="uv-form-foot">
						<span class="uv-hint">Your request starts with your own upvote. Statuses are set by the team.</span>
						<button type="submit" class="uv-submit" disabled={uvSubmitting || uvTitle.trim().length < 3}>
							{uvSubmitting ? 'Adding…' : 'Add request'}
						</button>
					</div>
				</form>
			{/if}

			{#if uvError}
				<div class="uv-error" role="alert">
					{uvError}
					{#if !uvNeedsMigration}
						<button type="button" class="uv-retry" onclick={() => void uvLoad()}>Retry</button>
					{/if}
				</div>
			{/if}

			{#if uvLoading && uvItems.length === 0}
				<p class="uv-empty" role="status">Loading requests…</p>
			{:else if !uvNeedsMigration && uvFiltered.length === 0 && !uvLoading}
				<div class="uv-empty">
					{#if uvQuery.trim()}
						No requests match “{uvQuery}”.
					{:else}
						No feature requests yet — yours can be the first. Click <b>+ Request a feature</b>.
					{/if}
				</div>
			{:else if uvMode === 'list'}
				<ol class="uv-list">
					{#each uvFiltered as item (item.id)}
						<li class="uv-row">
							<div class="uv-votes">
								<button
									type="button"
									class="uv-vote up"
									class:on={item.myVote === 1}
									aria-pressed={item.myVote === 1}
									aria-label="Upvote {item.title}"
									onclick={() => void uvVote(item, 1)}
									><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 15l-6-6-6 6" /></svg></button>
								<span class="uv-score" class:neg={item.score < 0}>{item.score}</span>
								<button
									type="button"
									class="uv-vote down"
									class:on={item.myVote === -1}
									aria-pressed={item.myVote === -1}
									aria-label="Downvote {item.title}"
									onclick={() => void uvVote(item, -1)}
									><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg></button>
							</div>
							<div class="uv-main">
								<span class="uv-title-row">
									<b class="uv-title">{item.title}</b>
									<span class="uv-status uv-status-{item.status}">{UV_STATUSES.find((st) => st.id === item.status)?.label ?? item.status}</span>
									{#if item.mine}<span class="uv-mine">yours</span>{/if}
								</span>
								{#if item.detail}<p class="uv-detail">{item.detail}</p>{/if}
								<span class="uv-meta">
									{new Date(item.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
									· ▲ {item.up} · ▼ {item.down}
									{#if item.mine}
										<button type="button" class="uv-del" onclick={() => void uvDelete(item)}>Delete</button>
									{/if}
								</span>
							</div>
						</li>
					{/each}
				</ol>
			{:else}
				<div class="uv-board">
					{#each uvLanes as lane (lane.id)}
						<section class="uv-lane">
							<header class="uv-lane-head">
								<h2 class="uv-lane-title uv-status-{lane.id}">{lane.label}</h2>
								<span class="uv-lane-count">{lane.items.length}</span>
							</header>
							{#each lane.items as item (item.id)}
								<article class="uv-card">
									<span class="uv-card-score" class:neg={item.score < 0}>{item.score > 0 ? '+' : ''}{item.score}</span>
									<b class="uv-card-title">{item.title}</b>
									{#if item.detail}<p class="uv-card-detail">{item.detail}</p>{/if}
								</article>
							{/each}
							{#if lane.items.length === 0}
								<p class="uv-lane-empty">Empty</p>
							{/if}
						</section>
					{/each}
				</div>
			{/if}
		</div>
	{/if}
</div>

<style>
	/* ── Immersive full-bleed: cancel the portal's content padding and own the
	   whole viewport, edge to edge. ── */
	.guides-page {
		margin: calc(-1 * var(--space-8));
		min-height: calc(100vh - var(--header-height, 60px));
		min-height: calc(100dvh - var(--header-height, 60px));
		display: flex;
		flex-direction: column;
		background: var(--bg);
	}

	.gd-top {
		position: sticky;
		top: calc(-1 * var(--space-8));
		z-index: var(--z-sticky);
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-6);
		flex-wrap: wrap;
		padding-block: var(--space-5);
		/* The floor is TWO gutters, not one. /guides escapes the portal's own
		   padding with a negative inline margin, so one gutter only puts its
		   content back at the portal content edge — 32px LEFT of where PageShell
		   starts, which is exactly where its h1 was measured at 1280 and 1440.
		   The calc branch already accounts for it (the full-bleed box is wider by
		   both margins), which is why 1920 looked correct and hid the bug. */
		padding-inline: max(
			calc(var(--space-8) * 2),
			calc((100% - var(--page-wide)) / 2 + var(--space-8))
		);
		border-bottom: 1px solid var(--border);
		background: color-mix(in srgb, var(--bg) 88%, transparent);
		backdrop-filter: blur(12px);
	}
	.gd-top-titles h1 {
		font-size: var(--text-xl);
		font-weight: 700;
		color: var(--text);
		margin: 0;
	}
	.gd-top-titles p {
		color: var(--text-muted);
		margin: 0.15rem 0 0;
		font-size: 0.85rem;
	}
	.gd-top input {
		width: min(380px, 100%);
		min-height: 44px;
		padding: 0.55rem 0.9rem;
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-sm);
		background: var(--surface);
		color: var(--text);
		font-size: 1rem;
	}
	.gd-top input:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 1px;
	}

	/* ── The three-zone reading grid: index · article · rail ── */
	.gd-body {
		flex: 1;
		display: grid;
		grid-template-columns: 280px minmax(0, 1fr) 250px;
		gap: var(--space-8);
		align-items: start;
		padding-block: var(--space-6) var(--space-16);
		/* The floor is TWO gutters, not one. /guides escapes the portal's own
		   padding with a negative inline margin, so one gutter only puts its
		   content back at the portal content edge — 32px LEFT of where PageShell
		   starts, which is exactly where its h1 was measured at 1280 and 1440.
		   The calc branch already accounts for it (the full-bleed box is wider by
		   both margins), which is why 1920 looked correct and hid the bug. */
		padding-inline: max(
			calc(var(--space-8) * 2),
			calc((100% - var(--page-wide)) / 2 + var(--space-8))
		);
		width: 100%;
	}

	/* ── Left index ── */
	.gd-nav {
		position: sticky;
		top: calc(var(--space-16) + var(--space-6));
		max-height: calc(100vh - 160px);
		max-height: calc(100dvh - 160px);
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		padding-right: var(--space-2);
	}
	.nav-cat-head {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		width: 100%;
		min-height: 40px;
		padding: 0.3rem 0.5rem;
		border: none;
		background: none;
		cursor: pointer;
		font-family: var(--font-mono);
		font-size: 0.64rem;
		font-weight: var(--weight-semi);
		text-transform: uppercase;
		letter-spacing: 0.09em;
		color: var(--text-dim);
		border-radius: var(--radius-xs);
		text-align: left;
	}
	.nav-cat-head:hover {
		color: var(--text);
		background: var(--surface-2);
	}
	.nav-cat-head:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 1px;
	}
	.nav-chevron {
		transition: transform 0.15s ease;
		flex-shrink: 0;
	}
	.nav-chevron.open {
		transform: rotate(90deg);
	}
	.nav-count {
		margin-left: auto;
		font-variant-numeric: tabular-nums;
		/* A dimmed colour, not opacity: 0.7 took the count below AA. */
		color: var(--text-dim);
	}
	.nav-cat-items {
		display: flex;
		flex-direction: column;
		margin: 0 0 var(--space-2) 0.9rem;
		border-left: 1px solid var(--border);
	}
	.nav-item {
		text-align: left;
		border: none;
		background: none;
		cursor: pointer;
		font-size: 0.83rem;
		color: var(--text-muted);
		padding: 0.42rem 0.6rem;
		min-height: 38px;
		border-radius: 0 var(--radius-xs) var(--radius-xs) 0;
		border-left: 2px solid transparent;
		margin-left: -1px;
	}
	.nav-item:hover {
		color: var(--text);
		background: var(--surface-2);
	}
	.nav-item.active {
		color: var(--accent-text);
		border-left-color: var(--accent);
		background: var(--accent-soft);
		font-weight: var(--weight-semi);
	}
	.nav-item:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: -2px;
	}
	/* Nested step anchors under the active guide. */
	.nav-steps {
		list-style: none;
		margin: 0 0 0.35rem 0.8rem;
		padding: 0;
		border-left: 1px dotted var(--border-strong);
	}
	.nav-step {
		display: flex;
		align-items: baseline;
		gap: 0.45rem;
		width: 100%;
		text-align: left;
		border: none;
		background: none;
		cursor: pointer;
		font-size: 0.74rem;
		color: var(--text-dim);
		padding: 0.28rem 0.5rem;
		min-height: 32px;
	}
	.nav-step:hover {
		color: var(--accent-text);
	}
	.nav-step:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: -2px;
	}
	.nav-step-n {
		font-family: var(--font-mono);
		font-size: 0.62rem;
		font-variant-numeric: tabular-nums;
		color: var(--accent-text);
		flex-shrink: 0;
	}
	.index-empty {
		color: var(--text-dim);
		font-size: 0.85rem;
		padding: 0.5rem;
	}

	/* ── Article ── */
	.gd-article {
		min-width: 0;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		padding: var(--space-8) var(--space-10) var(--space-8);
		/* pick() scrolls this into view; without the margin the guide title lands
		   underneath the sticky search header and gets clipped by its blur. */
		scroll-margin-top: 140px;
	}
	.article-cat {
		font-family: var(--font-mono);
		font-size: 0.64rem;
		font-weight: var(--weight-semi);
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: var(--accent-text);
	}
	.gd-article h2 {
		font-size: 1.7rem;
		font-weight: 700;
		color: var(--text);
		margin: 0.3rem 0 0.6rem;
		line-height: 1.2;
	}
	.article-when {
		color: var(--text-muted);
		background: var(--surface-2);
		border-radius: var(--radius-sm);
		padding: 0.65rem 0.9rem;
		font-size: 0.9rem;
		margin: 0 0 var(--space-5);
		max-width: 75ch;
	}

	/* Quick facts — the answers most visitors came for, before the steps. */
	.gd-facts {
		border: 1px solid color-mix(in srgb, var(--accent) 22%, transparent);
		background: var(--accent-soft);
		border-radius: var(--radius-sm);
		padding: var(--space-4) var(--space-5);
		margin-bottom: var(--space-6);
	}
	.facts-title {
		font-family: var(--font-mono);
		font-size: 0.62rem;
		font-weight: var(--weight-semi);
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: var(--accent-text);
		margin: 0 0 0.5rem;
	}
	.gd-facts ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
		gap: 0.35rem 1.25rem;
	}
	.gd-facts li {
		font-size: 0.85rem;
		color: var(--text);
		padding-left: 1rem;
		position: relative;
		line-height: 1.5;
	}
	.gd-facts li::before {
		content: '›';
		position: absolute;
		left: 0;
		color: var(--accent-text);
		font-weight: 700;
	}

	.article-steps {
		margin: 0;
		padding: 0 0 0 1.4rem;
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
		counter-reset: none;
	}
	.article-steps li {
		font-size: 0.98rem;
		line-height: 1.7;
		color: var(--text);
		max-width: 78ch;
		scroll-margin-top: 130px;
	}
	.article-steps li::marker {
		color: var(--accent-text);
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}
	/* Screenshots render through ShotFigure ($lib/components/docs) — framed,
	   focus-cropped, lightboxed — so no bare .step-shot styles live here. */
	.article-tip {
		margin: var(--space-6) 0 0;
		background: var(--surface-2);
		border-left: 3px solid var(--gold);
		border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
		padding: 0.7rem 1rem;
		color: var(--text-muted);
		font-size: 0.9rem;
		max-width: 75ch;
	}

	/* Prev / next pager */
	.gd-pager {
		display: flex;
		justify-content: space-between;
		gap: var(--space-4);
		margin-top: var(--space-8);
		padding-top: var(--space-5);
		border-top: 1px solid var(--border);
	}
	.pager-btn {
		display: flex;
		flex-direction: column;
		gap: 2px;
		max-width: 46%;
		text-align: left;
		border: 1px solid var(--border);
		background: var(--surface-2);
		border-radius: var(--radius-sm);
		padding: 0.6rem 0.9rem;
		min-height: 44px;
		cursor: pointer;
	}
	.pager-btn:hover {
		border-color: var(--accent-mid);
	}
	.pager-btn:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
	.pager-next {
		text-align: right;
		align-items: flex-end;
		margin-left: auto;
	}
	.pager-dir {
		font-family: var(--font-mono);
		font-size: 0.62rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--text-dim);
	}
	.pager-title {
		font-size: 0.84rem;
		font-weight: var(--weight-semi);
		color: var(--text);
	}

	/* ── Right rail ── */
	.gd-rail {
		position: sticky;
		top: calc(var(--space-16) + var(--space-6));
		max-height: calc(100vh - 160px);
		max-height: calc(100dvh - 160px);
		overflow-y: auto;
	}
	.rail-title {
		display: block;
		font-family: var(--font-mono);
		font-size: 0.62rem;
		font-weight: var(--weight-semi);
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: var(--text-dim);
		margin-bottom: 0.5rem;
	}
	.rail-steps {
		list-style: none;
		margin: 0;
		padding: 0;
		border-left: 1px solid var(--border);
	}
	.rail-step {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		width: 100%;
		text-align: left;
		border: none;
		background: none;
		cursor: pointer;
		font-size: 0.76rem;
		color: var(--text-dim);
		padding: 0.3rem 0.6rem;
		min-height: 34px;
		line-height: 1.45;
	}
	.rail-step:hover {
		color: var(--accent-text);
	}
	.rail-step:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: -2px;
	}
	.rail-n {
		font-family: var(--font-mono);
		font-size: 0.64rem;
		font-variant-numeric: tabular-nums;
		color: var(--accent-text);
		flex-shrink: 0;
	}

	/* ── Responsive ── */
	@media (max-width: 1280px) {
		.gd-body {
			grid-template-columns: 260px minmax(0, 1fr);
		}
		.gd-rail {
			display: none; /* step anchors still live in the left nav's nested list */
		}
	}
	@media (max-width: 900px) {
		.guides-page {
			margin: calc(-1 * var(--space-4));
		}
		.gd-top {
			padding: var(--space-4);
			top: calc(-1 * var(--space-4));
		}
		.gd-body {
			grid-template-columns: 1fr;
			padding: var(--space-4) var(--space-4) var(--space-12);
			gap: var(--space-4);
		}
		.gd-nav {
			/* Below the docs home on phones: "Start here" sat ~1,030px down. */
			order: 1;
			position: static;
			max-height: none;
			border: 1px solid var(--border);
			border-radius: var(--radius-sm);
			background: var(--surface);
			padding: var(--space-3);
		}
		.gd-article {
			padding: var(--space-5);
		}
	}

	/* ── Docs hub nav ─────────────────────────────────────────────── */
	.gd-docs-nav {
		display: inline-flex;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		overflow: hidden;
		background: var(--surface);
	}
	.gd-docs-tab {
		border: none;
		background: none;
		cursor: pointer;
		font-size: 0.85rem;
		font-weight: var(--weight-semi);
		color: var(--text-dim);
		padding: 0 1.1rem;
		min-height: 44px;
	}
	.gd-docs-tab:hover {
		color: var(--text);
		background: var(--surface-2);
	}
	.gd-docs-tab.active {
		color: var(--accent-text);
		background: var(--accent-soft);
	}
	.gd-docs-tab:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: -2px;
	}

	/* ── Changelog ────────────────────────────────────────────────── */
	.cl-body {
		max-width: 980px;
		margin: 0 auto;
		padding: var(--space-6) var(--space-8) var(--space-16);
		width: 100%;
	}
	/* ── Release cards ─────────────────────────────────────────────────── */
	.cl-cats {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}

	.cl-cat {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		min-height: 32px;
		padding: 0.3rem 0.7rem;
		border-radius: var(--radius-full, 999px);
		border: 1px solid var(--border);
		background: var(--surface-2);
		color: var(--text-muted);
		font-size: 0.78rem;
		font-weight: 600;
		cursor: pointer;
		transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
	}

	.cl-cat:hover {
		color: var(--text);
		border-color: var(--border-hover);
	}

	.cl-cat.active {
		background: var(--accent-dark);
		border-color: var(--accent-dark);
		color: #fff;
	}

	.cl-cat:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}

	.cl-cat-n {
		font-variant-numeric: tabular-nums;
		opacity: 0.65;
		font-weight: 700;
	}

	.cl-controls-right {
		display: flex;
		align-items: center;
		gap: 1rem;
		flex-wrap: wrap;
	}

	.cl-rel {
		border: 1px solid var(--border);
		border-radius: var(--radius-sm, 10px);
		background: var(--surface);
		padding: 0.9rem 1rem;
		margin-bottom: 0.7rem;
	}

	.cl-rel.major {
		border-color: var(--accent-mid, var(--border-hover));
		box-shadow: inset 3px 0 0 var(--accent);
	}

	.cl-rel-head {
		display: flex;
		gap: 1rem;
		align-items: flex-start;
	}

	.cl-rel-date {
		flex: none;
		min-width: 6.5rem;
		padding-top: 0.15rem;
		font-size: 0.76rem;
		font-variant-numeric: tabular-nums;
		color: var(--text-dim);
	}

	.cl-rel-main {
		min-width: 0;
		flex: 1;
	}

	.cl-rel-title {
		margin: 0 0 0.25rem;
		font-size: 1rem;
		font-weight: 700;
		color: var(--text);
		line-height: 1.3;
	}

	.cl-rel-summary {
		margin: 0 0 0.5rem;
		font-size: 0.88rem;
		line-height: 1.55;
		color: var(--text-muted);
		max-width: 68ch;
	}

	.cl-rel-cats {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
	}

	.cl-chip {
		font-size: 0.68rem;
		font-weight: 700;
		letter-spacing: 0.02em;
		text-transform: uppercase;
		padding: 0.15rem 0.45rem;
		border-radius: 6px;
		background: var(--surface-2);
		border: 1px solid var(--border);
		color: var(--text-dim);
	}

	.cl-rel-toggle {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		min-height: 36px;
		margin-top: 0.6rem;
		padding: 0.3rem 0.1rem;
		background: none;
		border: none;
		color: var(--accent-text);
		font-size: 0.8rem;
		font-weight: 600;
		cursor: pointer;
	}

	.cl-rel-toggle:hover {
		text-decoration: underline;
	}

	.cl-rel-toggle:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
		border-radius: 6px;
	}

	.cl-rel-chevron {
		transition: transform 0.18s ease;
	}

	.cl-rel-chevron.open {
		transform: rotate(90deg);
	}

	@media (prefers-reduced-motion: reduce) {
		.cl-rel-chevron {
			transition: none;
		}
	}

	@media (max-width: 640px) {
		.cl-rel-head {
			flex-direction: column;
			gap: 0.35rem;
		}
		.cl-rel-date {
			min-width: 0;
		}
	}

	.cl-controls {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-4);
		margin-bottom: var(--space-5);
	}
	.cl-majors {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.85rem;
		color: var(--text-muted);
		text-transform: none;
		letter-spacing: normal;
		font-weight: var(--weight-medium);
		cursor: pointer;
		min-height: 44px;
	}
	.cl-majors input {
		width: 17px;
		height: 17px;
		accent-color: var(--accent);
	}
	.cl-count {
		font-family: var(--font-mono);
		font-size: 0.72rem;
		color: var(--text-dim);
		font-variant-numeric: tabular-nums;
	}
	.cl-empty {
		color: var(--text-dim);
		padding: var(--space-6) 0;
	}
	.cl-month {
		margin-bottom: var(--space-6);
	}
	.cl-month-title {
		font-family: var(--font-body);
		font-size: 0.95rem;
		font-weight: 700;
		color: var(--text);
		margin: 0 0 var(--space-3);
		padding-bottom: 6px;
		border-bottom: 1px solid var(--border-strong);
		position: sticky;
		top: 118px;
		background: var(--bg);
		z-index: var(--z-content);
	}
	.cl-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
	}
	.cl-entry {
		display: grid;
		grid-template-columns: 64px 92px 1fr;
		gap: var(--space-3);
		align-items: baseline;
		padding: 0.42rem 0.5rem;
		border-radius: var(--radius-xs);
		font-size: 0.86rem;
	}
	.cl-entry:nth-child(even) {
		background: color-mix(in srgb, var(--surface-2) 55%, transparent);
	}
	.cl-entry.milestone {
		background: var(--accent-soft);
		border-left: 3px solid var(--accent);
		padding-left: calc(0.5rem - 3px);
	}
	.cl-date {
		font-family: var(--font-mono);
		font-size: 0.7rem;
		color: var(--text-dim);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.cl-date-sep {
		opacity: 0.5;
	}
	.cl-type {
		font-family: var(--font-mono);
		font-size: 0.62rem;
		text-transform: uppercase;
		letter-spacing: 0.07em;
		border-radius: var(--radius-full);
		padding: 2px 8px;
		text-align: center;
		white-space: nowrap;
		background: var(--surface-3);
		color: var(--text-muted);
	}
	.cl-type-feat {
		background: var(--success-soft);
		color: var(--success-text);
	}
	.cl-type-fix {
		background: var(--warning-soft);
		color: var(--warning-text);
	}
	.cl-type-perf {
		background: var(--cyan-soft);
		color: var(--cyan-text);
	}
	.cl-type-redesign,
	.cl-type-polish {
		background: var(--accent-soft);
		color: var(--accent-text);
	}
	.cl-text {
		color: var(--text);
		line-height: 1.5;
		min-width: 0;
	}
	.cl-scope {
		font-family: var(--font-mono);
		font-size: 0.72rem;
		color: var(--accent-text);
		margin-right: 0.45rem;
	}
	.cl-milestone-note {
		display: block;
		font-size: 0.78rem;
		color: var(--accent-text);
		font-weight: var(--weight-semi);
		margin-top: 2px;
	}
	@media (max-width: 768px) {
		.cl-entry {
			grid-template-columns: 56px 1fr;
		}
		.cl-type {
			display: none;
		}
	}

	/* ── Roadmap ──────────────────────────────────────────────────── */
	.rm-body {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: var(--space-5);
		align-items: start;
		padding: var(--space-6) var(--space-8) var(--space-16);
		width: 100%;
	}
	.rm-lane {
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		padding: var(--space-4);
	}
	.rm-lane-head {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		flex-wrap: wrap;
		margin-bottom: var(--space-4);
		padding-bottom: var(--space-2);
		border-bottom: 1px solid var(--border-strong);
	}
	.rm-lane-title {
		font-family: var(--font-body);
		font-size: 0.9rem;
		font-weight: 700;
		margin: 0;
	}
	.rm-in-progress .rm-lane-title {
		color: var(--cyan-text);
	}
	.rm-planned .rm-lane-title {
		color: var(--accent-text);
	}
	.rm-exploring .rm-lane-title {
		color: var(--text-muted);
	}
	.rm-lane-hint {
		font-size: 0.72rem;
		color: var(--text-dim);
	}
	.rm-lane-count {
		margin-left: auto;
		font-family: var(--font-mono);
		font-size: 0.72rem;
		color: var(--text-dim);
		font-variant-numeric: tabular-nums;
	}
	.rm-card {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		padding: var(--space-4);
		margin-bottom: var(--space-3);
	}
	.rm-area {
		font-family: var(--font-mono);
		font-size: 0.6rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--text-dim);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-full);
		padding: 2px 8px;
	}
	.rm-card-title {
		font-family: var(--font-body);
		font-size: 0.92rem;
		font-weight: 700;
		color: var(--text);
		margin: 0.55rem 0 0.3rem;
	}
	.rm-card-detail {
		font-size: 0.82rem;
		color: var(--text-muted);
		line-height: 1.55;
		margin: 0;
	}
	@media (max-width: 1000px) {
		.rm-body {
			grid-template-columns: 1fr;
		}
	}


	/* The List/Board switch reuses the persona page's class names, but Svelte
	   scopes styles per component — without these it rendered as bare default
	   buttons. Same visual contract as the Docs tabs above it. */
	.feed-view-toggle {
		display: inline-flex;
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-sm);
		overflow: hidden;
		background: var(--surface);
	}
	.view-toggle-btn {
		border: none;
		background: none;
		cursor: pointer;
		font-size: 0.82rem;
		font-weight: var(--weight-semi);
		color: var(--text-dim);
		padding: 0 1rem;
		min-height: 44px;
	}
	.view-toggle-btn:hover {
		color: var(--text);
		background: var(--surface-2);
	}
	.view-toggle-btn.active {
		color: var(--accent-text);
		background: var(--accent-soft);
	}
	.view-toggle-btn:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: -2px;
	}
	/* ── User Voice ───────────────────────────────────────────────── */
	.uv-body { max-width: 1080px; margin: 0 auto; padding: var(--space-6) var(--space-8) var(--space-16); width: 100%; }
	.uv-controls { display: flex; align-items: center; gap: var(--space-4); margin-bottom: var(--space-4); flex-wrap: wrap; }
	.uv-count { font-family: var(--font-mono); font-size: 0.72rem; color: var(--text-dim); font-variant-numeric: tabular-nums; }
	.uv-add-btn { margin-left: auto; min-height: 44px; padding: 0 1.1rem; border-radius: var(--radius-sm); border: none; background: var(--gradient-cta); color: #fff; font-weight: var(--weight-semi); font-size: 0.85rem; cursor: pointer; }
	.uv-add-btn:hover { box-shadow: var(--shadow-accent); }
	.uv-add-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
	.uv-form { background: var(--surface); border: 1px solid var(--accent-mid); border-radius: var(--radius-sm); padding: var(--space-5); margin-bottom: var(--space-5); display: flex; flex-direction: column; gap: var(--space-2); }
	.uv-label { font-size: var(--text-sm); text-transform: none; letter-spacing: normal; font-weight: var(--weight-semi); color: var(--text-muted); margin-bottom: 0; }
	.uv-optional { font-weight: var(--weight-normal); color: var(--text-dim); }
	.uv-form-foot { display: flex; align-items: center; justify-content: space-between; gap: var(--space-4); flex-wrap: wrap; margin-top: var(--space-2); }
	.uv-hint { font-size: 0.76rem; color: var(--text-dim); }
	.uv-submit { min-height: 44px; padding: 0 1.3rem; border-radius: var(--radius-sm); border: none; background: var(--gradient-cta); color: #fff; font-weight: var(--weight-semi); cursor: pointer; }
	.uv-submit:disabled { opacity: 0.5; cursor: not-allowed; }
	.uv-submit:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
	.uv-error { background: var(--warning-soft); color: var(--warning-text); border-radius: var(--radius-sm); padding: var(--space-3) var(--space-4); font-size: 0.85rem; margin-bottom: var(--space-4); line-height: 1.55; }
	.uv-retry { margin-left: 0.6rem; border: 1px solid var(--warning); background: none; color: var(--warning-text); border-radius: var(--radius-xs); padding: 2px 10px; min-height: 32px; cursor: pointer; font-weight: var(--weight-semi); }
	.uv-empty { color: var(--text-dim); padding: var(--space-8) 0; text-align: center; }
	.uv-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-3); }
	.uv-row { display: grid; grid-template-columns: 56px 1fr; gap: var(--space-4); background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: var(--space-4); }
	.uv-votes { display: flex; flex-direction: column; align-items: center; gap: 2px; }
	.uv-vote { width: 44px; height: 44px; display: inline-flex; align-items: center; justify-content: center; border: 1px solid var(--border-strong); background: transparent; color: var(--text-dim); border-radius: var(--radius-xs); cursor: pointer; }
	.uv-vote:hover { color: var(--text); background: var(--surface-2); }
	.uv-vote.up.on { background: var(--success-soft); color: var(--success-text); border-color: var(--success); }
	.uv-vote.down.on { background: var(--error-soft); color: var(--error-text); border-color: var(--error); }
	.uv-vote:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
	.uv-score { font-family: var(--font-mono); font-weight: 700; font-size: 0.95rem; font-variant-numeric: tabular-nums; color: var(--success-text); }
	.uv-score.neg { color: var(--error-text); }
	.uv-main { min-width: 0; }
	.uv-title-row { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
	.uv-title { font-size: 0.95rem; color: var(--text); }
	.uv-status { font-family: var(--font-mono); font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.08em; border-radius: var(--radius-full); padding: 2px 8px; background: var(--surface-3); color: var(--text-muted); }
	.uv-status-planned { background: var(--accent-soft); color: var(--accent-text); }
	.uv-status-in-progress { background: var(--cyan-soft); color: var(--cyan-text); }
	.uv-status-shipped { background: var(--success-soft); color: var(--success-text); }
	.uv-status-declined { background: var(--error-soft); color: var(--error-text); }
	.uv-mine { font-family: var(--font-mono); font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--gold); border: 1px solid color-mix(in srgb, var(--gold) 40%, transparent); border-radius: var(--radius-full); padding: 2px 8px; }
	.uv-detail { margin: 0.35rem 0 0; font-size: 0.84rem; color: var(--text-muted); line-height: 1.55; max-width: 78ch; }
	.uv-meta { display: inline-flex; align-items: center; gap: 0.45rem; margin-top: 0.45rem; font-size: 0.72rem; color: var(--text-dim); font-variant-numeric: tabular-nums; }
	.uv-del { border: none; background: none; color: var(--error-text); font-size: 0.72rem; font-weight: var(--weight-semi); cursor: pointer; min-height: 32px; padding: 0 0.4rem; }
	.uv-del:focus-visible { outline: 2px solid var(--error); outline-offset: 2px; }
	.uv-board { display: grid; grid-template-columns: repeat(5, 1fr); gap: var(--space-3); align-items: start; }
	.uv-lane { background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: var(--space-3); }
	.uv-lane-head { display: flex; align-items: baseline; justify-content: space-between; gap: 0.5rem; margin-bottom: var(--space-3); padding-bottom: var(--space-2); border-bottom: 1px solid var(--border-strong); }
	.uv-lane-title { font-family: var(--font-mono); font-size: 0.62rem; text-transform: uppercase; letter-spacing: 0.08em; margin: 0; background: none; padding: 0; }
	.uv-lane-count { font-family: var(--font-mono); font-size: 0.68rem; color: var(--text-dim); font-variant-numeric: tabular-nums; }
	.uv-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-xs); padding: var(--space-3); margin-bottom: var(--space-2); }
	.uv-card-score { font-family: var(--font-mono); font-size: 0.7rem; font-weight: 700; color: var(--success-text); font-variant-numeric: tabular-nums; }
	.uv-card-score.neg { color: var(--error-text); }
	.uv-card-title { display: block; font-size: 0.8rem; color: var(--text); margin-top: 2px; line-height: 1.4; }
	.uv-card-detail { margin: 0.3rem 0 0; font-size: 0.72rem; color: var(--text-dim); line-height: 1.45; display: -webkit-box; -webkit-line-clamp: 3; line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
	.uv-lane-empty { font-size: 0.72rem; color: var(--text-dim); text-align: center; padding: 0.6rem 0; }
	@media (max-width: 1100px) { .uv-board { grid-template-columns: repeat(2, 1fr); } }
	@media (max-width: 640px) { .uv-board { grid-template-columns: 1fr; } }

	/* ── Docs home + provider axis ─────────────────────────────────────────── */
	.gd-pager.hidden {
		display: none;
	}
	.rail-home {
		margin: 0.3rem 0 0;
		font-size: var(--text-sm);
		color: var(--text-dim);
		line-height: var(--leading-snug);
	}
	.nav-home {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		width: 100%;
		padding: 0.5rem 0.6rem;
		margin-bottom: 0.35rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: var(--surface);
		color: var(--text);
		font: inherit;
		font-size: var(--text-base);
		font-weight: 600;
		cursor: pointer;
	}
	.nav-home:hover,
	.nav-home.active {
		border-color: var(--accent);
		background: var(--accent-soft);
		color: var(--accent-text);
	}
	.nav-provider {
		display: grid;
		gap: 0.25rem;
		margin: 0.35rem 0 0.2rem;
	}
	.nav-provider-label {
		font-size: var(--text-xs);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--text-dim);
	}
	.nav-provider select {
		width: 100%;
		padding: 0.45rem 0.6rem;
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-sm);
		background: var(--surface);
		color: var(--text);
		font: inherit;
		font-size: var(--text-base);
	}
	.nav-provider select:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 1px;
	}
	.nav-provider-role {
		margin: 0 0 0.5rem;
		font-size: var(--text-xs);
		color: var(--text-dim);
		line-height: var(--leading-snug);
	}
	.article-back {
		border: 0;
		background: none;
		padding: 0;
		margin-bottom: 0.6rem;
		font: inherit;
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--text-dim);
		cursor: pointer;
	}
	.article-back:hover {
		color: var(--accent-text);
	}
	.article-providers {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		margin: 0.4rem 0 0;
	}
	.article-provider {
		padding: 0.15rem 0.55rem;
		border-radius: 999px;
		border: 1px solid var(--border-strong);
		background: var(--surface);
		font: inherit;
		font-size: var(--text-xs);
		font-weight: 700;
		color: var(--text-muted);
		cursor: pointer;
	}
	.article-provider:hover {
		border-color: var(--accent);
		color: var(--accent-text);
	}

	.gd-home {
		display: grid;
		gap: 2rem;
	}
	.gd-home h2 {
		margin: 0 0 0.25rem;
	}
	.gd-home h3 {
		margin: 0 0 0.25rem;
		font-size: var(--text-lg);
	}
	.home-lede {
		margin: 0 0 0.9rem;
		color: var(--text-muted);
		font-size: var(--text-base);
	}
	.home-path {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.5rem;
	}
	.home-path-btn {
		display: grid;
		grid-template-columns: 2rem 1fr;
		gap: 0.75rem;
		align-items: start;
		width: 100%;
		text-align: left;
		padding: 0.8rem 0.9rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-md, 12px);
		background: var(--surface);
		font: inherit;
		color: var(--text);
		cursor: pointer;
		transition:
			border-color 0.15s,
			box-shadow 0.15s;
	}
	.home-path-btn:hover {
		border-color: var(--accent);
		box-shadow: var(--shadow-md);
	}
	.home-path-n {
		width: 2rem;
		height: 2rem;
		border-radius: 50%;
		display: grid;
		place-items: center;
		background: var(--accent-dark);
		color: #fff;
		font-weight: 700;
		font-size: var(--text-sm);
	}
	.home-path-text {
		display: grid;
		gap: 0.15rem;
	}
	.home-path-title {
		font-weight: 700;
		font-size: var(--text-md);
	}
	.home-path-when {
		color: var(--text-dim);
		font-size: var(--text-sm);
		line-height: var(--leading-snug);
	}
	.home-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
		gap: 0.6rem;
	}
	.home-card {
		display: grid;
		gap: 0.25rem;
		text-align: left;
		padding: 0.8rem 0.9rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-md, 12px);
		background: var(--surface);
		font: inherit;
		color: var(--text);
		cursor: pointer;
		transition:
			border-color 0.15s,
			box-shadow 0.15s;
	}
	.home-card:hover {
		border-color: var(--accent);
		box-shadow: var(--shadow-md);
	}
	.home-card-title {
		font-weight: 700;
	}
	.home-card-count {
		font-size: var(--text-xs);
		color: var(--accent-text);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}
	.home-card-list {
		font-size: var(--text-sm);
		color: var(--text-dim);
		line-height: var(--leading-snug);
	}
	.home-prov-row {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
		gap: 0.6rem;
	}
	.home-prov {
		display: grid;
		gap: 0.2rem;
		text-align: left;
		padding: 0.75rem 0.85rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-md, 12px);
		background: var(--surface);
		font: inherit;
		color: var(--text);
		cursor: pointer;
	}
	.home-prov:hover,
	.home-prov.active {
		border-color: var(--accent);
		background: var(--accent-soft);
	}
	.home-prov-name {
		font-weight: 700;
	}
	.home-prov-role {
		font-size: var(--text-xs);
		color: var(--text-dim);
		line-height: var(--leading-snug);
	}
	.home-prov-count {
		font-size: var(--text-xs);
		font-weight: 700;
		color: var(--accent-text);
	}
	.home-prov-list {
		list-style: none;
		margin: 0.8rem 0 0;
		padding: 0;
		display: grid;
		gap: 0.25rem;
	}
	.home-prov-link {
		display: flex;
		align-items: baseline;
		gap: 0.6rem;
		width: 100%;
		text-align: left;
		padding: 0.5rem 0.7rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: var(--surface);
		font: inherit;
		font-size: var(--text-base);
		font-weight: 600;
		color: var(--text);
		cursor: pointer;
	}
	.home-prov-link:hover {
		border-color: var(--accent);
		color: var(--accent-text);
	}
	.home-prov-link-cat {
		font-size: var(--text-xs);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-dim);
		white-space: nowrap;
	}

	@media (prefers-reduced-motion: reduce) {
		.nav-chevron {
			transition: none;
		}
	}
	/* On a phone the masthead wraps to ~250px; sticky, it covered the guide a
	   help link had just scrolled to (round-3 re-audit). It scrolls away there. */
	@media (max-width: 768px) {
		.gd-top {
			position: static;
		}
		.gd-article {
			scroll-margin-top: var(--space-4);
		}
	}
	/* Four docs tabs did not fit a 320px phone: "User Voice" was 3% visible
	   inside an overflow:hidden pill (round-4 re-audit). Scroll, never clip. */
	.gd-docs-nav {
		max-width: 100%;
	}
	@media (max-width: 480px) {
		.gd-docs-nav {
			flex-wrap: wrap;
		}
	}
</style>
