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

export type StudioCategory = 'ugc' | 'product' | 'cinematic' | 'stills';

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
	{ id: 'stills', label: 'Stills' }
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
	}
];
