# PersonaGen Composer Contract Audit

Generated: 2026-08-23T23:08:35.290Z

> Static and non-generating: no provider, database, scheduling, or publishing call was made.

## Summary

- Studio templates: **41** (30 channel / 11 brand)
- Template-level violations: **4**
- Cross-composer findings: **7** (3 P0 / 4 P1 / 0 P2)

## Cross-composer findings

### P1 · C-TEMPLATE-MUTATION · Every Studio operation can be changed into a different media operation inside the generic composer

**Affected:** All 41 Studio template buttons

A “text card,” “photo,” “talking head,” or “cinematic” button is only a prefill, not an enforced composition contract.

- C:/Users/nexal/personagendemo/personagen-svelte/src/lib/components/generation/GenerationComposer.svelte:453 — generic media switch is rendered for every post composer
- C:/Users/nexal/personagendemo/personagen-svelte/src/routes/api/agent/[agentId]/generate-post/+server.ts:110 — server follows the changed media, not the advertised template surface

### P0 · C-HIDDEN-PRODUCT-ID · A product selected by preview is submitted even when the product UI is hidden

**Affected:** Every product-free/channel template on a persona with a pinned brand brief

A hidden value can steer copy and grading toward a product while the user sees a product-free channel composition.

- C:/Users/nexal/personagendemo/personagen-svelte/src/lib/components/generation/GenerationComposer.svelte:239 — preview product becomes local state unconditionally
- C:/Users/nexal/personagendemo/personagen-svelte/src/lib/components/generation/GenerationComposer.svelte:307 — confirm submits it without reference-policy gating
- C:/Users/nexal/personagendemo/personagen-svelte/src/routes/api/agent/[agentId]/generate-post/+server.ts:246 — preview chooses a product even for product-free compositions

### P0 · C-CHANNEL-BRAND-LEAK · The generator automatically selects a product whenever a brand brief exists, regardless of refs.product=false

**Affected:** All channel templates and future niche-planner channel ideas

The current “channel” contract removes a product photo but does not remove product strategy/copy context.

- C:/Users/nexal/personagendemo/personagen-svelte/src/lib/server/content/generate.ts:1333 — product selection occurs before the Director prompt
- C:/Users/nexal/personagendemo/personagen-svelte/src/lib/server/content/generate.ts:1335 — missing product id still falls back to the first product
- C:/Users/nexal/personagendemo/personagen-svelte/src/lib/server/content/generate.ts:3026 — Director receives Product instead of Topic when one is selected
- C:/Users/nexal/personagendemo/personagen-svelte/src/lib/server/content/generate.ts:3229 — refs.product only controls the image reference later

### P1 · C-CINEMATIC-REFS · Cinematic mode overrides the template reference contract and always requires both face and product

**Affected:** Any product-free or persona-free template switched to cinematic; channel cinematic Wild Card

Switching media can reveal and consume references that the clicked operation explicitly excluded.

- C:/Users/nexal/personagendemo/personagen-svelte/src/routes/api/agent/[agentId]/generate-post/+server.ts:260 — cinematic forces product use
- C:/Users/nexal/personagendemo/personagen-svelte/src/routes/api/agent/[agentId]/generate-post/+server.ts:258 — cinematic forces character use

### P1 · C-SPOKESPERSON-NO-PERSON · Spokesperson remains selectable for photo compositions that exclude the persona

**Affected:** Product-only, POV, mood-board, room, macro, flat-lay, and similar templates after switching to video

The talking-head branch can be requested without a character/face contract.

- C:/Users/nexal/personagendemo/personagen-svelte/src/lib/components/generation/GenerationComposer.svelte:? — UI disables spokesperson only for graphic cards
- C:/Users/nexal/personagendemo/personagen-svelte/src/lib/server/content/generate.ts:3122 — server coercion protects graphics only

### P0 · C-DELIVERY-INFERRED · Generation delivery is inferred from a nullable hidden body field rather than an explicit composer outcome

**Affected:** Persona Generate Now, calendar Generate Post Now, Studio review/asset flows

A button labelled Generate/Approve can publish immediately when a caller omits one hidden field.

- C:/Users/nexal/personagendemo/personagen-svelte/src/routes/api/agent/[agentId]/generate-post/+server.ts:215 — only review/asset override default behavior
- C:/Users/nexal/personagendemo/personagen-svelte/src/routes/api/agent/[agentId]/generate-post/+server.ts:209 — route documents immediate publication when no override exists
- C:/Users/nexal/personagendemo/personagen-svelte/src/lib/components/generation/GenerationComposer.svelte:312 — composer submits schedule fields but no explicit delivery policy

### P1 · C-ASSET-IRRELEVANT-FIELDS · Standalone-asset composers still show and submit publishing and schedule controls

**Affected:** Studio “Create standalone asset” mode

The composer asks for values that do not control standalone-asset delivery.

- C:/Users/nexal/personagendemo/personagen-svelte/src/lib/components/generation/GenerationComposer.svelte:311 — schedule is always submitted for post-kind specs
- C:/Users/nexal/personagendemo/personagen-svelte/src/lib/components/generation/GenerationComposer.svelte:306 — destinations are always submitted
- C:/Users/nexal/personagendemo/personagen-svelte/src/routes/api/agent/[agentId]/generate-post/+server.ts:220 — asset delivery overrides those controls

## Template-level findings

| Template | Intent | Advertised | Actual | References | Violations |
|---|---|---|---|---|---|
| Wild Card (wild-card) | channel | cinematic / Cinematic | cinematic / persona default / photo | character=true, product=true | channel template feeds a product reference; channel template copy explicitly depends on a product |
| Quote Card (quote-card) | channel | typographic / Text card | image / persona default / graphic | character=false, product=false | channel template copy explicitly depends on a product |
| Stat That Stops the Scroll (stat-shock) | channel | typographic / Text card | image / persona default / graphic | character=false, product=false | channel template copy explicitly depends on a product |
| Before / After Split (before-after-still) | channel | photo / Still image | image / persona default / photo | character=false, product=true | channel template feeds a product reference; channel template copy explicitly depends on a product |

