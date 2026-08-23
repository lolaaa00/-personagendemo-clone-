/**
 * Studio template catalog — archetype scaffolds for the persona Studio tab.
 *
 * Each template is nothing more than a pre-filled GenerationComposer request:
 * `baseBody` goes straight to /api/agent/:id/generate-post, whose preview step
 * echoes `topic` and `scene` back as EDITABLE fields, resolves the real prompt,
 * models and cost server-side, and only runs on explicit approval. Templates
 * therefore add zero new spend paths and zero server logic.
 *
 * Deliberately parameterized, not scripted: scaffolds describe the archetype and
 * say "the featured product" / "the persona" — the pipeline already injects the
 * actual brand product (with its reference photo), the persona's pinned face,
 * voice and soul. A template about YOUR product in YOUR persona's voice is the
 * point; static example scripts about someone else's rings are what this exists
 * to avoid.
 *
 * TWO AXES, deliberately separate:
 *   `intent` — 'brand' (promotes the product) vs 'channel' (everything else).
 *     A real account is roughly 20% brand and 80% channel content; a Studio
 *     stocked only with promo templates quietly pushes the account the other way.
 *   `surface` — what the finished asset LOOKS like, which is what a user actually
 *     browses by: typographic / photo / motion / cinematic. This is not the same
 *     as `pipeline` (the machinery) and users should never have to learn that one.
 *
 * NOTE: there is no text-only generation path — /api/agent/:id/generate-post
 * accepts only 'image' | 'video' | 'cinematic'. A "text post" here is therefore
 * type rendered onto a still, which is what IG/TikTok want anyway. Genuine
 * text-only output (X, Threads, LinkedIn, Reddit) would need a new media mode.
 *
 * `format` maps to the pipeline that will run:
 *   spokesperson → talking-head (image + TTS + lipsync)
 *   broll        → product motion clip (image + i2v), no dialogue
 *   cinematic    → multi-shot reference video (body.media = 'cinematic')
 *   image        → still only (body.media = 'image')
 */

export type StudioCategory = 'ugc' | 'product' | 'cinematic' | 'stills' | 'social';

/** Who the asset serves: the product, or the audience. Drives the 20/80 split. */
export type StudioIntent = 'brand' | 'channel';

/** What the finished asset looks like — the axis users actually browse by. */
export type StudioSurface = 'typographic' | 'photo' | 'motion' | 'cinematic';

export interface StudioTemplate {
	id: string;
	title: string;
	tagline: string;
	category: StudioCategory;
	/** Chip label for the pipeline this runs. */
	pipeline: 'Talking head' | 'Product motion' | 'Cinematic' | 'Still image';
	/** Promotes the product ('brand') or feeds the audience ('channel'). */
	intent: StudioIntent;
	/** Shelf this sits on — what the output looks like, not how it is made. */
	surface: StudioSurface;
	/** One line of representative output, shown ON the card so it is never blank. */
	sample: string;
	/** Fields sent as the composer spec's baseBody (all editable in preview). */
	baseBody: {
		topic: string;
		scene?: string;
		format?: 'spokesperson' | 'broll';
		media?: 'image' | 'cinematic';
		/**
		 * How the still is composed. 'graphic' = a typographic/flat-design card:
		 * the image model RENDERS the Director's line as the artwork — no
		 * photography, no reference images. Omitted = 'photo' (the UGC default).
		 */
		still?: 'photo' | 'graphic';
		/**
		 * Which reference images this composition actually feeds the model.
		 * Omitted = both (legacy UGC behavior). The pipeline and the composer both
		 * honor this — a template that claims "no product" must not silently
		 * composite the brand's product photo in, and the composer must not show
		 * reference fields the run won't use.
		 */
		refs?: { character: boolean; product: boolean };
	};
}

export const STUDIO_CATEGORIES: Array<{ id: StudioCategory | 'all'; label: string }> = [
	{ id: 'all', label: 'All' },
	{ id: 'ugc', label: 'UGC' },
	{ id: 'product', label: 'Product' },
	{ id: 'cinematic', label: 'Cinematic' },
	{ id: 'stills', label: 'Stills' },
	{ id: 'social', label: 'Social & Quotes' }
];

