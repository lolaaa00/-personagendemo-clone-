# Graph Report - personagendemo  (2026-08-23)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 2778 nodes · 4328 edges · 225 communities (170 shown, 55 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 55 edges (avg confidence: 0.84)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `bc060ed0`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [agentId]/+page.svelte
- review/+page.svelte
- brand-brief/+page.svelte
- calendar/+page.svelte
- settings/+page.svelte
- PostDrawer.svelte
- createDbService
- models/+page.svelte
- GenerationComposer.svelte
- intel/+page.svelte
- generateUgcPack
- Builder
- card-renderer.ts
- guides/+page.svelte
- client_bootstrap.sql
- generate.ts
- inbox/+page.svelte
- generator/+page.svelte
- PostCard.svelte
- CalendarView.svelte
- CampaignPlanner.svelte
- generate-post/+server.ts
- pm/+page.svelte
- signup/+page.svelte
- dependencies
- AgentRoster.svelte
- ui.svelte.ts
- migration.sql
- orchestrator.js
- devDependencies
- generate-changelog.mjs
- user-api-keys.ts
- generations.svelte.ts
- src/server.js
- model-registry.ts
- generations/+page.svelte
- AnalyticsChart.svelte
- persona-profile.ts
- scheduler.ts
- loadFeed
- scripts
- (portal)/+layout.svelte
- favorites/+page.svelte
- db.js
- audit-composer-contracts.mjs
- showToast
- autopilot.ts
- dialog.ts
- persona-identity.ts
- persona-profile-store.ts
- publisher.ts
- zernio.ts
- verify-captcha.js
- engine/+server.ts
- storage.ts
- ZernioClient
- email.js
- AnalyticsPanel.svelte
- PersonaProjectsModal.svelte
- backfill-compress.ts
- SparkChart.svelte
- config/+server.ts
- saveAll
- queueKitSave
- config.js
- backfill-faststart.ts
- voices.ts
- compilerOptions
- lib/platforms.ts
- api.ts
- studio-templates.ts
- browser.js
- identity.js
- dashboard/+page.svelte
- api.js
- inbox-deliver.js
- verify-seed.mjs
- TraitPicker.svelte
- signup.js
- dependencies
- ai-client.ts
- apply_all_pending.sql
- src/package.json
- publish-post/+server.ts
- routes/+page.svelte
- health.js
- switch-media-host.ts
- changelog.ts
- Modal.svelte
- models/+server.ts
- lib/types.ts
- feature_requests_migration.sql
- mcp-bridge/package.json
- dependencies
- selfie-format-demo.mjs
- confirm
- bulkDeleteSelected
- hooks.server.ts
- getPostDisplay
- Input.svelte
- assertWithinBudget
- deleteBrief
- build-bootstrap.mjs
- public.model_registry
- export-easypanel-config.mjs
- ._executeStep
- mcp-bridge/server.js
- blotato-publish-queue.js
- eslint.config.js
- personagen-svelte/package.json
- run-migrations.js
- getDaysInMonth
- goNext
- ImageLightbox.svelte
- roadmap.ts
- config-check.ts
- delete-assets/+server.ts
- profile/+server.ts
- uvApi
- favorites_and_projects_migration.sql
- public.generation_events
- public.post_reviews
- user_api_keys_migration.sql
- zernio_key_manager_migration.sql
- validate-blotato-publish.mjs
- run-connections-provider-migration.js
- run-user-api-key-migrations.js
- app.d.ts
- changelog-copy.ts
- StatusBadge.svelte
- SelectionToolbar.svelte
- safe-fetch.ts
- [...path]/+server.ts
- canIntelProceed
- loadKitRestoreLibrary
- inRange
- postsForDateSorted
- feature-requests/+server.ts
- buildGenSpec
- getPostDisplay
- public.processed_rss_items
- scheduler_leases_migration.sql
- eslint-plugin-svelte
- svelte
- svelte-check
- @sveltejs/vite-plugin-svelte
- @types/node
- pre-commit
- goToday
- openDayView
- calendar/types.ts
- addIntelInterest
- generateIntelStrategy
- inferIntelIndustry
- addTrait
- dayLabel
- alignVoiceToGender
- checkStatuses
- entrypoint.sh
- public.agent_configs
- public.agent_configs
- public.connections
- public.connections
- public.user_api_keys
- public.brand_briefs
- public.connections
- public.posts
- public.connections
- public.connections
- public.agents
- public.posts
- public.agent_configs
- public.brand_briefs
- public.agents
- public.posts
- public.posts
- public.posts
- public.agent_configs
- public.connections
- public.posts
- public.posts
- public.user_api_keys
- public.agents
- public.agents
- public.generation_events

