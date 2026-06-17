# Graph Report - personagendemo  (2026-06-16)

## Corpus Check
- 121 files · ~113,744 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 659 nodes · 942 edges · 52 communities (47 shown, 5 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 5 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `8657af64`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 44|Community 44]]

## God Nodes (most connected - your core abstractions)
1. `createDbService()` - 33 edges
2. `$lib/stores/ui.svelte` - 19 edges
3. `scripts` - 13 edges
4. `$lib/components/agents/AgentChat.svelte` - 13 edges
5. `AccountFactoryClient` - 11 edges
6. `getOrCreateHermes()` - 11 edges
7. `ensureHermesConfig()` - 11 edges
8. `ensureAgentsManagedByHermes()` - 11 edges
9. `compilerOptions` - 11 edges
10. `ComposioClient` - 10 edges

## Surprising Connections (you probably didn't know these)
- `DELETE()` --calls--> `createDbService()`  [EXTRACTED]
  personagen-svelte/src/routes/api/agent/[agentId]/chat/+server.ts → personagen-svelte/src/lib/server/db.ts
- `GET()` --calls--> `createDbService()`  [EXTRACTED]
  personagen-svelte/src/routes/api/agent/[agentId]/chat/+server.ts → personagen-svelte/src/lib/server/db.ts
- `load()` --calls--> `createDbService()`  [INFERRED]
  personagen-svelte/src/routes/(portal)/persona-config/[[agentId]]/+page.server.ts → personagen-svelte/src/lib/server/db.ts
- `POST()` --calls--> `createDbService()`  [EXTRACTED]
  personagen-svelte/src/routes/api/accounts/+server.ts → personagen-svelte/src/lib/server/db.ts
- `load()` --calls--> `createDbService()`  [EXTRACTED]
  personagen-svelte/src/routes/(portal)/calendar/+page.server.ts → personagen-svelte/src/lib/server/db.ts

## Import Cycles
- None detected.

## Communities (52 total, 5 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.06
Nodes (51): load(), DELETE(), POST(), load(), load(), load(), actions, load() (+43 more)

### Community 1 - "Community 1"
Cohesion: 0.08
Nodes (37): browser, { captureSession }, db, refreshSession(), buildBaseHandle(), buildBio(), crypto, generateIdentity() (+29 more)

### Community 2 - "Community 2"
Cohesion: 0.05
Nodes (39): dependencies, @google/genai, @supabase/ssr, @supabase/supabase-js, devDependencies, eslint, eslint-config-prettier, @eslint/js (+31 more)

### Community 3 - "Community 3"
Cohesion: 0.06
Nodes (34): Agent, AgentChatMessage, AgentSession, AgentToolCall, ApiAction, ApiResponse, AUTONOMY_LABELS, AutonomyLevel (+26 more)

### Community 4 - "Community 4"
Cohesion: 0.19
Nodes (12): computeDynamicMetrics(), getPlatformFallbackMetrics(), getSeedHash(), POST(), syncLiveConnectionMetrics(), COMPOSIO_ACTION_MAPPING, ComposioClient, getAllSocialPlatforms() (+4 more)

### Community 5 - "Community 5"
Cohesion: 0.10
Nodes (24): createError, detectNicheFromBrandBrief(), displayHandle, filteredPersonas, GRADIENT_PRESETS, initial, isCreating, MARKETS (+16 more)

### Community 6 - "Community 6"
Cohesion: 0.08
Nodes (20): checkSession(), https, PIPELINE_STEPS, PipelineError, app, { checkSession }, config, cors (+12 more)

### Community 7 - "Community 7"
Cohesion: 0.11
Nodes (15): clearHistory(), filterAgents, filteredThreads, generateSimulationResponse(), getInitialGreeting(), handleKeyDown(), inputValue, isTyping (+7 more)

### Community 8 - "Community 8"
Cohesion: 0.10
Nodes (20): dependencies, better-sqlite3, cloakbrowser, cors, express, express-rate-limit, helmet, playwright-core (+12 more)

### Community 9 - "Community 9"
Cohesion: 0.11
Nodes (9): createAccount(), dbClient, envPath, getSupabase(), extractChannelName(), POST(), safeParseJson(), AccountFactoryClient (+1 more)

### Community 10 - "Community 10"
Cohesion: 0.12
Nodes (17): { captureSession }, config, { createInbox }, db, { EventEmitter }, { generateIdentity }, http, https (+9 more)

### Community 11 - "Community 11"
Cohesion: 0.24
Nodes (17): config, extractSiteKey(), fs, https, httpsGet(), httpsPost(), path, poll2Captcha() (+9 more)

### Community 12 - "Community 12"
Cohesion: 0.14
Nodes (12): brandColorsState, brandTransformState, initializeThemeAndColors(), setTheme(), sidebarState, Theme, themeState, ToastMessage (+4 more)

