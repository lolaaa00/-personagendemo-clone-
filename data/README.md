# PersonaGen Data Architecture

## Static Layer (JSON — ships with site)

| File | Purpose | Replaces |
|------|---------|----------|
| `agents.json` | Influencer roster seed (4 core agents) | `INFLUENCERS` array in script.js |
| `trends.json` | Market trend hashtags | `TREND_ITEMS` array |
| `templates.json` | Generator names, bios, UGC scripts per niche | `GEN_NAMES`, `GEN_BIOS`, `GEN_UGC` |
| `platforms.json` | Platform distribution + spark chart data | `PLATFORM_DATA`, `SPARK_DATA` |
| `blueprints.json` | Demo channel blueprint (9-layer analysis) | Channel Decoder initial render |
| `scouts.json` | Per-niche scout intelligence profiles | Scout Intelligence preset data |

## Dynamic Layer (n8n Data Tables — runtime read/write)

| Table | ID | Purpose | Write Trigger |
|-------|-----|---------|--------------| 
| `personagen_clients` | `dTJuIFornHbkumVy` | Onboarded clients | Stripe webhook → n8n |
| `personagen_scout_reports` | `uHl3Dr5NzveT8lyr` | Intelligence engine results | Scout webhook → n8n |
| `personagen_generations` | `XS8VfCy0X4Dy7bTo` | Generated agent configs | Generator webhook → n8n |
| `personagen_metrics` | `GFuJp3qWCKUKSKnM` | Agent performance metrics | Cron → n8n scrape |
| `personagen_blueprints` | *(pending creation)* | Channel Decoder blueprints | Channel Decode webhook → n8n |
| `personagen_content_forge` | *(pending creation)* | Content Forge generations | Content Forge webhook → n8n |

## Client-Side Storage (localStorage)

| Key | Purpose | Module |
|-----|---------|--------|
| `personagen_blueprints` | Saved decoded channel blueprints | Channel Decoder |
| `personagen_posts_local` | Offline post drafts | API Local fallback |

## Data Flow

```
┌─ Page Load ─────────────────────────────────┐
│  fetch('/data/agents.json')     → Roster     │
│  fetch('/data/trends.json')     → Trend tick │
│  fetch('/data/templates.json')  → Generator  │
│  fetch('/data/platforms.json')  → Dashboard  │
│  fetch('/data/blueprints.json') → Ch.Decoder │
└──────────────────────────────────────────────┘

┌─ User Action ───────────────────────────────┐
│  "Run Scout"   → POST n8n webhook           │
│                → n8n: scrape + AI analyze    │
│                → INSERT personagen_scout_reports │
│                → return results to frontend  │
│                                              │
│  "Generate"    → POST n8n webhook            │
│                → n8n: AI persona generation  │
│                → INSERT personagen_generations│
│                → return agent config         │
│                                              │
│  "Decode"      → POST n8n channel-decode     │
│                → n8n: YouTube API + AI       │
│                → INSERT personagen_blueprints│
│                → return 9-layer blueprint    │
│                                              │
│  "Forge"       → POST n8n content-forge      │
│                → n8n: blueprint + AI gen     │
│                → INSERT personagen_content_forge │
│                → return content package      │
│                                              │
│  "Feed→Agent"  → POST n8n blueprints         │
│                → inject patterns into agent  │
│                → update agent skills.md      │
│                                              │
│  Stripe pay    → Stripe webhook → n8n        │
│                → INSERT personagen_clients   │
│                → trigger onboarding flow     │
└──────────────────────────────────────────────┘
```

## n8n API Access

Base URL: `https://n8n.jamesdev.pro/api/v1`
Data Tables API: `/data-tables/{tableId}/rows`

## Webhook Endpoints

| Endpoint | Purpose | Module |
|----------|---------|--------|
| `personagen-social` | Account connections | Accounts |
| `personagen-posts` | Post CRUD + calendar | Posts / Feed |
| `personagen-ai-generate` | AI content generation | Generate |
| `personagen-publish` | Publishing pipeline | Publish |
| `personagen-trends` | Trend scanning | Trends |
| `personagen-engagement` | Inbox management | Inbox |
| `personagen-account-factory` | Account creation | Factory |
| `personagen-email` | Email/SMS | Email |
| `personagen-channel-decode` | Channel reverse-engineering | Channel Decoder |
| `personagen-content-forge` | Blueprint → content | Content Forge |
| `personagen-blueprints` | Agent blueprint injection | Blueprints |