## God Nodes (most connected - your core abstractions)
1. `createDbService()` - 58 edges
2. `generateUgcPack()` - 49 edges
3. `generateCinematicUgcPack()` - 36 edges
4. `refineUgcMedia()` - 32 edges
5. `getServiceSupabase()` - 31 edges
6. `POST()` - 31 edges
7. `Builder` - 21 edges
8. `ZernioClient` - 20 edges
9. `scripts` - 20 edges
10. `dialog()` - 16 edges

## Surprising Connections (you probably didn't know these)
- `DELETE()` --calls--> `createDbService()`  [EXTRACTED]
  personagen-svelte/src/routes/api/agents/config/+server.ts → personagen-svelte/src/lib/server/db.ts
- `effectiveResolve()` --calls--> `resolveModel()`  [EXTRACTED]
  personagen-svelte/src/lib/server/model-registry.ts → personagen-svelte/src/lib/models.ts
- `POST()` --calls--> `executeKitStage()`  [EXTRACTED]
  personagen-svelte/src/routes/api/agent/[agentId]/generate-reference-kit/+server.ts → personagen-svelte/src/lib/server/content/generate.ts
- `generateCharacterPortrait()` --calls--> `priceOf()`  [EXTRACTED]
  personagen-svelte/src/lib/server/content/generate.ts → personagen-svelte/src/lib/pricing.ts
- `POST()` --calls--> `generateCharacterPortrait()`  [EXTRACTED]
  personagen-svelte/src/routes/api/agent/[agentId]/generate-avatar/+server.ts → personagen-svelte/src/lib/server/content/generate.ts

## Import Cycles
- None detected.

## Communities (225 total, 55 thin omitted)

### Community 0 - "[agentId]/+page.svelte"
Cohesion: 0.01
Nodes (156): AccountMeter, activeHoursEnd, activeHoursStart, activeTab, AGE_RANGES, agent, agentSpend, approvingPostId (+148 more)

### Community 1 - "review/+page.svelte"
Cohesion: 0.04
Nodes (57): act(), agentOptions, bulkDeleting, current, cursor, deleteBody(), deleteBusy, deletedToast() (+49 more)

### Community 2 - "brand-brief/+page.svelte"
Cohesion: 0.03
Nodes (52): activeTab, brandName, briefList, COMM_STYLES, commStyle, Competitor, competitors, currentBriefId (+44 more)

### Community 3 - "calendar/+page.svelte"
Cohesion: 0.03
Nodes (45): approving, Blueprint, brandName, bulkApproving, bulkDeleting, campaignOpen, composerAgentId, composerAgentPlatforms (+37 more)

### Community 4 - "settings/+page.svelte"
Cohesion: 0.04
Nodes (42): activeSection, apiKeyDeleting, apiKeyInputs, ApiKeyMetadata, ApiKeyProvider, apiKeys, apiKeySaving, apiKeysLoading (+34 more)

### Community 5 - "PostDrawer.svelte"
Cohesion: 0.04
Nodes (45): activePost, analytics, aspectsTotal, bodyEl, canPostNow, canRefine, canRepublish, canReschedule (+37 more)

### Community 6 - "createDbService"
Cohesion: 0.06
Nodes (36): load(), actions, load(), loadBriefForAgent(), AgentConfigRow, AgentConfigUpdate, AgentInsert, AgentRow (+28 more)

### Community 7 - "models/+page.svelte"
Cohesion: 0.05
Nodes (45): ADAPTER_PLANS, Age, ageFilter, bestValueId, call(), candidateCount, chosenTarget(), confirmSwapId (+37 more)

### Community 8 - "GenerationComposer.svelte"
Cohesion: 0.04
Nodes (42): activeComposition, activeSteps, aiBadge, captions, characterRefUrl, composition, deliverMode, destination (+34 more)

### Community 9 - "intel/+page.svelte"
Cohesion: 0.04
Nodes (37): brandName, briefCompetitors, briefProducts, currentBriefId, { data }, demographics, hydrated, INTEL_CONTENT_TYPES_LIST (+29 more)

### Community 10 - "generateUgcPack"
Cohesion: 0.11
Nodes (47): getModel(), resolveModel(), summarizeAspects(), summarizeCosts(), AiClient, buildBrandVisualContext(), buildCompositeFallbackPrompt(), buildEditInput() (+39 more)

### Community 11 - "Builder"
Cohesion: 0.06
Nodes (17): CFG, db(), insertedSlots(), { mockEnv, generateUgcPack, generateCinematicUgcPack, supabaseRef }, ledger(), { mockEnv }, isClaim(), { publishToPlatform, runAutopilotDraftGeneration, mockEnv, supabaseRef } (+9 more)

### Community 12 - "card-renderer.ts"
Cohesion: 0.09
Nodes (44): AccentBox, CARD_RENDERER_LABEL, CardComposition, CardLayout, CardPalette, cardRendererDisabled(), CardRenderInput, compose() (+36 more)

