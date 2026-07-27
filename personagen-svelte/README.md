# PersonaGen SvelteKit Portal

Everything you need to build and deploy the PersonaGen portal, Svelte 5 + Supabase multi-container stack.

---

## 📚 Using PersonaGen — Walkthroughs

PersonaGen turns your brand into a team of AI creators that generate, schedule, and publish social content — **with you approving everything before it goes live**. These walkthroughs cover everything you'll do day to day.

### 1 · The 5-minute daily routine

*Where: Review Queue → Calendar.* Everything else is setup — this is the loop you'll actually live in.

1. Open **Review Queue** in the sidebar. New drafts the system generated are waiting here.
2. For each draft: read the caption, look at the image or play the video. **Approve** the good ones, **edit** the almost-good ones, **reject** the misses (pick a reason — the system learns from your reasons).
3. Glance at the **Calendar** to see when approved posts go out.
4. Done. Approved posts publish themselves at their scheduled times, and each one links to the live post once the platform confirms it.

> 💡 Nothing ever posts without your approval while a persona is in "Semi-Autonomous" mode (the default). Rejecting costs nothing — the system generates a replacement for that slot.

### 2 · Teach it your brand

*Where: Brand Brief (sidebar → Setup).* The brand brief is the source of truth — every caption's tone, every image's styling, and every product mention is generated from this page.

1. Open **Brand Brief**. To build one from scratch, paste your website or a product page URL — voice, colors, products, audience, and pain points are pulled automatically.
2. Read what it extracted: this is what the AI believes about your brand.
3. Fix anything that's off directly in the fields. Small wording changes here shift **all** future content.
4. Check **Products** — each product needs a photo; product photos are what personas hold and show on camera.
5. Save. Every post generated from now on uses the corrected version.

If captions ever feel off-brand, fix the brief first — it's one edit instead of many.

### 3 · Meet your personas

*Where: sidebar → Personas → pick one → Profile tab.* A persona is an AI creator with a consistent face, voice, and personality.

1. **Personality** — the text here defines how they speak and what they care about. Edit it like you'd brief a human creator; ✨ **AI Enrich** expands a rough note into a full personality.
2. **Profile picture & reference kit** — the reference kit keeps the persona's face consistent across every image and video. If tiles are empty, **⚡ Generate all remaining** builds them in order (a minute or two per tile, in the background).
3. **Voice** — each persona has their own voice for spoken videos, matched to who they are. Preview with the play button; change it anytime.
4. **Posting schedule** — posts per day, posting window (e.g. 8am–8pm), and timezone. Posts go out on the *persona's* local clock.
5. **Autonomy** — "Semi-Autonomous" = everything waits for your approval (recommended). "Fully Autonomous" = posts publish without review; the app asks you to confirm before switching.

> 💡 Want a post right now? The persona's Feed tab has a composer — pick a topic (or let it choose), image / video / cinematic, and it generates in the background with progress shown.

### 4 · Approve, edit, or reject content

*Where: sidebar → Review Queue.* Your quality gate — only what you approve moves forward.

1. Each card shows the media, caption, persona, and target platform.
2. **Approve** — the post moves to its scheduled slot and publishes automatically.
3. **Edit first** — click the ✎ on the caption, change the words, save, then approve. Your edit is exactly what gets published.
4. **Reject** — pick a reason ("Bad caption," "Wrong tone," …). Reasons are logged and steer future drafts.
5. Bulk approve/reject handles a clearly-good (or clearly-bad) queue in one click.

An automated quality check scores every draft before it reaches you — you're the final judgment, not the first.

### 5 · Read and manage the calendar

*Where: sidebar → Calendar.*

1. Colored dots on each day are posts; the status filter narrows to Scheduled, Published, Drafts, etc.
2. Click any post to open it: full caption, media, platform, status.
3. **Move a post** — change the date/time in the panel and hit Reschedule.
4. **Edit a caption** — the ✎ works here too, right up until publish time.
5. Create a one-off post for any day with the composer — it flows through the same review process.

A healthy calendar shows a few days of approved posts ahead. If it looks thin, drafts are probably waiting in the Review Queue.

### 6 · Connect a social account

*Where: persona → Connections tab.* Accounts connect per persona with a normal social-media login — 15 platforms including Instagram, TikTok, and YouTube.

1. Click **+ Connect** on a platform and log in to the account in the window that opens. The connection appears with a green badge.
2. Connected accounts show follower counts and status. If a platform needs re-linking (password change, expired session), a **Reconnect** badge appears — one click fixes it.
3. Disconnecting an account stops its posting (and its per-account billing) immediately.

### 7 · Confirm a post is really live

*Where: persona → Feed, or Calendar → click a post.* "Published" is not a guess — the status flips only after the platform itself confirms the post exists.

1. After a post's scheduled time it reads **Publishing…** — sent, awaiting the platform's confirmation.
2. Within a minute or two the status flips to **Published** and a **View live post ↗** link appears — it opens the actual post on the platform.
3. Multi-platform posts list each platform's result separately in the post panel.

> 💡 Deleting a published post from PersonaGen removes it automatically on platforms that allow it. Instagram doesn't permit removal by software — for those, the panel gives you the direct link to delete it on Instagram itself.

### 8 · What every status means

