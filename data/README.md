# PersonaGen Data Architecture

## Static Layer (JSON — ships with site)

| File | Purpose | Replaces |
|------|---------|----------|
| `agents.json` | Influencer roster seed (4 core agents) | `INFLUENCERS` array in script.js |
| `trends.json` | Market trend hashtags | `TREND_ITEMS` array |
| `templates.json` | Generator names, bios, UGC scripts per niche | `GEN_NAMES`, `GEN_BIOS`, `GEN_UGC` |
| `platforms.json` | Platform distribution + spark chart data | `PLATFORM_DATA`, `SPARK_DATA` |

## Dynamic Layer (n8n Data Tables — runtime read/write)

| Table | ID | Purpose | Write Trigger |
|-------|-----|---------|--------------|
| `personagen_clients` | `dTJuIFornHbkumVy` | Onboarded clients | Stripe webhook → n8n |
| `personagen_scout_reports` | `uHl3Dr5NzveT8lyr` | Intelligence engine results | Scout webhook → n8n |
| `personagen_generations` | `XS8VfCy0X4Dy7bTo` | Generated agent configs | Generator webhook → n8n |
| `personagen_metrics` | `GFuJp3qWCKUKSKnM` | Agent performance metrics | Cron → n8n scrape |

## Data Flow

```
┌─ Page Load ─────────────────────────────────┐
│  fetch('/data/agents.json')   → Roster       │
│  fetch('/data/trends.json')   → Trend ticker  │
│  fetch('/data/templates.json')→ Generator     │
│  fetch('/data/platforms.json')→ Dashboard     │
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
│  Stripe pay    → Stripe webhook → n8n        │
│                → INSERT personagen_clients   │
│                → trigger onboarding flow     │
└──────────────────────────────────────────────┘
```

## n8n API Access

Base URL: `https://n8n.jamesdev.pro/api/v1`
Data Tables API: `/data-tables/{tableId}/rows`