### Community 13 - "guides/+page.svelte"
Cohesion: 0.04
Nodes (40): CAT_LABEL, CATEGORIES, clCategories, clCategory, clExpanded, clGroups, clMajorsOnly, clMonths (+32 more)

### Community 14 - "client_bootstrap.sql"
Cohesion: 0.09
Nodes (42): agent_configs_updated_at, agent_memories_updated_at, agents_updated_at, brand_briefs_updated_at, chat_sessions_updated_at, model_registry_updated_at, on_auth_user_created, persona_groups_updated_at (+34 more)

### Community 15 - "generate.ts"
Cohesion: 0.05
Nodes (43): GenerationProvenance, buildFaceCloseupPrompt(), buildFeatureGridPrompt(), buildHookGuidance(), buildSideProfilePrompt(), buildT2iInput(), characterNameFromSoul(), CINEMATIC_MAX_TOTAL_SECONDS (+35 more)

### Community 16 - "inbox/+page.svelte"
Cohesion: 0.06
Nodes (31): activeTab, agentFilter, agents, chatContainer, clearHistory(), currentLogs, { data }, emails (+23 more)

### Community 17 - "generator/+page.svelte"
Cohesion: 0.06
Nodes (36): agentName, applyGeneratedPersona(), buildCreatePayload(), buildProfileFromGenerated(), createError, createPersonaDirect(), currentStep, { data } (+28 more)

### Community 18 - "PostCard.svelte"
Cohesion: 0.07
Nodes (33): analytics, display, elapsedS, genError, genTopic, hasError, hasRealStats, isFailed (+25 more)

### Community 19 - "CalendarView.svelte"
Cohesion: 0.05
Nodes (30): agentFiltered, anchorDate, approvingAll, approvingIds, CalendarCell, calendarView, currentMonth, currentYear (+22 more)

### Community 20 - "CampaignPlanner.svelte"
Cohesion: 0.07
Nodes (32): agentId, agentName, allocation, buildPlan(), cancelled, capped, channelWeightedCycle(), CLASSES (+24 more)

### Community 21 - "generate-post/+server.ts"
Cohesion: 0.16
Nodes (27): appearanceToPromptClause(), AspectProvenance, CostEvent, OPERATION_LABELS, PriceEntry, priceOf(), PRICING_MATRIX, buildHeroPortraitPrompt() (+19 more)

### Community 22 - "pm/+page.svelte"
Cohesion: 0.07
Nodes (27): addTicket(), ColumnKey, COLUMNS, { data }, deleteTicket(), editingAssignee, editingDescription, editingPriority (+19 more)

### Community 23 - "signup/+page.svelte"
Cohesion: 0.06
Nodes (31): canSubmit, confirmDescribedBy, confirmEl, confirmInvalid, confirmPassword, email, emailDescribedBy, emailEl (+23 more)

### Community 24 - "dependencies"
Cohesion: 0.07
Nodes (29): better-sqlite3, cors, express-rate-limit, helmet, playwright-core, dependencies, better-sqlite3, cloakbrowser (+21 more)

### Community 25 - "AgentRoster.svelte"
Cohesion: 0.07
Nodes (19): { agents }, allVisibleSelected, closeConfirm(), confirmDelete(), confirmOpen, currentFilter, deleteConfirmText, deleting (+11 more)

### Community 26 - "ui.svelte.ts"
Cohesion: 0.11
Nodes (23): Particle, particles, iconMap, applyBrandTheme(), brandColorsState, brandThemeState, brandTransformState, clearBrandTheme() (+15 more)

### Community 27 - "migration.sql"
Cohesion: 0.14
Nodes (25): agent_configs_updated_at, agent_memories_updated_at, agents_updated_at, brand_briefs_updated_at, chat_sessions_updated_at, on_auth_user_created, posts_updated_at, profiles_updated_at (+17 more)

### Community 28 - "orchestrator.js"
Cohesion: 0.09
Nodes (24): { captureSession }, config, { createInbox }, db, { EventEmitter }, { generateIdentity }, http, https (+16 more)

### Community 29 - "devDependencies"
Cohesion: 0.07
Nodes (27): eslint, eslint-config-prettier, @eslint/js, globals, devDependencies, eslint, eslint-config-prettier, @eslint/js (+19 more)

### Community 30 - "generate-changelog.mjs"
Cohesion: 0.09
Nodes (24): autoCopy(), byCat, categorize(), CATEGORY_RULES, CATEGORY_WORDS, cats, classifyType(), clip() (+16 more)

### Community 31 - "user-api-keys.ts"
Cohesion: 0.18
Nodes (23): decryptSecret(), EncryptedSecret, encryptSecret(), getEncryptionKey(), getUserApiKey(), isSupportedProvider(), maskApiKey(), sanitizeKeyMetadata() (+15 more)

