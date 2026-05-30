# Proxy Strategy Guide — Account Factory

**Platform:** PersonaGen Account Factory  
**Document Type:** Client Delivery — Proxy Reference  

> Proxies are the single most critical factor in account creation success rates. This guide covers the four proxy tiers, when to use each, and how to configure them in the factory service.

---

## Proxy Tier Overview

| Tier | Type | Cost | Success Rate | Use Case |
|------|------|------|-------------|----------|
| **Tier 0** | Own IP | $0/mo | ⚠️ Risky | Local development and testing only |
| **Tier 1** | Budget Residential | ~$1.50–3/GB | 60–75% | Low-volume creation, cost-sensitive deployments |
| **Tier 2** | Standard Residential | ~$7–12/GB | 80–90% | Production use, recommended baseline |
| **Tier 3** | Mobile (4G/5G) | ~$15–30/GB | 90–98% | High-value targets, maximum stealth |

---

## Tier 0 — Own IP (Development Only)

**Cost:** $0  
**When to use:** Local development and testing against non-production targets.

Leave all `PROXY_*` environment variables empty. The factory will use the server's native IP.

> [!CAUTION]
> **Never use Tier 0 for production account creation.** Your server's datacenter IP will be immediately flagged. Accounts created from datacenter IPs are typically banned within hours. Your IP may also be permanently blacklisted, affecting all other services on that server.

---

## Tier 1 — Budget Residential

**Cost:** ~$1.50–3.00/GB  
**Success Rate:** 60–75%  
**Recommended Providers:**

