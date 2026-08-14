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
 * `format` maps to the pipeline that will run:
 *   spokesperson → talking-head (image + TTS + lipsync)
 *   broll        → product motion clip (image + i2v), no dialogue
 *   cinematic    → multi-shot reference video (body.media = 'cinematic')
 *   image        → still only (body.media = 'image')
 */

export type StudioCategory = 'ugc' | 'product' | 'cinematic' | 'stills' | 'social';

export interface StudioTemplate {
	id: string;
	title: string;
	tagline: string;
	category: StudioCategory;
	/** Chip label for the pipeline this runs. */
	pipeline: 'Talking head' | 'Product motion' | 'Cinematic' | 'Still image';
	/** Fields sent as the composer spec's baseBody (all editable in preview). */
	baseBody: {
		topic: string;
		scene?: string;
		format?: 'spokesperson' | 'broll';
		media?: 'image' | 'cinematic';
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
		baseBody: {
			topic:
				'A high-energy hero clip built entirely around the featured product: fast kinetic beats, ingredients or elements bursting around it, dramatic speed ramps, ending frozen on the product as the hero frame.',
			scene:
				'Macro studio shot of the featured product center frame, saturated complementary color backdrop, dynamic particles and splashes orbiting it, punchy commercial lighting, crisp product label legible in the final beat.',
			format: 'broll'
		}
	},
	{
		id: 'satisfying-test',
		title: 'Satisfying Test',
		tagline: 'Texture, pour, crush — oddly satisfying',
		category: 'product',
		pipeline: 'Product motion',
		baseBody: {
			topic:
				'An oddly-satisfying sensory clip: the featured product filmed through one tactile moment — a slow pour, squeeze, tear or crunch — captured so the texture is the star. No people, no words, pure sensation.',
			scene:
				'Extreme macro, shallow depth of field, slow-motion feel, single hard key light raking across the featured product to exaggerate texture, dark clean backdrop.',
			format: 'broll'
		}
	},
	{
		id: 'unboxing-reveal',
		title: 'Unboxing Reveal',
		tagline: 'The open-the-box moment',
		category: 'product',
		pipeline: 'Product motion',
		baseBody: {
			topic:
				'A theatrical unboxing beat: hands lift the lid, tissue parts, and the featured product is revealed in its packaging like a gift — one continuous reveal building to a clean hero shot.',
			scene:
				'Top-down table shot, warm spotlight tightening on the box as it opens, the featured product nested in packaging, subtle dust motes in the light beam, rich shadows.',
			format: 'broll'
		}
	},
	{
		id: 'shelf-place',
		title: 'The Placement',
		tagline: 'Calm, aesthetic shelf moment',
		category: 'product',
		pipeline: 'Product motion',
		baseBody: {
			topic:
				'A quiet aesthetic ritual: a hand places the featured product into a curated arrangement — shelf, vanity or countertop — nudges it half a degree, and the camera settles. Serene, ASMR-adjacent, no dialogue.',
			scene:
				'Eye-level medium-close shot of a styled shelf in soft morning light, muted tones except the featured product, gentle slow push-in, everything unhurried.',
			format: 'broll'
		}
	},
	// ── Cinematic · multi-shot ────────────────────────────────────────────
	{
		id: 'tv-spot',
		title: 'TV Spot',
		tagline: 'A brand-film moment, multi-shot',
		category: 'cinematic',
		pipeline: 'Cinematic',
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
		baseBody: {
			topic:
				'A polished flat-lay hero image of the featured product surrounded by a few props that explain its world at a glance — composed for a pinned post or profile grid anchor.',
			scene:
				'Top-down flat-lay on a textured neutral surface, the featured product centered, 3-4 supporting props arranged with generous negative space, soft shadowless light.',
			media: 'image'
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
		baseBody: {
			topic:
				"A quote card built to be reshared: one short, punchy line in the persona's voice that captures why the featured product matters — a truth the audience already feels but hasn't put into words. The caption expands on the line and invites people to send it to someone who needs it.",
			scene:
				'Minimal typographic quote card: the quote set LARGE in an elegant modern typeface, perfectly legible, centered on a clean solid or softly textured background in brand-adjacent tones, small handle credit at the bottom. Flawless spelling, no extra graphics, museum-poster restraint.',
			media: 'image'
		}
	},
	{
		id: 'hot-take',
		title: 'Hot Take',
		tagline: 'A bold text post that starts arguments in the comments',
		category: 'social',
		pipeline: 'Still image',
		baseBody: {
			topic:
				'A deliberately spicy-but-defensible opinion from the persona about their niche (not a product pitch) — the kind of one-liner people screenshot, quote-post, and argue with. The caption doubles down and asks where people stand.',
			scene:
				'Bold text-only graphic: the take set in heavy condensed type filling the frame, high-contrast two-color palette, slight offset composition like a protest poster, zero imagery, perfectly legible, flawless spelling.',
			media: 'image'
		}
	},
	{
		id: 'stat-shock',
		title: 'Stat That Stops the Scroll',
		tagline: 'One surprising number, designed like a headline',
		category: 'social',
		pipeline: 'Still image',
		baseBody: {
			topic:
				'A single surprising, true-to-the-niche statistic or comparison that reframes why the featured product category matters — the number IS the hook. Caption gives the context and the source framing, then ties it to the product in one line.',
			scene:
				'Editorial data-headline graphic: the number rendered HUGE in a display typeface, one short supporting line beneath it, restrained single-accent color on a clean ground, broadsheet-front-page energy, flawless spelling and digits.',
			media: 'image'
		}
	},
	{
		id: 'before-after-still',
		title: 'Before / After Split',
		tagline: 'The transformation in one frame — no video needed',
		category: 'social',
		pipeline: 'Still image',
		baseBody: {
			topic:
				'A split-frame before/after image showing the honest transformation the featured product delivers — same subject, same framing, only the result changed. Caption names how long it took and what actually did the work.',
			scene:
				'Single image split into two equal vertical panels labeled BEFORE and AFTER in small clean type, identical camera angle and lighting in both panels, the only difference being the product’s result, photorealistic, no exaggeration.',
			media: 'image'
		}
	},
	{
		id: 'mantra-card',
		title: 'Mantra / Lyric Card',
		tagline: 'Poetic lines people repost to say something about themselves',
		category: 'social',
		pipeline: 'Still image',
		baseBody: {
			topic:
				"Three to five short poetic lines — a mantra, almost lyrics — expressing the lifestyle and identity the persona's audience aspires to (the product's world, never the product by name). Caption is a single line inviting people to save it.",
			scene:
				'Aesthetic text card: the lines set in a refined serif with generous line spacing, stacked left-aligned, on a dreamy atmospheric background (soft gradient sky, film-grain texture), muted poetic palette, flawless spelling.',
			media: 'image'
		}
	},
	{
		id: 'caption-this',
		title: 'Caption This',
		tagline: 'An image engineered for comments and shares',
		category: 'social',
		pipeline: 'Still image',
		baseBody: {
			topic:
				"An intentionally funny, oddly relatable scene from the persona's daily life with the featured product visible but not the point — designed so the audience supplies the joke. The caption just says 'caption this' with a first attempt from the persona.",
			scene:
				'Candid comedic photo: the persona mid-mundane-disaster or absurdly relatable moment, featured product somewhere in frame, sitcom timing frozen at the perfect frame, natural light, meme-ready composition with clear space at top.',
			media: 'image'
		}
	}
];