### Community 32 - "generations.svelte.ts"
Cohesion: 0.10
Nodes (19): active, failed, now, open, visible, elapsed, { job, variant = 'card', onRetry = null, onDismiss = null }, now (+11 more)

### Community 33 - "src/server.js"
Cohesion: 0.08
Nodes (20): checkSession(), https, PIPELINE_STEPS, PipelineError, app, { checkSession }, config, cors (+12 more)

### Community 34 - "model-registry.ts"
Cohesion: 0.11
Nodes (20): DEFAULT_MODEL, MODEL_CATALOG, ModelKind, ModelOption, modelsFor(), QualityTier, TIER_LABEL, AUDIO_SYNONYMS (+12 more)

### Community 35 - "generations/+page.svelte"
Cohesion: 0.08
Nodes (19): approving, contentPosts, { data }, favOnly, formatFilter, KIT_LABELS, kits, Lens (+11 more)

### Community 36 - "AnalyticsChart.svelte"
Cohesion: 0.13
Nodes (19): chartSummary, formatDate(), formatNum(), gridSteps, handleMove(), handleTouch(), hoverIdx, maxVal (+11 more)

### Community 37 - "persona-profile.ts"
Cohesion: 0.14
Nodes (21): ADVANCED_APPEARANCE_FIELDS, APPEARANCE_FIELDS, APPEARANCE_TRAIT_OPTIONS, AppearanceFieldGroup, AppearanceKey, BEST_FIT, BODY_TYPE_OPTIONS, CURATED_APPEARANCE_FIELDS (+13 more)

### Community 38 - "scheduler.ts"
Cohesion: 0.18
Nodes (19): isRetriableError(), acquireSchedulerLease(), acquireSchedulerLock(), isMissingLeaseInfra(), LOCK_FILE, renewSchedulerLease(), pollScheduledPosts(), publishSinglePost() (+11 more)

### Community 39 - "loadFeed"
Cohesion: 0.12
Nodes (21): askToGenerate(), clearReferenceFile(), confirmPublishFallback(), fetchKitState(), fillDraftsNow(), generateAllKitStages(), generateAvatar(), generateAvatarFromReference() (+13 more)

### Community 40 - "scripts"
Cohesion: 0.10
Nodes (20): scripts, backfill:compress, backfill:faststart, build, changelog, changelog:check, changelog:list, check (+12 more)

### Community 41 - "(portal)/+layout.svelte"
Cohesion: 0.11
Nodes (15): closeSidebar(), toggleSidebarCollapse(), { children, data }, closeUserDropdown(), collapsedGroups, filteredSidebarAgents, groupedSidebar, handleLogout() (+7 more)

### Community 42 - "favorites/+page.svelte"
Cohesion: 0.11
Nodes (12): readParam(), syncParam(), approving, configs, { data }, groups, lightbox, modalPost (+4 more)

### Community 43 - "db.js"
Cohesion: 0.19
Nodes (18): config, countRecentCreations(), createAccount(), Database, decryptCookies(), decryptRow(), deleteAccount(), { encrypt, decrypt } (+10 more)

### Community 44 - "audit-composer-contracts.mjs"
Cohesion: 0.12
Nodes (17): counts, evidence(), expectedByPipeline, expectedMediaBySurface, here, jsonPath, lineOf(), matrix (+9 more)

### Community 45 - "showToast"
Cohesion: 0.11
Nodes (15): Props, {
		variant = 'primary',
		type = 'button',
		disabled = false,
		loading = false,
		onclick,
		class: className = '',
		children
	}, {
		dark = false,
		class: className = '',
		header,
		title,
		description,
		children,
		footer
	}, Props, showToast(), themeState, email, emailEl (+7 more)

### Community 46 - "autopilot.ts"
Cohesion: 0.19
Nodes (17): addDaysToDateStr(), AgentConfig, buildSlots(), clampHour(), generateDraftsForAgent(), GenerateOpts, getLocalParts(), intFromEnv() (+9 more)

### Community 47 - "dialog.ts"
Cohesion: 0.20
Nodes (16): attachGlobals(), detachGlobals(), dialog(), DialogOptions, Entry, FOCUSABLE, focusablesIn(), isVisible() (+8 more)

### Community 48 - "persona-identity.ts"
Cohesion: 0.20
Nodes (16): BIO_PLATFORM_KEYS, bioLimit(), coerceBios(), coerceConfirmedHandles(), coerceHandleCandidates(), HANDLE_MAX, HANDLE_STATUSES, handleCompatNote() (+8 more)

### Community 49 - "persona-profile-store.ts"
Cohesion: 0.20
Nodes (16): HandleCandidate, AGE_RANGE_KEYS, coerceAgeRanges(), CONTENT_FOCUS_OPTIONS, PERSONA_ARCHETYPES, AGE_RANGE_BOUNDS, ageBoundsFromRanges(), coerceText() (+8 more)