| Provider | Price/GB | Geo Targeting | Rotation | Notes |
|----------|---------|---------------|----------|-------|
| [IPRoyal](https://iproyal.com) | ~$1.75 | Country-level | Per-request or sticky | Good value, pay-as-you-go |
| [PacketStream](https://packetstream.io) | ~$1.00 | Country-level | Per-request | Cheapest option, less reliable |
| [Webshare](https://webshare.io) | ~$2.50 | Country-level | Configurable | Free tier available (not recommended) |

**Best for:** Testing creation flows, low-volume deployments (1–3 accounts/day), budget-conscious clients.

**Limitations:** Higher detection rates, some IPs may be previously flagged, limited geo-targeting granularity.

---

## Tier 2 — Standard Residential

**Cost:** ~$7–12/GB  
**Success Rate:** 80–90%  
**Recommended Providers:**

| Provider | Price/GB | Geo Targeting | Rotation | Notes |
|----------|---------|---------------|----------|-------|
| [SmartProxy](https://smartproxy.com) | ~$7.00 | City-level | Sticky 10–30 min | **Recommended default** |
| [Bright Data](https://brightdata.com) | ~$9.50 | City-level | Configurable | Largest pool, enterprise features |
| [Oxylabs](https://oxylabs.io) | ~$10.00 | City-level | Sticky or rotating | Premium quality, higher minimums |

**Best for:** Production deployments, daily account creation, sustained operations.

**Why this tier works:** These providers maintain large, clean residential IP pools. City-level targeting lets you match proxy location to the persona's supposed location, reducing geographic anomaly flags.

---

## Tier 3 — Mobile (4G/5G)

**Cost:** ~$15–30/GB  
**Success Rate:** 90–98%  
**Recommended Providers:**

| Provider | Price/GB | Network Type | Notes |
|----------|---------|-------------|-------|
| [Soax](https://soax.com) | ~$15.00 | 4G/5G | Good mobile pool, city targeting |
| [Bright Data](https://brightdata.com) | ~$25.00 | 4G/5G | Largest mobile pool |
| 4G Modem (self-hosted) | ~$30–50/mo | 4G LTE | One-time hardware cost, unlimited data |

**Best for:** High-value platforms with aggressive detection, maximum stealth requirements, when budget permits.

**Why mobile IPs work:** Social platforms treat mobile IPs with the highest trust. Thousands of legitimate users share mobile carrier IPs via CGNAT, so these IPs are almost never blocked. This is the gold standard for account creation.

> [!TIP]
> **Self-hosted 4G modem** is the most cost-effective Tier 3 option for sustained operations. A $50 USB modem + $30/mo unlimited data plan gives you a dedicated mobile IP you control. Rotate by toggling airplane mode programmatically.

---

## Configuration

### Environment Variables

Set these on the `personagen-factory` service in Easypanel:

```env
PROXY_HOST=us.smartproxy.com
PROXY_PORT=10001
PROXY_USER=sp_user_abc123
PROXY_PASS=proxy_pass_xyz
PROXY_TYPE=http
```

### Proxy Format

The factory accepts proxies in the standard format:

```
host:port:user:pass
```

**Examples:**

```
# SmartProxy (Tier 2)
us.smartproxy.com:10001:sp_user_abc123:proxy_pass_xyz

# IPRoyal (Tier 1)
geo.iproyal.com:12321:customer_abc:password_123

# Bright Data Mobile (Tier 3)
brd.superproxy.io:22225:brd-customer-abc-zone-mobile:password_xyz

# SOCKS5 proxy
socks5://proxy.example.com:1080:user:pass
```

### Alternative: Single URL Format

Instead of individual env vars, you can use a single `PROXY_URL`:

```env
PROXY_URL=http://sp_user_abc123:proxy_pass_xyz@us.smartproxy.com:10001
```

### Sticky Sessions

For account creation, **sticky sessions are critical**. The entire creation flow (sign-up → email verification → profile setup) must use the same IP address.

Most providers support sticky sessions via a session identifier in the username:

```
# SmartProxy sticky session (30 min)
us.smartproxy.com:10001:sp_user_abc123-session-persona1:proxy_pass_xyz

# Bright Data sticky session
brd.superproxy.io:22225:brd-customer-abc-zone-residential-session-rand123:password_xyz
```

The factory handles session stickiness automatically when `PROXY_HOST` is configured. Override with `PROXY_SESSION_DURATION` (in minutes) if needed.

---

## Proxy Selection Decision Tree

```
Is this for development/testing?
├── Yes → Tier 0 (own IP) — free, test only
└── No → Is budget a primary constraint?
    ├── Yes → Tier 1 (budget residential) — $1.50-3/GB
    └── No → Is the target platform high-detection?
        ├── No  → Tier 2 (standard residential) — $7-12/GB ✅ RECOMMENDED
        └── Yes → Tier 3 (mobile) — $15-30/GB
```

---

## Common Mistakes

> [!WARNING]
> **Free proxies will get every account banned.** Free proxy lists are shared by thousands of users including spammers. These IPs are pre-blacklisted on every major platform. There are no exceptions — do not use free proxies.

| Mistake | Consequence | Fix |
|---------|-----------|-----|
| Using free proxy lists | Instant ban, IP blacklisted | Use paid Tier 1+ providers |
| Using datacenter proxies | High detection, accounts flagged | Switch to residential or mobile |
| Different IP per creation step | Geographic anomaly flag | Enable sticky sessions |
| Proxy location ≠ persona location | Suspicious activity flag | Match proxy geo to persona location |
| Sharing proxy credentials across services | Session collision, bans | Use separate sub-users or zones |
| Not testing proxy before production use | Wasted account creation attempts | Run `curl -x proxy:port ifconfig.me` first |

---

## Cost Estimation

| Volume | Tier 1 Cost | Tier 2 Cost | Tier 3 Cost |
|--------|------------|------------|------------|
| 5 accounts/day (~0.5 GB) | ~$1–2/mo | ~$4–6/mo | ~$8–15/mo |
| 20 accounts/day (~2 GB) | ~$3–6/mo | ~$14–24/mo | ~$30–60/mo |
| 100 accounts/day (~10 GB) | ~$15–30/mo | ~$70–120/mo | ~$150–300/mo |

> [!NOTE]
> Data usage estimates assume ~100MB per account creation flow (browser pages, media uploads, verification). Actual usage varies by platform and flow complexity.

---

*Monarch Stack — Fractional CTO Services*