export const STUDIO_TEMPLATES: StudioTemplate[] = [
	// ── UGC · talking head ────────────────────────────────────────────────
	{
		id: 'creator-recommendation',
		title: 'This Saved Me',
		tagline: 'Feature-led creator recommendation, straight to camera',
		category: 'ugc',
		pipeline: 'Talking head',
		intent: 'brand',
		surface: 'motion',
		sample: 'I didn’t expect the refill cap to be the thing that sold me.',
		baseBody: {
			topic:
				'A direct-to-camera recommendation: the persona explains the one specific problem the featured product solved for them this week, names the feature that did it, and ends with a low-pressure nudge to try it. Confident, specific, no hype words.',
			scene:
				'Casual selfie framing, phone-camera realism, soft natural window light, persona holding the featured product at chest height, tidy lived-in home background, slight handheld movement.',
			format: 'spokesperson'
		}
	},
	{
		id: 'secret-hack',
		title: 'Secret Hack Reveal',
		tagline: 'A clever use nobody knows about',
		category: 'ugc',
		pipeline: 'Talking head',
		intent: 'brand',
		surface: 'motion',
		sample: 'Nobody talks about this — try it at half the dose.',
		baseBody: {
			topic:
				"A conspiratorial 'nobody talks about this' reveal: the persona shares one non-obvious way to use the featured product, demonstrates it mid-video, and reacts to the result. Hushed, playful tone — like telling a friend a secret.",
			scene:
				'Close selfie framing leaning toward the lens, kitchen or bathroom counter setting, the featured product in frame, warm practical lighting, authentic phone-video texture.',
			format: 'spokesperson'
		}
	},
	{
		id: 'before-after',
		title: 'Before & After',
		tagline: 'The transformation, shown not told',
		category: 'ugc',
		pipeline: 'Talking head',
		intent: 'brand',
		surface: 'motion',
		sample: 'Three weeks. Same lighting. Same hoodie. Look.',
		baseBody: {
			topic:
				"A before/after story: the persona describes the 'before' problem in one blunt sentence, shows the featured product as the turning point, and lands on the 'after' with visible relief. Structure the script as wrong-way → right-way.",
			scene:
				'Two-beat visual: starts in a slightly chaotic corner of the home, ends bright and orderly with the featured product placed prominently; natural daylight, phone-shot realism.',
			format: 'spokesperson'
		}
	},
	{
		id: 'tutorial',
		title: 'Quick Tutorial',
		tagline: 'Step-by-step in under 30 seconds',
		category: 'ugc',
		pipeline: 'Talking head',
		intent: 'brand',
		surface: 'motion',
		sample: 'Thirty seconds, three steps, no mess. Here.',
		baseBody: {
			topic:
				'A three-step mini tutorial: the persona walks through using the featured product from open to result, counting the steps out loud, ending with the finished result held up to camera. Brisk, helpful, zero filler.',
			scene:
				'Overhead-leaning selfie angle at a clean counter, hands and the featured product clearly visible, bright even lighting, small text-friendly negative space at the top of frame.',
			format: 'spokesperson'
		}
	},
	{
		id: 'obsession',
		title: 'Mild Obsession',
		tagline: "The 'I can't stop using this' confession",
		category: 'ugc',
		pipeline: 'Talking head',
		intent: 'brand',
		surface: 'motion',
		sample: 'It’s a mild obsession at this point, honestly.',
		baseBody: {
			topic:
				"A playful confession that the persona is slightly too into the featured product — self-aware humor about how often they reach for it, one concrete daily moment it fits into, and a shrugging 'no regrets' close.",
			scene:
				'Cozy couch or bedroom setting, golden-hour light, persona relaxed and laughing mid-take, the featured product casually within reach, soft grain like a front camera.',
			format: 'spokesperson'
		}
	},
	// ── Product · b-roll motion ───────────────────────────────────────────
	{
		id: 'hyper-motion',
		title: 'Hyper Motion',
		tagline: 'High-energy product burst, no dialogue',
		category: 'product',
		pipeline: 'Product motion',
		intent: 'brand',
		surface: 'motion',
		sample: 'Product spins into frame, catches the light, lands.',
		baseBody: {
			topic:
				'A high-energy hero clip built entirely around the featured product: fast kinetic beats, ingredients or elements bursting around it, dramatic speed ramps, ending frozen on the product as the hero frame.',
			scene:
				'Macro studio shot of the featured product center frame, saturated complementary color backdrop, dynamic particles and splashes orbiting it, punchy commercial lighting, crisp product label legible in the final beat.',
			format: 'broll',
			refs: { character: false, product: true }
		}
	},
	{
		id: 'satisfying-test',
		title: 'Satisfying Test',
		tagline: 'Texture, pour, crush — oddly satisfying',
		category: 'product',
		pipeline: 'Product motion',
		intent: 'brand',
		surface: 'motion',
		sample: 'One clean pour. One clean result. No cuts.',
		baseBody: {
			topic:
				'An oddly-satisfying sensory clip: the featured product filmed through one tactile moment — a slow pour, squeeze, tear or crunch — captured so the texture is the star. No people, no words, pure sensation.',
			scene:
				'Extreme macro, shallow depth of field, slow-motion feel, single hard key light raking across the featured product to exaggerate texture, dark clean backdrop.',
			format: 'broll',
			refs: { character: false, product: true }
		}
	},
	{
		id: 'unboxing-reveal',
		title: 'Unboxing Reveal',
		tagline: 'The open-the-box moment',
		category: 'product',
		pipeline: 'Product motion',
		intent: 'brand',
		surface: 'motion',
		sample: 'Hands, tape, lid, reveal — one unbroken take.',
		baseBody: {
			topic:
				'A theatrical unboxing beat: hands lift the lid, tissue parts, and the featured product is revealed in its packaging like a gift — one continuous reveal building to a clean hero shot.',
			scene:
				'Top-down table shot, warm spotlight tightening on the box as it opens, the featured product nested in packaging, subtle dust motes in the light beam, rich shadows.',
			format: 'broll',
			refs: { character: false, product: true }
		}
	},
	{
		id: 'shelf-place',
		title: 'The Placement',
		tagline: 'Calm, aesthetic shelf moment',
		category: 'product',
		pipeline: 'Product motion',
		intent: 'brand',
		surface: 'photo',
		sample: 'It just sits there, and the shelf looks finished.',
		baseBody: {
			topic:
				'A quiet aesthetic ritual: a hand places the featured product into a curated arrangement — shelf, vanity or countertop — nudges it half a degree, and the camera settles. Serene, ASMR-adjacent, no dialogue.',
			scene:
				'Eye-level medium-close shot of a styled shelf in soft morning light, muted tones except the featured product, gentle slow push-in, everything unhurried.',
			format: 'broll',
			refs: { character: false, product: true }
		}
	},
	// ── Cinematic · multi-shot ────────────────────────────────────────────
	{
		id: 'tv-spot',
		title: 'TV Spot',
		tagline: 'A brand-film moment, multi-shot',
		category: 'cinematic',
		pipeline: 'Cinematic',
		intent: 'brand',
		surface: 'cinematic',
		sample: 'Four shots. Six seconds. One promise.',
		baseBody: {
			topic:
				'A cinematic lifestyle spot: the persona moves through one beautiful everyday scene with the featured product woven in naturally — no hard sell, just mood, ending on a quiet branded close.',
			media: 'cinematic'
		}
	},
	{
		id: 'wild-card',
		title: 'Wild Card',
		tagline: 'Over-the-top concept, your call',
		category: 'cinematic',
		pipeline: 'Cinematic',
		intent: 'channel',
		surface: 'cinematic',
		sample: 'Something nobody asked for and everybody reposts.',
		baseBody: {
			topic:
				'An intentionally over-the-top concept spot starring the featured product — pick one bold visual world (epic, surreal, retro, animated) and commit fully. Keep the product itself faithful to its reference photos.',
			media: 'cinematic'
		}
	},
	// ── Stills ────────────────────────────────────────────────────────────
	{
		id: 'lifestyle-still',
		title: 'Lifestyle Still',
		tagline: 'In-context photo with the persona',
		category: 'stills',
		pipeline: 'Still image',
		intent: 'channel',
		surface: 'photo',
		sample: 'A Tuesday that happens to look good.',
		baseBody: {
			topic:
				'A single lifestyle photo: the persona using the featured product in a believable everyday moment, composed like a strong organic feed post rather than an ad.',
			scene:
				'Candid documentary-style photo, natural light, persona mid-action with the featured product, environment telling a story, editorial color grade.',
			media: 'image'
		}
	},
	{
		id: 'product-flatlay',
		title: 'Product Flat-Lay',
		tagline: 'Clean top-down hero still',
		category: 'stills',
		pipeline: 'Still image',
		intent: 'brand',
		surface: 'photo',
		sample: 'Top-down, three objects, one shadow, nothing else.',
		baseBody: {
			topic:
				'A polished flat-lay hero image of the featured product surrounded by a few props that explain its world at a glance — composed for a pinned post or profile grid anchor.',
			scene:
				'Top-down flat-lay on a textured neutral surface, the featured product centered, 3-4 supporting props arranged with generous negative space, soft shadowless light.',
			media: 'image',
			refs: { character: false, product: true }
		}
	},

	// ── Social & Quotes · alternative content, built to be SHARED ──────────
	// Not everything is a video. These are the save-and-send formats: quote
	// cards, text graphics, split-frames — the posts people forward to a friend.
	// All run the still-image pipeline (Nano Banana renders clean typography),
	// so they cost cents and generate in seconds.
	{
		id: 'quote-card',
		title: 'Quote Card',
		tagline: 'A shareable typographic quote in the brand voice',
		category: 'social',
		pipeline: 'Still image',
		intent: 'channel',
		surface: 'typographic',
		sample: 'You don’t need a bigger feed. You need a sharper one.',
		baseBody: {
			topic:
				"A quote card built to be reshared: one short, punchy line in the persona's voice that captures why the featured product matters — a truth the audience already feels but hasn't put into words. The caption expands on the line and invites people to send it to someone who needs it.",
			scene:
				'Minimal typographic quote card: the quote set LARGE in an elegant modern typeface, perfectly legible, centered on a clean solid or softly textured background in brand-adjacent tones, small handle credit at the bottom. Flawless spelling, no extra graphics, museum-poster restraint.',
			media: 'image',
			still: 'graphic',
			refs: { character: false, product: false }
		}
	},
	{
		id: 'hot-take',
		title: 'Hot Take',
		tagline: 'A bold text post that starts arguments in the comments',
		category: 'social',
		pipeline: 'Still image',
		intent: 'channel',
		surface: 'typographic',
		sample: 'Most morning routines are procrastination in a nice mug.',
		baseBody: {
			topic:
				'A deliberately spicy-but-defensible opinion from the persona about their niche (not a product pitch) — the kind of one-liner people screenshot, quote-post, and argue with. The caption doubles down and asks where people stand.',
			scene:
				'Bold text-only graphic: the take set in heavy condensed type filling the frame, high-contrast two-color palette, slight offset composition like a protest poster, zero imagery, perfectly legible, flawless spelling.',
			media: 'image',
			still: 'graphic',
			refs: { character: false, product: false }
		}
	},
	{
		id: 'stat-shock',
		title: 'Stat That Stops the Scroll',
		tagline: 'One surprising number, designed like a headline',
		category: 'social',
		pipeline: 'Still image',
		intent: 'channel',
		surface: 'typographic',
		sample: '73% never make it past the first line.',
		baseBody: {
			topic:
				'A single surprising, true-to-the-niche statistic or comparison that reframes why the featured product category matters — the number IS the hook. Caption gives the context and the source framing, then ties it to the product in one line.',
			scene:
				'Editorial data-headline graphic: the number rendered HUGE in a display typeface, one short supporting line beneath it, restrained single-accent color on a clean ground, broadsheet-front-page energy, flawless spelling and digits.',
			media: 'image',
			still: 'graphic',
			refs: { character: false, product: false }
		}
	},
	{
		id: 'before-after-still',
		title: 'Before / After Split',
		tagline: 'The transformation in one frame — no video needed',
		category: 'social',
		pipeline: 'Still image',
		intent: 'channel',
		surface: 'photo',
		sample: 'Left: the problem. Right: ten minutes later.',
		baseBody: {
			topic:
				'A split-frame before/after image showing the honest transformation the featured product delivers — same subject, same framing, only the result changed. Caption names how long it took and what actually did the work.',
			scene:
				'Single image split into two equal vertical panels labeled BEFORE and AFTER in small clean type, identical camera angle and lighting in both panels, the only difference being the product’s result, photorealistic, no exaggeration.',
			media: 'image',
			refs: { character: false, product: true }
		}
	},
	{
		id: 'mantra-card',
		title: 'Mantra / Lyric Card',
		tagline: 'Poetic lines people repost to say something about themselves',
		category: 'social',
		pipeline: 'Still image',
		intent: 'channel',
		surface: 'typographic',
		sample: 'Slow is a strategy, not a setback.',
		baseBody: {
			topic:
				"Three to five short poetic lines — a mantra, almost lyrics — expressing the lifestyle and identity the persona's audience aspires to (the product's world, never the product by name). Caption is a single line inviting people to save it.",
			scene:
				'Aesthetic text card: the lines set in a refined serif with generous line spacing, stacked left-aligned, on a dreamy atmospheric background (soft gradient sky, film-grain texture), muted poetic palette, flawless spelling.',
			media: 'image',
			still: 'graphic',
			refs: { character: false, product: false }
		}
	},
	{
		id: 'caption-this',
		title: 'Caption This',
		tagline: 'An image engineered for comments and shares',
		category: 'social',
		pipeline: 'Still image',
		intent: 'channel',
		surface: 'photo',
		sample: 'No caption. That’s the point — they’ll write it.',
		baseBody: {
			topic:
				"An intentionally funny, oddly relatable scene from the persona's daily life with the featured product visible but not the point — designed so the audience supplies the joke. The caption just says 'caption this' with a first attempt from the persona.",
			scene:
				'Candid comedic photo: the persona mid-mundane-disaster or absurdly relatable moment, featured product somewhere in frame, sitcom timing frozen at the perfect frame, natural light, meme-ready composition with clear space at top.',
			media: 'image'
		}
	},
	// ══════════════════════════════════════════════════════════════════════
	// CHANNEL CONTENT — the ~80%.
	// These do not mention the product. They exist so the account has a reason
	// to be followed between promos; an account that only sells gets muted.
	// ══════════════════════════════════════════════════════════════════════

	// ── Typographic · text rendered as a still ────────────────────────────
	{
		id: 'unpopular-opinion',
		title: 'Unpopular Opinion',
		tagline: 'A defensible stance that splits the room',
		category: 'social',
		pipeline: 'Still image',
		intent: 'channel',
		surface: 'typographic',
		sample: 'Consistency is overrated if you are consistently boring.',
		baseBody: {
			topic: 'A genuinely contrarian but defensible opinion from the persona’s niche, stated flatly in one or two lines. No hedging, no "just my opinion" softener. It should make a knowledgeable reader either nod hard or want to argue — never shrug.',
			scene: 'Bold typographic still, high-contrast brand colours, generous margins, one short line of type as the entire composition, no photography.',
			media: 'image',
			still: 'graphic',
			refs: { character: false, product: false }
		}
	},
	{
		id: 'myth-vs-fact',
		title: 'Myth vs Fact',
		tagline: 'Correct something the audience believes',
		category: 'social',
		pipeline: 'Still image',
		intent: 'channel',
		surface: 'typographic',
		sample: 'MYTH: more posting equals more reach.',
		baseBody: {
			topic: 'One widely believed myth in the persona’s niche stated plainly, then corrected with the actual mechanism in one sentence. Confident and specific, never smug.',
			scene: 'Split typographic still: the myth struck through in muted tone on the upper half, the correction in brand colour on the lower half, strong type hierarchy, no photography.',
			media: 'image',
			still: 'graphic',
			refs: { character: false, product: false }
		}
	},
	{
		id: 'the-list',
		title: 'The List',
		tagline: 'Three to five things, screenshot-worthy',
		category: 'social',
		pipeline: 'Still image',
		intent: 'channel',
		surface: 'typographic',
		sample: '4 things I stopped doing this year',
		baseBody: {
			topic: 'A tight numbered list of three to five specific, non-obvious items from the persona’s niche under a headline worth screenshotting. Each item is a few words, not a sentence. No filler entries.',
			scene: 'Clean typographic list card, numbered items with clear vertical rhythm, headline at top, brand background, no photography.',
			media: 'image',
			still: 'graphic',
			refs: { character: false, product: false }
		}
	},
	{
		id: 'question-bait',
		title: 'Ask the Room',
		tagline: 'A question people actually answer',
		category: 'social',
		pipeline: 'Still image',
		intent: 'channel',
		surface: 'typographic',
		sample: 'What is the one you would never give up?',
		baseBody: {
			topic: 'One open question in the persona’s niche that is easy to answer in four words and hard to scroll past. Specific and a little playful — never a generic "what do you think?".',
			scene: 'Single large question set in brand type, centred, plenty of negative space, no photography.',
			media: 'image',
			still: 'graphic',
			refs: { character: false, product: false }
		}
	},
	{
		id: 'definition-card',
		title: 'Define It',
		tagline: 'Name a feeling the audience has but cannot articulate',
		category: 'social',
		pipeline: 'Still image',
		intent: 'channel',
		surface: 'typographic',
		sample: 'noun — the tab you never close and never read.',
		baseBody: {
			topic: 'Invent a dictionary-style definition for a very specific experience in the persona’s niche that the audience will recognise instantly but has never had a word for. Dry, deadpan, precise.',
			scene: 'Dictionary-entry typographic still: invented headword, part of speech in italics, definition beneath, restrained palette, no photography.',
			media: 'image',
			still: 'graphic',
			refs: { character: false, product: false }
		}
	},
	{
		id: 'two-truths',
		title: 'Both Can Be True',
		tagline: 'Hold two opposing ideas at once',
		category: 'social',
		pipeline: 'Still image',
		intent: 'channel',
		surface: 'typographic',
		sample: 'You can love the work and still need a break from it.',
		baseBody: {
			topic: 'Two statements from the persona’s niche that appear to contradict each other but are both true, joined so the tension is the point. Warm and reassuring rather than clever.',
			scene: 'Two-line typographic still with a dividing rule between the halves, soft brand palette, no photography.',
			media: 'image',
			still: 'graphic',
			refs: { character: false, product: false }
		}
	},

	// ── Photo · image-led stills ──────────────────────────────────────────
	{
		id: 'day-in-the-life',
		title: 'A Frame From Today',
		tagline: 'Ordinary moment, composed well',
		category: 'stills',
		pipeline: 'Still image',
		intent: 'channel',
		surface: 'photo',
		sample: 'Coffee, half a notebook page, morning light.',
		baseBody: {
			topic: 'A single unremarkable moment from the persona’s ordinary day, framed like it mattered. No product, no message, no caption-bait — just presence.',
			scene: 'Candid phone-camera realism, natural window light, shallow depth of field, lived-in setting with real clutter, persona present but not posing.',
			media: 'image',
			refs: { character: true, product: false }
		}
	},
	{
		id: 'behind-the-scenes',
		title: 'Behind the Scenes',
		tagline: 'The unglamorous middle of the work',
		category: 'stills',
		pipeline: 'Still image',
		intent: 'channel',
		surface: 'photo',
		sample: 'The version nobody was supposed to see.',
		baseBody: {
			topic: 'The messy in-progress reality behind something the persona makes or does — the draft, the failed attempt, the cluttered desk at hour six. Honest, not styled.',
			scene: 'Available light, slightly imperfect framing, work-in-progress materials visible, nothing tidied for the camera.',
			media: 'image',
			refs: { character: false, product: false }
		}
	},
	{
		id: 'mood-board',
		title: 'Mood Board',
		tagline: 'Taste, communicated without words',
		category: 'stills',
		pipeline: 'Still image',
		intent: 'channel',
		surface: 'photo',
		sample: 'Four textures that explain the whole aesthetic.',
		baseBody: {
			topic: 'A collection of textures, colours and objects that communicate the persona’s taste in the niche without naming anything. Should feel curated by a person, not assembled by a search.',
			scene: 'Flat-lay grid of materials and swatches, soft diffuse light, cohesive palette, no product branding, no text.',
			media: 'image',
			refs: { character: false, product: false }
		}
	},
	{
		id: 'pov-shot',
		title: 'POV',
		tagline: 'Put the viewer inside the moment',
		category: 'stills',
		pipeline: 'Still image',
		intent: 'channel',
		surface: 'photo',
		sample: 'You just sat down and nobody needs anything from you.',
		baseBody: {
			topic: 'A first-person point-of-view moment from the persona’s world that the audience will recognise as their own. The viewer should feel placed inside it, not shown it.',
			scene: 'First-person camera angle, hands or feet in lower frame, natural light, real environment, no eye contact with camera.',
			media: 'image',
			refs: { character: false, product: false }
		}
	},

	// ── Motion · talking head, no product ─────────────────────────────────
	{
		id: 'the-rant',
		title: 'The Rant',
		tagline: 'Ninety seconds of genuine opinion',
		category: 'ugc',
		pipeline: 'Talking head',
		intent: 'channel',
		surface: 'motion',
		sample: 'Right, I need to talk about this for a second.',
		baseBody: {
			topic: 'The persona argues one strongly held position from their niche straight to camera. Builds, lands a clear point, and stops. No product mentioned at any stage.',
			scene: 'Straight-to-camera selfie framing, handheld, natural light, mid-thought opening with no intro, slightly animated delivery.',
			format: 'spokesperson',
			refs: { character: true, product: false }
		}
	},
	{
		id: 'story-time',
		title: 'Story Time',
		tagline: 'A short personal story with a turn',
		category: 'ugc',
		pipeline: 'Talking head',
		intent: 'channel',
		surface: 'motion',
		sample: 'So this happened and I still think about it.',
		baseBody: {
			topic: 'A short first-person story from the persona’s life that turns on one surprising detail and ends on a thought rather than a lesson. Nothing is sold and no moral is stated outright.',
			scene: 'Close selfie framing, opens mid-story with no setup, natural light, relaxed and conversational, small honest reactions.',
			format: 'spokesperson',
			refs: { character: true, product: false }
		}
	},
	{
		id: 'answer-a-comment',
		title: 'Answer a Comment',
		tagline: 'Reply to the thing people keep asking',
		category: 'ugc',
		pipeline: 'Talking head',
		intent: 'channel',
		surface: 'motion',
		sample: 'Someone asked this again, so — properly this time.',
		baseBody: {
			topic: 'The persona answers a question their audience genuinely keeps asking in their niche, thoroughly and without deflecting. Useful enough to be saved.',
			scene: 'Straight-to-camera, sitting, natural light, opens by restating the question, unhurried explanatory delivery.',
			format: 'spokesperson',
			refs: { character: true, product: false }
		}
	},
	{
		id: 'myth-bust-video',
		title: 'Myth-Bust to Camera',
		tagline: 'Correct the record out loud',
		category: 'ugc',
		pipeline: 'Talking head',
		intent: 'channel',
		surface: 'motion',
		sample: 'This keeps getting repeated and it is just wrong.',
		baseBody: {
			topic: 'The persona names one common piece of bad advice in their niche, explains precisely why it fails, and gives the better alternative. Direct and evidence-led, never condescending.',
			scene: 'Straight-to-camera, natural light, opens on the myth itself with no preamble, firm and clear delivery.',
			format: 'spokesperson',
			refs: { character: true, product: false }
		}
	}
];

