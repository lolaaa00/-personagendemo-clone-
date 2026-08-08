<script lang="ts">
	import { onMount } from 'svelte';

	// ── Guide catalog ────────────────────────────────────────────────────────
	// Static, code-defined how-tos with real app screenshots (static/guide-shots,
	// captured against the seeded harness account — no client data). Every step
	// names the REAL buttons and tabs as they appear in the app; screenshots are
	// re-captured with node_modules/.verify-tmp-style Playwright passes when the
	// UI changes. This page is user documentation, not marketing.
	interface Step {
		t: string;
		img?: string; // filename (no extension) in /guide-shots/
		alt?: string;
	}
	interface Guide {
		id: string;
		category: string;
		title: string;
		when: string; // "you need this when…" — symptom-first, in the user's words
		steps: Step[];
		tip?: string;
	}

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
			steps: [
				{
					t: 'Everything lives in the left sidebar, in five groups: Network (Dashboard) · Library (All Generations, My Favorites) · Personas (your creators + New Persona) · Publish (Review Queue, Calendar) · Setup (Brand Brief, Model Manager, Guides, Settings).',
					img: 'sidebar-guides',
					alt: 'The PersonaGen sidebar with its five navigation groups'
				},
				{
					t: 'The Dashboard is your home base: persona health, engagement charts, and quick actions.',
					img: 'dashboard',
					alt: 'The Dashboard page with KPIs and the persona roster'
				},
				{ t: 'The moon/sun button in the top-right switches dark and light mode. Your name next to it opens the menu with Log Out.' },
				{ t: 'Stuck anywhere? Come back to this Guides page (Setup → Guides) and use the search box.' }
			]
		},
		{
			id: 'daily-routine',
			category: 'Getting started',
			title: 'The 5-minute daily routine',
			when: 'Every day. This is the whole job once your creators are set up.',
			steps: [
				{
					t: 'Open Review Queue in the left sidebar — your creators’ new drafts are waiting there.',
					img: 'review-queue',
					alt: 'The Review Queue page'
				},
				{ t: 'For each draft: read the caption, look at the image or play the video.' },
				{ t: 'Approve the good ones. Use the caption’s edit control to reword it first if you want — what you write is exactly what gets published.' },
				{ t: 'Reject the misses and pick a reason ("Bad caption", "Off-brand look"…). Rejecting is free — the creator makes a replacement, and your reasons teach it your taste.' },
				{
					t: 'Glance at Calendar to see when approved posts go out. Done.',
					img: 'calendar',
					alt: 'The Content Calendar in month view'
				}
			],
			tip: 'Nothing ever posts without your approval while a creator is in Semi-Autonomous mode (the default).'
		},
		{
			id: 'brand-brief',
			category: 'Getting started',
			title: 'Fix your brand voice in one place',
			when: 'Captions feel off-brand, or a product is missing / has no photo.',
			steps: [
				{
					t: 'Open Brand Brief (sidebar → Setup). Tabs across the top cover Overview · Products & UGC · Visual Identity · Voice & Tone · Target Audience · Competitors.',
					img: 'brand-brief',
					alt: 'The Brand Brief page with its tabs'
				},
				{ t: 'On Overview you can paste your store URL into the scraper card and click Scrape & Populate — it fills the brief from your website.' },
				{ t: 'Read what’s written: this is what your creators believe about your brand. Edit anything that’s off. One fix here changes every future post from every creator.' },
				{ t: 'Most fields have Generate and Spin buttons — Spin offers numbered variations; click one to apply it.' },
				{ t: 'Check Products & UGC: every product needs a photo — that’s what creators hold and show on camera.' },
				{ t: 'Click Save (top right). New drafts use the corrected version immediately.' }
			]
		},
		{
			id: 'meet-creators',
			category: 'Getting started',
			title: 'Tour a creator’s page',
			when: 'You want to understand what a persona is and what each tab does.',
			steps: [
				{
					t: 'Pick a creator under Personas in the sidebar. The top shows their identity, stats, and a ♥ to favorite them. Three tabs below: Profile · Content · Studio.',
					img: 'persona-profile',
					alt: 'A persona page open on the Profile tab'
				},
				{ t: 'Profile tab — who they are: Brand Kit, Persona Profile, Platform Identity Kit, Character & Visuals (picture + reference kit), Automation (schedule, voice, autonomy), and Spend. A toggle at the top switches to the Connections view (their linked social accounts).' },
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
			id: 'new-persona',
			category: 'Getting started',
			title: 'Create a new persona',
			when: 'You want another AI creator for a different audience or product line.',
			steps: [
				{
					t: 'Click New Persona in the sidebar (the dashed + button). A 3-step wizard opens: Identity → Persona → Review.',
					img: 'generator',
					alt: 'The Create a Persona wizard on step 1'
				},
				{ t: 'Step 1 — Identity: pick your brand brief, optionally type a direction ("busy mom, gentle humor"), and click Generate persona for this brand. Or open the Vault to get 3 ready-made options and pick one.' },
				{ t: 'Step 2 — Persona: review and tweak the personality, voice, content skills, and audience fields.' },
				{ t: 'Step 3 — Review & Create: check the summary and click Create Persona.' },
				{ t: 'The new creator appears in the sidebar. Next: give them a face (reference kit guide) and connect an account when ready.' }
			]
		},

		// ── Keys & credits ───────────────────────────────────────────────────
		{
			id: 'openrouter-key',
			category: 'Keys & credits',
			title: 'Get an OpenRouter key (fixes "out of credits")',
			when: 'Content generation fails with a message like "Generation failed via openrouter", "402", or "insufficient credits". OpenRouter is the service that writes captions and scripts — when its credits run out, generation stops until you connect your own key.',
			steps: [
				{ t: 'Go to openrouter.ai and sign in (Google sign-in works, no card needed yet).' },
				{ t: 'Open openrouter.ai/settings/keys and click Create Key. Give it any name (e.g. "PersonaGen").' },
				{ t: 'Copy the key — it starts with sk-or-v1-… and is shown only once. Keep the tab open until you’ve pasted it.' },
				{ t: 'Add credits at openrouter.ai/settings/credits → Add Credits. $10–20 covers a lot of caption writing.' },
				{
					t: 'Back in PersonaGen: open Settings (sidebar → Setup) and click Provider API Keys in the left menu of the Settings page.',
					img: 'settings-apikeys',
					alt: 'The Provider API Keys section in Settings'
				},
				{
					t: 'Find the OpenRouter card, paste your key into the "Paste your OpenRouter API key" box, and click Save Key. Use Test Connection to confirm — the badge flips from NOT SAVED to saved.',
					img: 'settings-openrouter',
					alt: 'The OpenRouter key card with Save Key and Test Connection buttons'
				},
				{ t: 'Retry whatever failed — generate a post or approve a draft. It uses your key from now on.' }
			],
			tip: 'Your key is stored encrypted and never shown again after saving. Watch your usage anytime at openrouter.ai/activity.'
		},
		{
			id: 'all-keys',
			category: 'Keys & credits',
			title: 'What each API key powers',
			when: 'You’re looking at Provider API Keys in Settings and wondering what’s what.',
			steps: [
				{
					t: 'Open Settings → Provider API Keys (left menu inside Settings). Each service has its own card with Save Key / Test Connection / Delete Key.',
					img: 'settings-apikeys',
					alt: 'The provider key cards in Settings'
				},
				{ t: 'Zernio — publishing. Connects social accounts and sends approved posts to them. Without it, nothing publishes.' },
				{ t: 'Fal AI — pictures, video, and voice. Generates the images, videos, and spoken audio in your posts.' },
				{ t: 'OpenRouter — writing. Captions, scripts, ideas (also a backup route for media). See the OpenRouter guide if it runs out of credits.' },
				{ t: 'Gemini — alternative writing engine; either OpenRouter or Gemini is enough.' },
				{ t: 'Firecrawl — brand reading. Powers "Scrape & Populate" in the Brand Brief.' },
				{ t: 'Settings also has a Zernio Key Manager section: add extra Zernio keys (each is its own account with its own 2 free slots) and assign specific personas to them.' }
			],
			tip: 'A card with a red status shows the reason right there — fix it on the card rather than guessing.'
		},
		{
			id: 'zernio-billing',
			category: 'Keys & credits',
			title: 'Understand publishing billing (per connected account)',
			when: 'You’re deciding how many social accounts to connect.',
			steps: [
				{ t: 'Publishing is billed per connected social account, metered daily — not per post.' },
				{ t: 'Your first 2 connected accounts on a key are free; beyond that it’s about $6/account/month (cheaper at volume).' },
				{
					t: 'The Connections view (creator’s Profile tab → Connections toggle) shows a live meter of what your connected accounts cost.',
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
			steps: [
				{
					t: 'Open the creator’s page → Content tab, and click Generate Now. (The Calendar page’s Generate Post Now button works too.)',
					img: 'persona-content',
					alt: 'The Content tab with the Generate Now button'
				},
				{
					t: 'The composer opens. Nothing is spent until you approve: review the topic, pick Image / Video, and check the price preview at the bottom ("Pipeline that will run" with the estimated cost).',
					img: 'composer',
					alt: 'The generation composer with the cost preview'
				},
				{ t: 'Click Approve & generate. It runs in the background with progress shown — a minute or two for images, a few minutes for video.' },
				{ t: 'The finished post appears as a Draft. Edit the caption if you like, then approve it like any other draft.' }
			],
			tip: 'Video posts come with the creator’s own voice and sound. Cinematic is the premium multi-scene format — best for hero content.'
		},
		{
			id: 'composer-costs',
			category: 'Creating content',
			title: 'The composer: approve exactly what you spend',
			when: 'You want control over what a generation costs and what gets sent to the AI.',
			steps: [
				{
					t: 'Every generation opens this composer first — nothing is spent until you click Approve & generate.',
					img: 'composer',
					alt: 'The generation composer'
				},
				{ t: '"Prompt sent to the model" shows the exact text the AI receives — edit it if you want something specific.' },
				{ t: '"Pipeline that will run" lists each step with its model and estimated dollar cost, plus a live total.' },
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
			steps: [
				{
					t: 'Open the creator’s page → Studio tab. Twelve ready-made templates — This Saved Me, Before & After, Unboxing Reveal, TV Spot, and more — filtered by UGC / Product / Cinematic / Stills.',
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
			title: 'Keep a creator’s face consistent (reference kit)',
			when: 'A creator’s kit tiles are empty, or their look varies between posts.',
			steps: [
				{
					t: 'Open the creator’s page → Profile tab → Character & Visuals section.',
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
			title: 'Choose a creator’s voice',
			when: 'You want to hear or change how a creator sounds in videos.',
			steps: [
				{ t: 'Open the creator’s page → Profile tab → Automation section.' },
				{ t: 'The UGC Voice dropdown lists the catalog; press the preview button to hear the current one.' },
				{ t: 'Pick a different voice if it doesn’t fit — voices are matched to the creator, and no two creators sound alike.' },
				{ t: 'Save Profile. New videos use the new voice.' }
			]
		},
		{
			id: 'identity-kit',
			category: 'Creating content',
			title: 'Generate bios & usernames (Platform Identity Kit)',
			when: 'You’re setting up a creator’s social profiles and want ready-to-paste bios and handle ideas.',
			steps: [
				{ t: 'Open the creator’s page → Profile tab → Platform Identity Kit section.' },
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
			when: 'A creator’s approved posts should start going to a real account.',
			steps: [
				{
					t: 'Open the creator’s page → Profile tab → switch the toggle from Profile to Connections.',
					img: 'connections',
					alt: 'The Connections view of a persona'
				},
				{ t: 'Click + Connect on the platform (Instagram, TikTok, YouTube… 15 supported) and log in to the account in the window that opens — a normal social-media login, nothing technical.' },
				{ t: 'A green badge appears with the handle, follower count, and last sync. From now on, this creator’s approved posts publish there automatically.' },
				{ t: 'If a platform ever needs re-linking (password change, expired session), a Reconnect badge appears here — one click fixes it.' }
			],
			tip: 'You can approve drafts before connecting — they simply wait, and publish once an account exists.'
		},
		{
			id: 'schedule-autonomy',
			category: 'Publishing',
			title: 'Set the posting schedule & autonomy',
			when: 'You want to control how often and when a creator posts.',
			steps: [
				{ t: 'Open the creator’s page → Profile tab → Automation section.' },
				{ t: 'Set Posts Per Day and the Timezone — posts spread across the creator’s posting window on their local clock, so match it to the audience.' },
				{ t: 'Autonomy: Advisor = manual only · Semi-Autonomous = drafts wait for your approval (recommended) · Fully Autonomous = publishes unattended (the app asks you to confirm before switching).' },
				{ t: 'Content Source: Dynamic Generation (the AI invents on-brand topics) or RSS Auto-Repurpose (paste a feed URL and the creator turns articles into posts).' },
				{ t: 'Save Profile. The schedule starts filling from the next cycle.' }
			]
		},
		{
			id: 'confirm-live',
			category: 'Publishing',
			title: 'Confirm a post is really live',
			when: 'A post’s time has passed and you want proof it published.',
			steps: [
				{ t: 'Open the post (Calendar or the creator’s Content tab).' },
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
			steps: [
				{
					t: 'Open Calendar and click the post. Use ‹ › and the Day | Week | Month switch to find it; the Personas rail filters by creator.',
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
			steps: [
				{ t: 'Open the post and click Delete (it asks "Confirm delete?").' },
				{ t: 'Platforms that allow removal by software are taken down automatically.' },
				{ t: 'Instagram doesn’t allow apps to delete posts — for those the panel shows the direct link: open the post on Instagram → ⋯ → Delete. Ten seconds.' }
			]
		},

		// ── Library & organization ───────────────────────────────────────────
		{
			id: 'all-generations',
			category: 'Library & organization',
			title: 'Browse everything your creators made',
			when: 'You’re hunting for a specific image or video, across all creators.',
			steps: [
				{
					t: 'Open All Generations (sidebar → Library). Two lenses at the top: Content outputs (posts) and Profile assets (profile pictures + reference-kit images — this is the only place those appear together).',
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
			when: 'You want your best posts and go-to creators one tap away.',
			steps: [
				{ t: 'Tap the ♥ on any post card (in a creator’s Content tab or All Generations) to favorite the post.' },
				{ t: 'Tap the ♥ next to a creator’s name at the top of their page to favorite the creator.' },
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
			when: 'You have many creators and the sidebar list is getting long.',
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
			steps: [
				{
					t: 'The Review Queue has five views (buttons at the top): Table (bulk-first) · Split (list + preview) · Deck (one card at a time) · Board (pipeline lanes) · Grid. Your choice is remembered.',
					img: 'review-queue',
					alt: 'The Review Queue'
				},
				{ t: 'Keyboard triage in Table/Split/Deck: j / k move · a approve · r reject · o open · z zoom. Hands never leave the keyboard.' },
				{ t: 'Select several posts and use the bulk bar: Approve & Schedule (N), Reject (N), or Delete selected.' },
				{ t: 'The Board view has a "Flagged · QC < 6.0" lane — the automated quality score surfaces the weakest drafts for you.' },
				{ t: 'Filters at the top narrow by persona, platform, and Draft vs Scheduled.' }
			]
		},
		{
			id: 'model-manager',
			category: 'Power tools',
			title: 'Model Manager: control quality & cost',
			when: 'You want to choose which AI models your creators use, or cut generation costs.',
			steps: [
				{
					t: 'Open Model Manager (sidebar → Setup). Tabs split models by type: Image · Image Edit · Video · Voice.',
					img: 'models',
					alt: 'The Model Manager roster'
				},
				{ t: 'Your roster shows each model’s release age, price per call, latency, and a 1–10 quality score — with a Value ranking (quality ÷ price) and a BEST VALUE pill.' },
				{ t: 'The Enabled switch controls which models appear in the composer; the ★ star sets the default.' },
				{ t: 'Sort by "Best value" to find cheap-but-good; price and quality are editable inline if your experience differs.' },
				{ t: '"Check for new models" scans for newly released models; discovered ones can be probed for compatibility before adoption.' }
			]
		},
		{
			id: 'intel-wizard',
			category: 'Power tools',
			title: 'Run the Content Intelligence wizard',
			when: 'You want a content strategy — pillars, posting schedule, platform priorities — built from your brand and competitors.',
			steps: [
				{
					t: 'Open Brand Brief and click the Intel Wizard link beside the tabs. It’s a 6-step wizard; your answers are kept as you go.',
					img: 'intel-wizard',
					alt: 'The Content Intelligence & Strategy Wizard'
				},
				{ t: 'Steps 1–4: confirm your brand & audience, add competitor URLs, paste any existing content, and tag audience interests.' },
				{ t: 'Step 5: review the summary and click Generate Strategy.' },
				{ t: 'Step 6: your report — Content Pillars, a Posting Schedule table, Platform Priority scores, and Growth Targets. Use it to set each creator’s cadence and topics.' }
			]
		},
		{
			id: 'restore-history',
			category: 'Power tools',
			title: 'Restore an older image',
			when: 'A regenerated profile picture or kit image was better before.',
			steps: [
				{ t: 'Profile pictures and every reference-kit stage keep full history — nothing is lost when you regenerate.' },
				{ t: 'On the creator’s Profile tab → Character & Visuals, click Restore on the profile picture or on any kit stage.' },
				{ t: 'The picker has two tabs: "This stage" (that image’s history) and "All images" (everything the creator has). Click the one you want back.' },
				{ t: 'Deleted images stay in your library too — restore works on them the same way.' }
			]
		},

		// ── Fixing problems ──────────────────────────────────────────────────
		{
			id: 'generation-failing',
			category: 'Fixing problems',
			title: 'Content generation keeps failing',
			when: 'Drafts error out, or the composer shows a failure message.',
			steps: [
				{ t: 'Read the message — it names the real cause (the app never hides errors).' },
				{ t: 'Mentions "openrouter", "402", or "credits" → your writing credits ran out. Follow the OpenRouter key guide in Keys & credits.' },
				{ t: 'Mentions "fal" or images/video failing → check the Fal AI card in Settings → Provider API Keys (Test Connection) and your fal.ai balance.' },
				{ t: 'Says "No AI provider configured" → add an OpenRouter or Gemini key in Settings.' },
				{ t: 'Fixed the cause? Just generate again — nothing is lost.' }
			]
		},
		{
			id: 'publish-failing',
			category: 'Fixing problems',
			title: 'A post shows Failed instead of Published',
			when: 'A scheduled post didn’t go out.',
			steps: [
				{ t: 'Open the post — the exact reason is written on it, per platform.' },
				{ t: 'Most common: the account needs re-linking. Creator’s Profile → Connections — a Reconnect badge marks the broken account; one click and a login fixes it.' },
				{ t: 'Then approve/retry the post. Posts that failed for a temporary reason (network hiccup) retry themselves automatically.' }
			],
			tip: 'A Partial label on a multi-platform post means some platforms succeeded — only the listed ones failed.'
		},
		{
			id: 'status-glossary',
			category: 'Fixing problems',
			title: 'What every label means',
			when: 'You see a label on a post and want to know if action is needed.',
			steps: [
				{ t: 'Generating — being created right now. Do nothing; it appears when ready.' },
				{ t: 'Draft — waiting for you in the Review Queue. Approve, edit, or reject.' },
				{ t: 'Scheduled — approved; goes out at its time slot. Nothing to do, or reschedule it.' },
				{ t: 'Publishing… — sent; waiting for the platform to confirm. Flips within minutes.' },
				{ t: 'Published — confirmed live; View live post opens the real thing.' },
				{ t: 'Partial — landed on some platforms, not others; open it to see each reason.' },
				{ t: 'Failed — didn’t go out; the post shows exactly why. Fix that, then retry.' },
				{ t: 'Rejected — you said no in review; a new draft replaces it.' }
			],
			tip: 'One promise throughout: no label ever claims more than the platform has confirmed, and nothing fails silently.'
		}
	];

	// ── Selection + search ───────────────────────────────────────────────────
	let selectedId = $state(GUIDES[0].id);
	let query = $state('');

	let filtered = $derived.by(() => {
		const q = query.trim().toLowerCase();
		if (!q) return GUIDES;
		return GUIDES.filter(
			(g) =>
				g.title.toLowerCase().includes(q) ||
				g.when.toLowerCase().includes(q) ||
				g.steps.some((s) => s.t.toLowerCase().includes(q))
		);
	});
	let selected = $derived(GUIDES.find((g) => g.id === selectedId) ?? GUIDES[0]);

	function pick(id: string) {
		selectedId = id;
		// Deep-linkable: support /guides#openrouter-key style links for support.
		history.replaceState(null, '', `#${id}`);
		document.getElementById('guide-article')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
	}

	onMount(() => {
		const hash = location.hash.replace('#', '');
		if (hash && GUIDES.some((g) => g.id === hash)) selectedId = hash;
	});
</script>

<svelte:head>
	<title>Guides — PersonaGen</title>
</svelte:head>

<div class="guides-page">
	<header class="guides-header">
		<h1>Guides</h1>
		<p>
			How to do everything in PersonaGen — step by step, with pictures. Pick a guide, follow the
			numbers.
		</p>
		<input
			type="search"
			placeholder="Search guides… (try: credits, connect, voice)"
			bind:value={query}
			aria-label="Search guides"
		/>
	</header>

	<div class="guides-body">
		<nav class="guides-index" aria-label="Guide list">
			{#each CATEGORIES as cat}
				{@const inCat = filtered.filter((g) => g.category === cat)}
				{#if inCat.length > 0}
					<div class="index-group">
						<span class="index-cat">{cat}</span>
						{#each inCat as g (g.id)}
							<button
								type="button"
								class="index-item"
								class:active={g.id === selectedId}
								onclick={() => pick(g.id)}
							>
								{g.title}
							</button>
						{/each}
					</div>
				{/if}
			{/each}
			{#if filtered.length === 0}
				<p class="index-empty">No guides match “{query}”.</p>
			{/if}
		</nav>

		<article class="guide-article" id="guide-article" aria-live="polite">
			<span class="article-cat">{selected.category}</span>
			<h2>{selected.title}</h2>
			<p class="article-when"><b>You need this when:</b> {selected.when}</p>
			<ol class="article-steps">
				{#each selected.steps as step}
					<li>
						{step.t}
						{#if step.img}
							<a
								class="step-shot-link"
								href={`/guide-shots/${step.img}.png`}
								target="_blank"
								rel="noopener"
								title="Open screenshot full size"
							>
								<img
									class="step-shot"
									src={`/guide-shots/${step.img}.png`}
									alt={step.alt ?? 'App screenshot for this step'}
									loading="lazy"
								/>
							</a>
						{/if}
					</li>
				{/each}
			</ol>
			{#if selected.tip}
				<p class="article-tip">💡 {selected.tip}</p>
			{/if}
		</article>
	</div>
</div>

<style>
	.guides-page {
		max-width: 1060px;
		margin: 0 auto;
		padding: 1.5rem 1.25rem 4rem;
	}
	.guides-header h1 {
		font-size: 1.6rem;
		font-weight: 700;
		color: var(--text);
		margin: 0 0 0.25rem;
	}
	.guides-header p {
		color: var(--text-muted);
		margin: 0 0 1rem;
		max-width: 60ch;
	}
	.guides-header input {
		width: 100%;
		max-width: 420px;
		padding: 0.55rem 0.9rem;
		border: 1px solid var(--border-strong);
		border-radius: 8px;
		background: var(--surface);
		color: var(--text);
		font-size: 0.92rem;
	}
	.guides-header input:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 1px;
	}

	.guides-body {
		display: grid;
		grid-template-columns: 280px 1fr;
		gap: 1.5rem;
		margin-top: 1.5rem;
		align-items: start;
	}
	@media (max-width: 800px) {
		.guides-body {
			grid-template-columns: 1fr;
		}
	}

	.guides-index {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		position: sticky;
		top: 1rem;
	}
	@media (max-width: 800px) {
		.guides-index {
			position: static;
		}
	}
	.index-group {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.index-cat {
		font-size: 0.7rem;
		font-weight: 700;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		color: var(--text-dim);
		padding: 0 0.6rem 0.3rem;
	}
	.index-item {
		text-align: left;
		border: none;
		background: none;
		color: var(--text-muted);
		font-size: 0.9rem;
		padding: 0.42rem 0.6rem;
		border-radius: 7px;
		cursor: pointer;
		line-height: 1.35;
	}
	.index-item:hover {
		background: var(--surface-2);
		color: var(--text);
	}
	.index-item.active {
		background: var(--accent-soft);
		color: var(--text);
		font-weight: 600;
	}
	.index-item:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 1px;
	}
	.index-empty {
		color: var(--text-dim);
		font-size: 0.9rem;
		padding: 0 0.6rem;
	}

	.guide-article {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 12px;
		padding: 1.5rem 1.75rem 1.75rem;
	}
	.article-cat {
		font-size: 0.7rem;
		font-weight: 700;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		color: var(--accent);
	}
	.guide-article h2 {
		font-size: 1.3rem;
		font-weight: 700;
		color: var(--text);
		margin: 0.3rem 0 0.6rem;
	}
	.article-when {
		color: var(--text-muted);
		font-size: 0.95rem;
		margin: 0 0 1.1rem;
		padding: 0.6rem 0.9rem;
		background: var(--surface-2);
		border-radius: 8px;
	}
	.article-when b {
		color: var(--text);
	}

	.article-steps {
		margin: 0;
		padding: 0;
		list-style: none;
		counter-reset: gstep;
		display: flex;
		flex-direction: column;
		gap: 0.8rem;
	}
	.article-steps li {
		counter-increment: gstep;
		position: relative;
		padding-left: 2.4rem;
		color: var(--text);
		font-size: 0.96rem;
		line-height: 1.55;
	}
	.article-steps li::before {
		content: counter(gstep);
		position: absolute;
		left: 0;
		top: 0.05rem;
		width: 1.6rem;
		height: 1.6rem;
		border-radius: 50%;
		background: var(--accent-soft);
		color: var(--accent);
		font-size: 0.82rem;
		font-weight: 700;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.step-shot-link {
		display: block;
		margin-top: 0.55rem;
		max-width: 640px;
	}
	.step-shot {
		display: block;
		width: 100%;
		height: auto;
		border: 1px solid var(--border-strong);
		border-radius: 8px;
		box-shadow: 0 2px 10px rgba(15, 23, 42, 0.07);
	}
	.step-shot-link:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
		border-radius: 8px;
	}

	.article-tip {
		margin: 1.2rem 0 0;
		padding: 0.7rem 1rem;
		background: var(--surface-2);
		border-left: 3px solid var(--accent);
		border-radius: 0 8px 8px 0;
		color: var(--text-muted);
		font-size: 0.92rem;
	}
</style>