### Community 13 - "Community 13"
Cohesion: 0.15
Nodes (12): config, createInbox(), DuplicateInboxError, fetchMessages(), getJson(), http, https, InboxCreationError (+4 more)

### Community 14 - "Community 14"
Cohesion: 0.12
Nodes (8): days, hashtags, heatmapData, hours, niches, platforms, selectedNiche, sounds

### Community 15 - "Community 15"
Cohesion: 0.29
Nodes (10): $lib/components/agents/AgentChat.svelte, chatOpen, clearHistory(), fetchHistory(), handleSend(), initializeChat(), inputValue, isMaximized (+2 more)

### Community 16 - "Community 16"
Cohesion: 0.24
Nodes (3): active, $app/navigation, svelte

### Community 17 - "Community 17"
Cohesion: 0.15
Nodes (12): dependencies, express, @modelcontextprotocol/sdk, @supabase/supabase-js, zod, description, main, name (+4 more)

### Community 18 - "Community 18"
Cohesion: 0.15
Nodes (12): compilerOptions, allowJs, checkJs, esModuleInterop, forceConsistentCasingInFileNames, moduleResolution, resolveJsonModule, rewriteRelativeImportExtensions (+4 more)

### Community 19 - "Community 19"
Cohesion: 0.14
Nodes (12): close(), config, fs, getProfilePath(), launch(), path, { toPlaywrightConfig }, envSchema (+4 more)

### Community 20 - "Community 20"
Cohesion: 0.20
Nodes (7): ../app.css, $lib/stores/ui.svelte, $app/forms, instruction, on, $lib/components/shared/BrandWave.svelte, $lib/components/shared/Toast.svelte

### Community 21 - "Community 21"
Cohesion: 0.17
Nodes (6): crypto, fs, http, MAIL_API_PORT, path, server

### Community 22 - "Community 22"
Cohesion: 0.15
Nodes (17): DELETE(), executeTool(), GET(), POST(), toolsList, getServiceSupabase(), parseRssFeed(), pollRssFeeds() (+9 more)

### Community 23 - "Community 23"
Cohesion: 0.24
Nodes (8): clearInput(), EmailBlockedError, fs, humanType(), path, RateLimitError, screenshot(), signup()

### Community 24 - "Community 24"
Cohesion: 0.27
Nodes (6): canSubmit, passwordsMatch, @supabase/ssr, $lib/components/ui/Button.svelte, $lib/components/ui/Card.svelte, $lib/components/ui/Input.svelte

### Community 25 - "Community 25"
Cohesion: 0.31
Nodes (9): DB_FILE, extractAddress(), extractCode(), fs, loadInboxes(), main(), parseEmail(), path (+1 more)

### Community 26 - "Community 26"
Cohesion: 0.17
Nodes (8): $lib/components/agents/AgentConnectionStats.svelte, runScrape(), saveAll(), $lib/services/api, $lib/types, $app/environment, $app/stores, svelte/transition

### Community 27 - "Community 27"
Cohesion: 0.36
Nodes (7): { pollForInstagramSMS }, verifyPhone(), fetchLatestSMS(), https, httpsGet(), pollForInstagramSMS(), sleep()

### Community 28 - "Community 28"
Cohesion: 0.25
Nodes (6): HEALTH_PORT, http, log(), MAIL_API_PORT, server, shutdown()

### Community 30 - "Community 30"
Cohesion: 0.29
Nodes (5): $lib/components/agents/AgentRoster.svelte, $lib/types/agent, $lib/components/dashboard/KPIGrid.svelte, $lib/components/dashboard/PlatformBars.svelte, $lib/components/dashboard/SparkChart.svelte

### Community 31 - "Community 31"
Cohesion: 0.29
Nodes (6): dependencies, mailparser, smtp-server, name, private, version

### Community 32 - "Community 32"
Cohesion: 0.33
Nodes (4): app, server, supabase, transports

### Community 35 - "Community 35"
Cohesion: 0.40
Nodes (3): env, envContent, envPath

## Knowledge Gaps
- **296 isolated node(s):** `gitignorePath`, `name`, `private`, `version`, `type` (+291 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **5 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `$lib/stores/ui.svelte` connect `Community 20` to `Community 5`, `Community 7`, `Community 14`, `Community 15`, `Community 16`, `Community 24`, `Community 26`, `Community 30`?**
  _High betweenness centrality (0.080) - this node is a cross-community bridge._
- **Why does `devDependencies` connect `Community 2` to `Community 16`?**
  _High betweenness centrality (0.054) - this node is a cross-community bridge._
- **Why does `svelte` connect `Community 16` to `Community 2`?**
  _High betweenness centrality (0.053) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `createDbService()` (e.g. with `load()` and `load()`) actually correct?**
  _`createDbService()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **What connects `gitignorePath`, `name`, `private` to the rest of the system?**
  _296 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.06299603174603174 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.07822410147991543 - nodes in this community are weakly interconnected._