### Community 50 - "publisher.ts"
Cohesion: 0.17
Nodes (16): extractMediaItems(), getStoredZernioAccountId(), getTextContent(), getZernioAccounts(), platformAliases(), PublishPlatformInput, PublishPlatformResult, publishToPlatform() (+8 more)

### Community 51 - "zernio.ts"
Cohesion: 0.18
Nodes (16): accountBandPriceUsd(), computeZernioAccountMeter(), MANUAL_DELETE_ONLY_PLATFORMS, ZernioAccountMeter, ZernioPostMetrics, ZernioProfile, ZernioPublishInput, ZernioPublishResult (+8 more)

### Community 52 - "verify-captcha.js"
Cohesion: 0.24
Nodes (17): config, extractSiteKey(), fs, https, httpsGet(), httpsPost(), path, poll2Captcha() (+9 more)

### Community 53 - "engine/+server.ts"
Cohesion: 0.23
Nodes (16): coerceAppearance(), coerceToOption(), stripLeadingAvatarName(), buildRichAgentContext(), inferGenderFromName(), APPEARANCE_CONTRACT, appearanceFingerprint(), assertPublicHttpUrl() (+8 more)

### Community 54 - "storage.ts"
Cohesion: 0.20
Nodes (14): repinKitStage(), RESTORABLE_KIT_STAGES, ensureBucket(), isDurableBucketUrl(), isOwnedBucketUrl(), listUserImages(), ownedStorageOrigin(), StoredImage (+6 more)

### Community 56 - "email.js"
Cohesion: 0.17
Nodes (13): config, createInbox(), DuplicateInboxError, fetchMessages(), getJson(), http, https, InboxCreationError (+5 more)

### Community 57 - "AnalyticsPanel.svelte"
Cohesion: 0.13
Nodes (14): { agents }, analytics, AnalyticsData, chartSeries, effectiveId, error, formatNum(), loading (+6 more)

### Community 58 - "PersonaProjectsModal.svelte"
Cohesion: 0.16
Nodes (13): assign(), assigningId, busy, call(), commitRename(), confirmingDeleteId, createGroup(), deleteGroup() (+5 more)

### Community 59 - "backfill-compress.ts"
Cohesion: 0.21
Nodes (14): APPLY, classify(), compress(), crfArg, fetchVideoPosts(), ffmpegAvailable(), isDurableBucketUrl(), limitArg (+6 more)

### Community 60 - "SparkChart.svelte"
Cohesion: 0.16
Nodes (14): allVals, chartSummary, COLORS, DAYS, gridSteps, hasData, legendItems, maxVal (+6 more)

### Community 61 - "config/+server.ts"
Cohesion: 0.26
Nodes (11): parseObject(), profileToMarketString(), readPersonaProfile(), AgentConfigInsert, isMissingPersonasProfileColumn(), PERSONAS_PROFILE_COLUMN, withoutPersonasProfile(), writeWithProfileFallback() (+3 more)

### Community 62 - "saveAll"
Cohesion: 0.15
Nodes (15): addManualProduct(), applySpinVariation(), cancelEditProduct(), deleteCompetitors(), deleteProducts(), extendField(), generateField(), getBrandContext() (+7 more)

### Community 63 - "queueKitSave"
Cohesion: 0.14
Nodes (15): addOwnHandle(), applyBrandKit(), applyIdentityKit(), currentPersonaProfile(), flushPendingKitSave(), generateKit(), generatePersonaProfile(), queueKitSave() (+7 more)

### Community 64 - "config.js"
Cohesion: 0.15
Nodes (12): envSchema, hexKey32, { z }, browser, { captureSession }, db, refreshSession(), captureSession() (+4 more)

### Community 65 - "backfill-faststart.ts"
Cohesion: 0.23
Nodes (13): APPLY, classify(), fetchVideoPosts(), ffmpegAvailable(), isDurableBucketUrl(), limitArg, main(), pool() (+5 more)

### Community 66 - "voices.ts"
Cohesion: 0.21
Nodes (10): ACCENT_ALIASES, BUILTIN_VOICES, DEFAULT_VOICE, isValidVoice(), pickVoiceForProfile(), SAMPLE_LINE, VOICE_CATALOG, VoiceOption (+2 more)

### Community 67 - "compilerOptions"
Cohesion: 0.14
Nodes (13): compilerOptions, allowJs, checkJs, esModuleInterop, forceConsistentCasingInFileNames, moduleResolution, resolveJsonModule, rewriteRelativeImportExtensions (+5 more)

### Community 68 - "lib/platforms.ts"
Cohesion: 0.19
Nodes (10): PlatformStatus, { platformStatuses, platformMetrics, platforms }, Props, stats, {
		entries,
		onClose
	}, ALL_PLATFORM_KEYS, platformColor(), PlatformInfo (+2 more)