/**
 * Per-pipeline cost/time shown on every tile. Estimates aligned with
 * lib/pricing.ts (nano-banana still $0.08; talking head = still + TTS +
 * OmniHuman ~$0.81; product motion = still + Kling ~$0.61; cinematic
 * multi-shot ~$1.95). Times are observed queue-to-asset ranges, not promises.
 */
export const PIPELINE_META: Record<
	StudioTemplate['pipeline'],
	{ usd: string; time: string }
> = {
	'Still image': { usd: '$0.08', time: '~30s' },
	'Talking head': { usd: '~$0.81', time: '2–4 min' },
	'Product motion': { usd: '~$0.61', time: '2–5 min' },
	Cinematic: { usd: '~$1.95', time: '3–6 min' }
};

/** The same estimates as numbers — campaign budgeting math. Keep in sync. */
export const PIPELINE_USD: Record<StudioTemplate['pipeline'], number> = {
	'Still image': 0.08,
	'Talking head': 0.81,
	'Product motion': 0.61,
	Cinematic: 1.95
};

/** Shelf definitions, in display order. Typographic leads — it is the cheapest,
 * fastest, most under-used kind, and the heart of the channel 80%. */
export const STUDIO_SURFACES: Array<{
	id: StudioSurface;
	label: string;
	hint: string;
}> = [
	{ id: 'typographic', label: 'Text & Type', hint: 'Words as the visual — quotes, takes, lists' },
	{ id: 'photo', label: 'Photo', hint: 'Image-led stills in the persona’s world' },
	{ id: 'motion', label: 'Video', hint: 'Talking head and product motion' },
	{ id: 'cinematic', label: 'Cinematic', hint: 'Multi-shot, directed, ad-grade' }
];