## Full 41-template matrix

| Template | Intent | Surface | Pipeline | Actual media | Format | Still | Character | Product | Deliver |
|---|---|---|---|---|---|---|---:|---:|---|
| This Saved Me (creator-recommendation) | brand | motion | Talking head | video | spokesperson | photo | true | true | review (caller overlay) |
| Secret Hack Reveal (secret-hack) | brand | motion | Talking head | video | spokesperson | photo | true | true | review (caller overlay) |
| Before & After (before-after) | brand | motion | Talking head | video | spokesperson | photo | true | true | review (caller overlay) |
| Quick Tutorial (tutorial) | brand | motion | Talking head | video | spokesperson | photo | true | true | review (caller overlay) |
| Mild Obsession (obsession) | brand | motion | Talking head | video | spokesperson | photo | true | true | review (caller overlay) |
| Hyper Motion (hyper-motion) | brand | motion | Product motion | video | broll | photo | false | true | review (caller overlay) |
| Satisfying Test (satisfying-test) | brand | motion | Product motion | video | broll | photo | false | true | review (caller overlay) |
| Unboxing Reveal (unboxing-reveal) | brand | motion | Product motion | video | broll | photo | false | true | review (caller overlay) |
| The Placement (shelf-place) | brand | motion | Product motion | video | broll | photo | false | true | review (caller overlay) |
| TV Spot (tv-spot) | brand | cinematic | Cinematic | cinematic | persona default | photo | true | true | review (caller overlay) |
| Wild Card (wild-card) | channel | cinematic | Cinematic | cinematic | persona default | photo | true | true | review (caller overlay) |
| Mirror Check (lifestyle-still) | channel | photo | Still image | image | persona default | photo | true | false | review (caller overlay) |
| Product Flat-Lay (product-flatlay) | brand | photo | Still image | image | persona default | photo | false | true | review (caller overlay) |
| Quote Card (quote-card) | channel | typographic | Text card | image | persona default | graphic | false | false | review (caller overlay) |
| Hot Take (hot-take) | channel | typographic | Text card | image | persona default | graphic | false | false | review (caller overlay) |
| Stat That Stops the Scroll (stat-shock) | channel | typographic | Text card | image | persona default | graphic | false | false | review (caller overlay) |
| Before / After Split (before-after-still) | channel | photo | Still image | image | persona default | photo | false | true | review (caller overlay) |
| Mantra / Lyric Card (mantra-card) | channel | typographic | Text card | image | persona default | graphic | false | false | review (caller overlay) |
| Caption This (caption-this) | channel | photo | Still image | image | persona default | photo | true | false | review (caller overlay) |
| Unpopular Opinion (unpopular-opinion) | channel | typographic | Text card | image | persona default | graphic | false | false | review (caller overlay) |
| Myth vs Fact (myth-vs-fact) | channel | typographic | Text card | image | persona default | graphic | false | false | review (caller overlay) |
| The List (the-list) | channel | typographic | Text card | image | persona default | graphic | false | false | review (caller overlay) |
| Ask the Room (question-bait) | channel | typographic | Text card | image | persona default | graphic | false | false | review (caller overlay) |
| Define It (definition-card) | channel | typographic | Text card | image | persona default | graphic | false | false | review (caller overlay) |
| Both Can Be True (two-truths) | channel | typographic | Text card | image | persona default | graphic | false | false | review (caller overlay) |
| A Frame From Today (day-in-the-life) | channel | photo | Still image | image | persona default | photo | true | false | review (caller overlay) |
| Behind the Scenes (behind-the-scenes) | channel | photo | Still image | image | persona default | photo | true | false | review (caller overlay) |
| Mood Board (mood-board) | channel | photo | Still image | image | persona default | photo | false | false | review (caller overlay) |
| POV (pov-shot) | channel | photo | Still image | image | persona default | photo | false | false | review (caller overlay) |
| The Rant (the-rant) | channel | motion | Talking head | video | spokesperson | photo | true | false | review (caller overlay) |
| Story Time (story-time) | channel | motion | Talking head | video | spokesperson | photo | true | false | review (caller overlay) |
| Answer a Comment (answer-a-comment) | channel | motion | Talking head | video | spokesperson | photo | true | false | review (caller overlay) |
| Myth-Bust to Camera (myth-bust-video) | channel | motion | Talking head | video | spokesperson | photo | true | false | review (caller overlay) |
| Selfie Listicle (selfie-listicle) | channel | motion | Talking head | video | spokesperson | photo | true | false | review (caller overlay) |
| Get Ready With Me (grwm) | channel | motion | Talking head | video | spokesperson | photo | true | false | review (caller overlay) |
| Unfiltered Check-In (hot-mic-checkin) | channel | motion | Talking head | video | spokesperson | photo | true | false | review (caller overlay) |
| Don’t Search This (dont-search-this) | channel | motion | Talking head | video | spokesperson | photo | true | false | review (caller overlay) |
| The Real Reason (the-real-reason) | channel | motion | Talking head | video | spokesperson | photo | true | false | review (caller overlay) |
| The Check-In Selfie (selfie-checkin-photo) | channel | photo | Still image | image | persona default | photo | true | false | review (caller overlay) |
| Set the Timer (propped-timer) | channel | photo | Still image | image | persona default | photo | true | false | review (caller overlay) |
| The 0.5 (zero-five) | channel | photo | Still image | image | persona default | photo | true | false | review (caller overlay) |