### Community 69 - "api.ts"
Cohesion: 0.15
Nodes (11): Accounts, Autopilot, AutopilotView, Blueprints, BrandBrief, ContentForge, ENDPOINTS, GeneratedPersona (+3 more)

### Community 70 - "studio-templates.ts"
Cohesion: 0.15
Nodes (12): MIRROR_LOOK, PIPELINE_META, PIPELINE_USD, PROPPED_LOOK, NOTE: there is no text-only generation path — /api/agent/:id/generate-post, SELFIE_LOOK, STUDIO_CATEGORIES, STUDIO_SURFACES (+4 more)

### Community 71 - "browser.js"
Cohesion: 0.19
Nodes (9): close(), config, fs, getProfilePath(), launch(), path, { toPlaywrightConfig }, net (+1 more)

### Community 72 - "identity.js"
Cohesion: 0.26
Nodes (10): buildBaseHandle(), buildBio(), crypto, generateIdentity(), generateSecurePassword(), generateUsernameVariations(), { hashSeed }, randomDigits() (+2 more)

### Community 73 - "dashboard/+page.svelte"
Cohesion: 0.17
Nodes (9): { agents, postsThisWeek = 0 }, KPI, kpis, Props, { platforms }, Props, PlatformData, creatorAgents (+1 more)

### Community 74 - "api.js"
Cohesion: 0.24
Nodes (11): authCheck(), crypto, fs, http, loadInboxes(), log(), MAIL_API_PORT, parseBody() (+3 more)

### Community 75 - "inbox-deliver.js"
Cohesion: 0.27
Nodes (10): RFC-5322, DB_FILE, extractAddress(), extractCode(), fs, loadInboxes(), main(), parseEmail() (+2 more)

### Community 76 - "verify-seed.mjs"
Cohesion: 0.33
Nodes (10): api(), create(), destroy(), env, findUser(), H, IMG(), insert() (+2 more)

### Community 77 - "TraitPicker.svelte"
Cohesion: 0.33
Nodes (10): {
		appearance = $bindable(),
		disabled = false
	}, chipsFor(), customValue(), expanded, hiddenCount(), isSelected(), onRowKeydown(), select() (+2 more)

### Community 78 - "signup.js"
Cohesion: 0.24
Nodes (8): clearInput(), EmailBlockedError, fs, humanType(), path, RateLimitError, screenshot(), signup()

### Community 79 - "dependencies"
Cohesion: 0.20
Nodes (10): @google/genai, dependencies, @google/genai, @supabase/ssr, @supabase/supabase-js, undici, @supabase/supabase-js, @supabase/supabase-js (+2 more)

### Community 80 - "ai-client.ts"
Cohesion: 0.31
Nodes (7): AiGenerateOptions, createGeminiClient(), createOpenRouterClient(), fetchImageInlineData(), resolveAiClient(), fetchWithTimeout(), PROVIDER_FETCH_TIMEOUT_MS

### Community 81 - "apply_all_pending.sql"
Cohesion: 0.22
Nodes (8): public.post_reviews, public.scheduler_leases, public.zernio_keys, auth.users, public.agents, public.posts, public.update_updated_at, zernio_keys_updated_at

### Community 82 - "src/package.json"
Cohesion: 0.22
Nodes (8): mailparser, dependencies, mailparser, smtp-server, name, private, version, smtp-server

### Community 83 - "publish-post/+server.ts"
Cohesion: 0.42
Nodes (7): VIDEO_ONLY_PLATFORMS, connectedCompatible(), GET(), mediaTypeOf(), ownedAgentAndPost(), OwnedCtx, POST()

### Community 84 - "routes/+page.svelte"
Cohesion: 0.22
Nodes (8): COMPARISON, { data }, FAQS, FEATURES, PLANS, PLATFORMS, STEPS, year

### Community 85 - "health.js"
Cohesion: 0.31
Nodes (8): checkAgenticMailAPI(), checkStalwart(), HEALTH_PORT, http, log(), MAIL_API_PORT, server, shutdown()

### Community 86 - "switch-media-host.ts"
Cohesion: 0.29
Nodes (7): APPLY, main(), probeCdn(), REVERT, supabase, SUPABASE_URL, Target

### Community 87 - "changelog.ts"
Cohesion: 0.25
Nodes (7): CHANGE_GROUPS, ChangeCategory, ChangeEntry, ChangeGroup, CHANGELOG, CHANGELOG_GENERATED_FROM, ChangeType

### Community 88 - "Modal.svelte"
Cohesion: 0.25
Nodes (6): isDurable, isVideo, { open, url, title = 'Generated asset', onRegenerate = null, regenerating = false, onClose }, Props, { open, title, subtitle, size = 'md', onClose, children, footer }, Props

