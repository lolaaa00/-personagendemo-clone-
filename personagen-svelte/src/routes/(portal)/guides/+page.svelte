<script lang="ts">
	import { onMount } from 'svelte';

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
				'Sidebar groups: Network · Library · Personas · Publish · Setup',
				'Home base is the Dashboard',
				'Moon button (top right) switches dark / light',
				'Lost? Setup → Guides + the search box',
			],
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
			facts: [
				'Where: Review Queue',
				'Takes about 5 minutes',
				'Approve = it posts · Reject = free redo',
				'Nothing posts without your OK in Semi mode',
			],
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
			facts: [
				'Three tabs: Profile · Content · Studio',
				'Profile = who they are',
				'Content = everything they made',
				'Studio = one-click templates',
			],
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
			facts: [
				'Where: sidebar → New Persona',
				'3 steps: Identity → Persona → Review',
				'The Vault offers 3 ready-made options',
				'Next: face kit, then connect an account',
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
				{ t: 'The new creator appears in the sidebar. Next: give them a face (reference kit guide) and connect an account when ready.' }
			]
		},

		// ── Keys & credits ───────────────────────────────────────────────────
		{
			id: 'openrouter-key',
			category: 'Keys & credits',
			title: 'Get an OpenRouter key (fixes "out of credits")',
			when: 'Content generation fails with a message like "Generation failed via openrouter", "402", or "insufficient credits". OpenRouter is the service that writes captions and scripts — when its credits run out, generation stops until you connect your own key.',
			facts: [
				'Fixes: “402” / “insufficient credits” errors',
				'The key starts with sk-or-v1-…',
				'$10–20 of credits lasts a long time',
				'Paste it in Settings → Provider API Keys',
			],
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
			facts: [
				'Zernio = publishing',
				'Fal AI = images, video, voice',
				'OpenRouter or Gemini = writing (one is enough)',
				'Firecrawl = reads your website for the brief',
			],
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
			facts: [
				'Button: Content tab → Generate Now',
				'Nothing is spent until you approve',
				'Images take 1–2 min · video a few minutes',
				'The result lands as a Draft',
			],
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
			facts: [
				'Opens before every generation',
				'Shows the exact prompt and the exact cost',
				'Cancel costs nothing',
				'Platforms + schedule are set right here',
			],
			steps: [
				{
					t: 'Every generation opens this composer first — nothing is spent until you click Approve & generate.',
					img: 'composer',
					alt: 'The generation composer'
				},
				{ t: '"Prompt sent to the model" shows the exact text the AI receives — edit it if you want something specific.' },
				{
					t: '"Pipeline that will run" lists each step with its model and estimated dollar cost, plus a live total.',
					img: 'composer-costs',
					alt: 'The composer scrolled to the Pipeline that will run cost breakdown'
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
				'Where: creator page → Studio tab',
				'Ready-made formats in 4 categories',
				'Output switch: Review draft or Asset only',
				'Templates pre-fill the composer for you',
			],
			steps: [
				{
					t: 'Open the creator’s page → Studio tab. Thirteen ready-made templates — This Saved Me, Before & After, Unboxing Reveal, TV Spot, and more — filtered by UGC / Product / Cinematic / Stills.',
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
			facts: [
				'Where: Profile tab → Character & Visuals',
				'⚡ Generate all remaining builds the whole kit',
				'A real photo upload works too',
				'Every stage keeps history — Restore anytime',
			],
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
			facts: [
				'Where: Profile tab → Automation',
				'The preview button plays the voice out loud',
				'No two creators sound alike',
				'Save Profile applies it to new videos',
			],
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
			facts: [
				'Where: Profile tab → Platform Identity Kit',
				'Writes names, usernames, and bios',
				'Copy-paste on purpose — platform rules',
				'Autosaves as you type',
			],
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
			facts: [
				'Where: Profile tab → Connections toggle',
				'15 platforms supported',
				'A normal social login — nothing technical',
				'A Reconnect badge fixes broken links in one click',
			],
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
			facts: [
				'Where: Profile tab → Automation',
				'Semi-Autonomous is the recommended mode',
				'Set the timezone to the audience\'s clock',
				'RSS mode turns articles into posts',
			],
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
			facts: [
				'Publishing… = waiting for the platform',
				'Published = confirmed, with a real link',
				'Multi-platform posts list each result',
				'It never claims more than the platform confirmed',
			],
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
			facts: [
				'Where: Calendar → click the post',
				'Captions stay editable until publish time',
				'The + on any day creates a post for that day',
			],
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
			facts: [
				'Delete always asks to confirm first',
				'Most platforms: removed automatically',
				'Instagram: manual — the panel gives the link',
			],
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
			facts: [
				'Where: Library → All Generations',
				'Two lenses: Content outputs · Profile assets',
				'Filters live in the page address — bookmarkable',
				'♥ on any card adds it to My Favorites',
			],
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
			facts: [
				'♥ works on posts and on creators',
				'Where: Library → My Favorites',
				'Two tabs: Posts · Personas',
				'Un-heart removes it on the spot',
			],
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
				'Board view flags drafts scoring under 6.0',
			],
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
			facts: [
				'Where: Setup → Model Manager',
				'Value ranking = quality ÷ price',
				'★ sets the default · Enabled shows it in the composer',
				'“Check for new models” scans new releases',
			],
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
			facts: [
				'Where: Brand Brief → Intel Wizard link',
				'6 steps — answers are kept as you go',
				'You get pillars, a schedule, and platform scores',
			],
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
			facts: [
				'Regenerating never loses the old image',
				'Restore lives on the picture and every kit stage',
				'Two tabs in the picker: This stage · All images',
			],
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
			facts: [
				'Read the message — it names the real cause',
				'“402” or “credits” → the OpenRouter guide',
				'“fal” → check the Fal AI card in Settings',
				'Fixed it? Generate again — nothing is lost',
			],
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
			facts: [
				'Open the post — the reason is written on it',
				'Most common fix: Reconnect the account',
				'Temporary failures retry themselves',
			],
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
			facts: [
				'Draft = needs you',
				'Scheduled = will post itself on time',
				'Failed = the reason is on the post',
				'Nothing fails silently',
			],
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

	// ── Quick fixes: symptom → guide, endpoint-style ─────────────────────────
	// One-tap answers for the situations users actually arrive with.
	const QUICK_FIXES: Array<{ label: string; id: string }> = [
		{ label: '⚡ Out of credits', id: 'openrouter-key' },
		{ label: '🚫 Post didn’t publish', id: 'publish-failing' },
		{ label: '🔌 Reconnect an account', id: 'connect-account' },
		{ label: '🖼️ Generation failed', id: 'generation-failing' },
		{ label: '🏷️ What does this label mean?', id: 'status-glossary' },
		{ label: '↩️ Undo a regenerated image', id: 'restore-history' },
		{ label: '🗑️ Take a post down', id: 'delete-live' }
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

	// ── Nav nesting ──────────────────────────────────────────────────────────
	// Categories collapse; the group holding the open guide stays open, and an
	// active search opens everything so matches are never hidden behind a fold.
	let collapsedCats = $state<Record<string, boolean>>({});
	function toggleCat(cat: string) {
		collapsedCats[cat] = !collapsedCats[cat];
	}
	function catOpen(cat: string): boolean {
		if (query.trim()) return true;
		if (selected.category === cat) return true;
		return !collapsedCats[cat];
	}

	/** Short label for a step's nested nav anchor — first words, no markup. */
	function stepLabel(t: string): string {
		const words = t.replace(/[·—→]/g, ' ').split(/\s+/).filter(Boolean);
		const label = words.slice(0, 5).join(' ');
		return label.length < t.length ? label + '…' : label;
	}

	function jumpToStep(i: number) {
		document
			.getElementById(`step-${selected.id}-${i + 1}`)
			?.scrollIntoView({ block: 'center', behavior: 'smooth' });
	}

	// Immersive reading: walk guides in catalog order without going back to the list.
	let guideIndex = $derived(GUIDES.findIndex((g) => g.id === selected.id));
	let prevGuide = $derived(guideIndex > 0 ? GUIDES[guideIndex - 1] : null);
	let nextGuide = $derived(guideIndex < GUIDES.length - 1 ? GUIDES[guideIndex + 1] : null);

	onMount(() => {
		const hash = location.hash.replace('#', '');
		if (hash && GUIDES.some((g) => g.id === hash)) selectedId = hash;
	});
</script>

<svelte:head>
	<title>Guides — PersonaGen</title>
</svelte:head>

<div class="guides-page">
	<!-- Slim sticky top bar: title + search, full width. -->
	<header class="gd-top">
		<div class="gd-top-titles">
			<h1>Guides</h1>
			<p>How to do everything in PersonaGen — plain English, step by step, with pictures.</p>
		</div>
		<input
			type="search"
			placeholder="Search guides… (try: credits, connect, voice)"
			bind:value={query}
			aria-label="Search guides"
		/>
	</header>

	<div class="gd-body">
		<!-- ── Left: nested index — category ▸ guide ▸ steps of the open guide ── -->
		<nav class="gd-nav" aria-label="Guide list">
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
							<span class="nav-count">{inCat.length}</span>
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
				<p class="index-empty">No guides match “{query}”.</p>
			{/if}
		</nav>

		<!-- ── Center: the guide itself ── -->
		<article class="gd-article" id="guide-article" aria-live="polite">
			<span class="article-cat">{selected.category}</span>
			<h2>{selected.title}</h2>
			<p class="article-when"><b>You need this when:</b> {selected.when}</p>

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
						{#if step.img}
							<a
								class="step-shot-link"
								href={shotUrl(step.img)}
								target="_blank"
								rel="noopener"
								title="Open screenshot full size"
							>
								<img
									class="step-shot"
									src={shotUrl(step.img)}
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

			<!-- Walk the whole handbook without returning to the list. -->
			<footer class="gd-pager">
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
		</aside>
	</div>
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
		padding: var(--space-5) var(--space-8);
		border-bottom: 1px solid var(--border);
		background: color-mix(in srgb, var(--bg) 88%, transparent);
		backdrop-filter: blur(12px);
	}
	.gd-top-titles h1 {
		font-size: 1.45rem;
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
		padding: var(--space-6) var(--space-8) var(--space-16);
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
		opacity: 0.7;
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
	.step-shot-link {
		display: block;
		margin-top: 0.7rem;
		border-radius: var(--radius-sm);
		max-width: 860px;
	}
	.step-shot-link:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 3px;
	}
	.step-shot {
		width: 100%;
		height: auto;
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-sm);
		box-shadow: var(--shadow-md);
		display: block;
		cursor: zoom-in;
	}
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
	@media (prefers-reduced-motion: reduce) {
		.nav-chevron {
			transition: none;
		}
	}
</style>