| Status | Meaning | You need to… |
|---|---|---|
| `Generating` | The AI is creating this post (media takes a minute or two). | Nothing — it appears when ready. |
| `Draft` | Generated, waiting in your Review Queue. | Approve, edit, or reject. |
| `Scheduled` | Approved; publishes at its slot inside the persona's posting window. | Nothing — or reschedule it. |
| `Publishing…` | Sent to the platform; awaiting confirmation. | Nothing — flips within minutes. |
| `Published` | Confirmed live; "View live post" opens the real thing. | Enjoy. |
| `Partial` | A multi-platform post landed on some platforms, not others. | Open it — each platform shows its reason. |
| `Failed` | Didn't go out — the post shows the exact reason. | Fix the reason shown, then retry. |
| `Rejected` | You declined it in review. | Nothing — the slot refills with a new draft. |

**The principle:** no status ever claims more than the platform has confirmed. If something goes wrong, you always see the reason — never a silent failure.

---

## Local Development

1. Install dependencies:
   ```sh
   npm install
   ```
2. Start the development server:
   ```sh
   npm run dev
   ```
3. Run types check and linter:
   ```sh
   npm run check
   ```

---

## 🐳 Single-Instance Docker Compose (Portable Stack)

You can run the entire stack (SvelteKit app + PostgreSQL + Gotrue Auth + PostgREST + Kong Gateway) in a single docker-compose project. This is completely self-contained and ready for deployment to any Docker/VPS environment, including **Easypanel**.

### How it Works

- **SvelteKit App**: Runs using Svelte's node adapter. It compiles on-the-fly inside the container.
- **Supabase Stack**: Pre-configured services (`db`, `auth`, `rest`, `kong`) run side-by-side in the same network.
- **Auto-Seeding**: On first run, the database automatically runs [migration.sql](file:///c:/Users/nexal/personagendemo/personagen-svelte/supabase/migration.sql) to set up all tables, schemas, functions, and RLS policies.

### Local Docker Run

1. Fill out environment variables in `.env`.
2. Build and start the container stack:
   ```sh
   docker compose up --build -d
   ```
3. Open your browser to `http://localhost:3000` to access SvelteKit and `http://localhost:8000` to access the Supabase API Gateway.

### Deploying to Easypanel (Single Compose Project)

1. In the Easypanel Dashboard, click **Create Project**.
2. Select **Compose Project** (instead of standard App or Service).
3. Connect your GitHub repository.
4. Set the path to `docker-compose.yml` (located at the root or `personagen-svelte/docker-compose.yml`).
5. Configure the environment variables in the project settings:
   - `GEMINI_API_KEY`: Your Gemini API Key.
   - `PUBLIC_SUPABASE_ANON_KEY`: Public anon key for the configured Supabase project.
   - `JWT_SECRET`: A secure random JWT secret (required for GoTrue/PostgREST auth).
   - `POSTGRES_PASSWORD`: Database administrator password.
   - `SUPABASE_SERVICE_ROLE_KEY`: Service role key for server workers and internal MCP bridge.
   - `FACTORY_API_KEY`: Internal bearer key shared by the app and account factory.
   - `FACTORY_ENCRYPTION_KEY`: 32-byte hex key used by the account factory for stored sessions.
   - `MAIL_API_KEY`: Internal bearer key shared by the account factory and mail service.
   - `USER_SECRETS_ENCRYPTION_KEY`: 32-byte base64 key, 64-char hex key, or 32+ character secret used to encrypt user-supplied provider API keys.
   - Optional app-level fallbacks: `ZERNIO_API_KEY`, `OPENROUTER_API_KEY`, `FIRECRAWL_API_KEY`, `KIE_AI_API_KEY`, and `FAL_KEY` if you do not require every user to bring their own keys.
6. Click **Deploy**. Easypanel will build the frontend, spin up all 5 containers, mount persistent database volumes, and automatically run the migrations.

---

## 📲 Testing & Troubleshooting Social Integrations

Publishing, account connections, and analytics are all handled by **Zernio** (one API,
15 platforms). Keys are stored per-user under **Settings → API Keys**; `ZERNIO_API_KEY`
is only an optional shared fallback.

### How connecting works

Each persona gets its own Zernio **profile** (provisioned lazily on first connect),
so accounts stay isolated per persona under one shared key. Clicking **+ Platform** on
the Connections tab requests a hosted Zernio OAuth link (`GET /v1/connect/{platform}?profileId=…`)
filed under that persona's profile; after authorizing, Zernio redirects back and the
account is auto-imported on the next status check.

> [!NOTE]
> **Billing is pay-per-connected-account, not tiered.** The first 2 connected accounts
> are free; beyond that Zernio bills $6/account (3–10), $3 (11–100), $1 (101–2,000) per
> month, metered daily across the whole key. The Connections tab shows a live meter.

### Verifying a Zernio key end-to-end

```bash
# Lists the accounts under the key — a 200 with { accounts, hasAnalyticsAccess } confirms auth.
curl -s https://zernio.com/api/v1/accounts \
  -H "Authorization: Bearer $ZERNIO_API_KEY" | head -c 400
```

> [!WARNING]
> **Live follower & engagement stats require analytics access** on the Zernio key.
> `GET /v1/accounts` returns `hasAnalyticsAccess`; when it is `false`, the app skips
> follower sync and the Connections meter notes that stats are unavailable rather than
> showing zeros.