### Community 89 - "models/+server.ts"
Cohesion: 0.43
Nodes (7): adapterFromProbe(), parsePriceText(), probeModelSchema(), RegistryKind, syncFromFal(), KINDS, POST()

### Community 90 - "lib/types.ts"
Cohesion: 0.29
Nodes (6): SparkData, ApiAction, ApiResponse, AUTONOMY_LABELS, AutonomyLevel, Agent

### Community 91 - "feature_requests_migration.sql"
Cohesion: 0.32
Nodes (6): public.feature_request_votes, public.feature_requests, auth, auth.users, public.feature_requests_guard_status, trg_feature_requests_guard_status

### Community 92 - "mcp-bridge/package.json"
Cohesion: 0.25
Nodes (7): description, main, name, scripts, start, type, version

### Community 93 - "dependencies"
Cohesion: 0.29
Nodes (7): @modelcontextprotocol/sdk, dependencies, express, @modelcontextprotocol/sdk, zod, express, zod

### Community 94 - "selfie-format-demo.mjs"
Cohesion: 0.29
Nodes (3): buf, outDir, outPath

### Community 95 - "confirm"
Cohesion: 0.29
Nodes (7): confirm(), deleteAgent(), deleteAssets(), deleteKitHistoryImage(), deleteSelectedAssets(), deleteSelectedPosts(), handleAutonomyChange()

### Community 96 - "bulkDeleteSelected"
Cohesion: 0.33
Nodes (7): bulkDeleteSelected(), deleteBody(), deletePost(), generatePostNow(), handleCampaignLaunched(), pruneSelection(), resyncPosts()

### Community 97 - "hooks.server.ts"
Cohesion: 0.47
Nodes (3): handle(), PROTECTED_PREFIXES, createSupabaseServerClient()

### Community 98 - "getPostDisplay"
Cohesion: 0.33
Nodes (6): getPostDisplay(), getPostThumb(), filteredPosts, genFailedCount, groupedPosts, postMediaType()

### Community 99 - "Input.svelte"
Cohesion: 0.33
Nodes (5): describedBy, fieldId, Props, uid, {
		value = $bindable(),
		element = $bindable(null),
		type = 'text',
		id,
		required = false,
		class: className = '',
		label,
		ariaLabel,
		hint,
		error = null,
		...rest
	}

### Community 100 - "assertWithinBudget"
Cohesion: 0.67
Nodes (5): assertWithinBudget(), DAILY_PER_AGENT_USD(), MONTHLY_PER_USER_USD(), sumSpend(), usdFromEnv()

### Community 101 - "deleteBrief"
Cohesion: 0.40
Nodes (6): deleteBrief(), hydrate(), newBrief(), persistBriefToDb(), refreshBriefList(), switchBrief()

### Community 102 - "build-bootstrap.mjs"
Cohesion: 0.33
Nodes (3): here, ORDER, parts

### Community 103 - "public.model_registry"
Cohesion: 0.33
Nodes (5): model_registry_updated_at, public.model_registry, auth, auth.users, public.update_updated_at

### Community 104 - "export-easypanel-config.mjs"
Cohesion: 0.47
Nodes (5): allowInRepo, main(), PANEL_URL, parseEnv(), query()

### Community 106 - "mcp-bridge/server.js"
Cohesion: 0.33
Nodes (4): app, server, supabase, transports

### Community 107 - "blotato-publish-queue.js"
Cohesion: 0.40
Nodes (4): flat, meta, PUBLISH_SCHEMA, VERIFY_SCHEMA

### Community 109 - "personagen-svelte/package.json"
Cohesion: 0.40
Nodes (4): name, private, type, version

### Community 110 - "run-migrations.js"
Cohesion: 0.40
Nodes (3): env, envContent, envPath

### Community 111 - "getDaysInMonth"
Cohesion: 0.40
Nodes (5): calendarCells, capPickerDay(), getDaysInMonth(), getFirstDayOfMonth(), pickerDays

### Community 112 - "goNext"
Cohesion: 0.40
Nodes (5): goNext(), goPrev(), nextMonth(), prevMonth(), shiftCursor()

### Community 113 - "ImageLightbox.svelte"
Cohesion: 0.40
Nodes (3): contentEl, isVideo, {
		url = null,
		label = '',
		type = null,
		poster = null,
		onClose
	}

### Community 114 - "roadmap.ts"
Cohesion: 0.40
Nodes (4): ROADMAP, ROADMAP_STATUSES, RoadmapItem, RoadmapStatus

### Community 115 - "config-check.ts"
Cohesion: 0.60
Nodes (3): checkConfigStatus(), ConfigStatus, load()

### Community 116 - "delete-assets/+server.ts"
Cohesion: 0.70
Nodes (4): clearCharacterRef(), removeKitAssets(), POST(), requireOwnedAgent()

### Community 118 - "uvApi"
Cohesion: 0.50
Nodes (5): uvApi(), uvDelete(), uvLoad(), uvSubmit(), uvVote()

### Community 119 - "favorites_and_projects_migration.sql"
Cohesion: 0.40
Nodes (4): persona_groups_updated_at, public.persona_groups, auth.users, public.update_updated_at

### Community 120 - "public.generation_events"
Cohesion: 0.40
Nodes (4): public.generation_events, auth.users, public.agents, public.posts

### Community 121 - "public.post_reviews"
Cohesion: 0.40
Nodes (4): public.post_reviews, auth.users, public.agents, public.posts

### Community 122 - "user_api_keys_migration.sql"
Cohesion: 0.40
Nodes (4): public.user_api_keys, auth.users, public.update_updated_at, user_api_keys_updated_at

### Community 123 - "zernio_key_manager_migration.sql"
Cohesion: 0.40
Nodes (4): public.zernio_keys, auth.users, public.update_updated_at, zernio_keys_updated_at

### Community 127 - "app.d.ts"
Cohesion: 0.50
Nodes (3): App, Locals, Platform

### Community 128 - "changelog-copy.ts"
Cohesion: 0.50
Nodes (3): GROUP_COPY, GroupCopy, MILESTONES

### Community 129 - "StatusBadge.svelte"
Cohesion: 0.50
Nodes (3): Props, { status }, statusConfig

### Community 131 - "safe-fetch.ts"
Cohesion: 1.00
Nodes (3): isPrivateOrReservedIp(), resolvePublicIps(), safeFetch()

### Community 133 - "canIntelProceed"
Cohesion: 0.50
Nodes (4): canIntelProceed(), goToIntelStep(), nextIntelStep(), reachableStep()

### Community 134 - "loadKitRestoreLibrary"
Cohesion: 0.50
Nodes (4): loadKitRestoreLibrary(), openKitRestore(), setKitRestoreMode(), stageHistory()

### Community 135 - "inRange"
Cohesion: 0.67
Nodes (3): fmtDate(), inRange, rangeStats

### Community 136 - "postsForDateSorted"
Cohesion: 0.67
Nodes (3): getPostsForDate(), postsForDateSorted(), selectedDayPosts

### Community 138 - "buildGenSpec"
Cohesion: 0.67
Nodes (3): buildGenSpec(), handleComposerAgentChange(), requestGeneratePost()

### Community 139 - "getPostDisplay"
Cohesion: 1.00
Nodes (3): getPostDisplay(), getPostThumb(), openLightbox()

## Knowledge Gaps
- **1249 isolated node(s):** `AccountMeter`, `AssetItem`, `KitStage`, `PlatformStatus`, `ProfileLayout` (+1244 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **55 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `showToast()` connect `showToast` to `[agentId]/+page.svelte`, `brand-brief/+page.svelte`, `ui.svelte.ts`, `calendar/+page.svelte`, `generations/+page.svelte`, `settings/+page.svelte`, `models/+page.svelte`, `favorites/+page.svelte`, `inbox/+page.svelte`, `generator/+page.svelte`, `pm/+page.svelte`, `signup/+page.svelte`, `AgentRoster.svelte`, `PersonaProjectsModal.svelte`?**
  _High betweenness centrality (0.048) - this node is a cross-community bridge._
- **Why does `syncParam()` connect `favorites/+page.svelte` to `[agentId]/+page.svelte`, `review/+page.svelte`, `brand-brief/+page.svelte`, `generations/+page.svelte`, `settings/+page.svelte`, `models/+page.svelte`, `intel/+page.svelte`, `guides/+page.svelte`, `generator/+page.svelte`, `CalendarView.svelte`?**
  _High betweenness centrality (0.036) - this node is a cross-community bridge._
- **Why does `createDbService()` connect `createDbService` to `generateUgcPack`, `autopilot.ts`, `generate.ts`, `publisher.ts`, `zernio.ts`, `delete-assets/+server.ts`, `generate-post/+server.ts`, `publish-post/+server.ts`, `storage.ts`, `engine/+server.ts`, `config/+server.ts`?**
  _High betweenness centrality (0.022) - this node is a cross-community bridge._
- **What connects `AccountMeter`, `AssetItem`, `KitStage` to the rest of the system?**
  _1249 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `[agentId]/+page.svelte` be split into smaller, more focused modules?**
  _Cohesion score 0.00980392156862745 - nodes in this community are weakly interconnected._
- **Should `review/+page.svelte` be split into smaller, more focused modules?**
  _Cohesion score 0.04009324009324009 - nodes in this community are weakly interconnected._
- **Should `brand-brief/+page.svelte` be split into smaller, more focused modules?**
  _Cohesion score 0.03125 - nodes in this community are weakly interconnected._