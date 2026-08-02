# PersonaGen SvelteKit Portal

Everything you need to build and deploy the PersonaGen portal, Svelte 5 + Supabase multi-container stack.

---

## 📚 User Guide — your three creators

> This section is for **users**, not developers. No technical knowledge needed — everything happens in the app at **[honeyx.monarchstack.com](https://honeyx.monarchstack.com)**.

PersonaGen gives you a team of AI creators who make, schedule, and publish social content for your brand — **and nothing goes live without your approval**. You have three creators ready to use right now:

| Creator | Focus | Ready today |
|---|---|---|
| **[Lexy Connor](https://honeyx.monarchstack.com/personas/26bda125-98a4-437a-8ea1-4d5b501d1318)** | Parenting & Family | ✅ Fully live — Instagram + TikTok connected, drafts waiting, posts already published |
| **[Chloe Miles](https://honeyx.monarchstack.com/personas/24e5442c-3d42-403f-96e7-536868598114)** | Sustainability & Eco | 📝 A batch of drafts made and waiting for your review |
| **[Jenny Tran](https://honeyx.monarchstack.com/personas/d5233352-113c-4982-b447-7ac52ea0d8d3)** | Beauty & Wellness | ✨ Fresh start — make her first post in minutes |

Do the three walkthroughs in order — each takes about 10 minutes and teaches a different part of the app.

---

### Walkthrough 1 · Lexy Connor — approve a post and watch it go live

Lexy is your working creator. Her Instagram and TikTok are already connected, and she has drafts waiting for you. This walkthrough shows you the core loop you'll use every day.

1. Open **Review Queue** in the left sidebar. You'll see Lexy's waiting drafts — each card shows the picture or video, the caption, and where it will post.
2. Pick a draft you like. Click the **✎** on the caption, change a couple of words to make it yours, and save. What you write is exactly what gets published.
3. Click **Approve**. The post moves onto the schedule.
4. Pick a weak draft and click **Reject** — choose a reason like "Bad caption." Rejecting is free: Lexy simply makes a replacement, and your reasons teach her what you like.
5. Open **Calendar** in the sidebar. Your approved post is sitting on its day. Click it — you can change the date and time right here if you want it sooner.
6. After its scheduled time passes, open the post again. It will briefly say **Publishing…**, then flip to **Published** with a **View live post ↗** link. Click the link — that's the real post, live on the real account. PersonaGen never says "Published" until the platform itself confirms it.

> 💡 That's the whole job: check the queue, approve/edit/reject, done. Five minutes a day.

### Walkthrough 2 · Chloe Miles — shape a creator with your taste

Chloe has already made a batch of drafts, but her social accounts aren't connected yet. Use her to practice curating — then connect her when you're happy with her style.

1. Open **Review Queue** and find Chloe's cards (each card shows the creator's name).
2. Go through them all: approve the ones that feel right, **reject the rest with reasons**. Be picky — this is how you tune her voice before anything ever goes public.
3. Want her captions punchier or softer overall? Open **[Chloe's page](https://honeyx.monarchstack.com/personas/24e5442c-3d42-403f-96e7-536868598114)** → **Profile** tab and edit her **Personality** text — write it like you're briefing a human creator. The ✨ **AI Enrich** button turns a rough note into a full personality.
4. When you're happy with her content: on her **Profile** tab, switch the view from **Overview** to **Connections**, then click **+ Connect** on Instagram (or any platform) and log in to the account in the window that opens. A green badge appears — that's it.
5. Still on **Profile**, set **Autonomy** to **Semi-Autonomous** and set her posts-per-day. From now on she drafts on schedule, and her approved posts publish to her connected accounts automatically.

> 💡 Approved posts only publish once an account is connected — so you can safely approve Chloe's drafts today and connect her tomorrow.

### Walkthrough 3 · Jenny Tran — create a post from scratch

Jenny is brand new: face ready, no content yet. Use her to learn how posts get made on demand.

1. Open **[Jenny's page](https://honeyx.monarchstack.com/personas/d5233352-113c-4982-b447-7ac52ea0d8d3)** → **Profile** tab. Read her Personality and tweak anything you'd like — who she is shapes everything she makes.
2. Scroll to her **Reference Kit**. If any of the four tiles are empty, click **⚡ Generate all remaining** — this builds the assets that keep her face consistent in every image and video. It runs in the background; a minute or two per tile.
3. Try her **Voice**: press play to hear it. Every creator has their own voice for spoken videos — no two sound alike.
4. Go to her **Content** tab and open the composer. Type a topic (or leave it blank and let her choose), pick **Image** or **Video**, and hit generate. You'll see progress while it works — takes a minute or two.
5. Her first post appears on her **Content** tab as a **Draft**. Edit the caption if you like — this is your content now.
6. When you're ready for Jenny to work on her own: Profile tab → **Autonomy → Semi-Autonomous** → set posts per day and her posting window. She'll start filling your Review Queue like Lexy does.

> 💡 Shortcut: her **Studio** tab has ready-made post templates — pick one and it pre-fills the composer for you. Everything Studio makes still lands as a **Draft** for your review; it never publishes on its own.

---

### Every day after that: the 5-minute routine

1. Open **Review Queue** — approve, edit, or reject what your creators made.
2. Glance at **Calendar** — see what's going out and when. Drag anything to a better time.
3. That's it. Approved posts publish themselves, and every published post links to the live version.

### If captions ever feel off-brand

Open **Brand Brief** (sidebar → Setup). This page is what your creators believe about your brand — voice, products, audience. Fix it **here** once, and every future post from every creator uses the correction. Make sure each product has a photo — that's what creators hold and show on camera.

### What the labels on posts mean

| Label | Meaning | You need to… |
|---|---|---|
| `Generating` | Being created right now (a minute or two). | Nothing — it appears when ready. |
| `Draft` | Waiting for you in the Review Queue. | Approve, edit, or reject. |
| `Scheduled` | Approved; will go out at its time slot. | Nothing — or reschedule it. |
| `Publishing…` | Sent; waiting for the platform to confirm. | Nothing — flips within minutes. |
| `Published` | Confirmed live — "View live post" opens the real thing. | Enjoy. |
| `Failed` | Didn't go out — the post shows the exact reason. | Fix what it says (usually a quick reconnect), then retry. |
| `Rejected` | You said no in review. | Nothing — a new draft replaces it. |

**One promise throughout:** no label ever claims more than the platform has confirmed, and nothing fails silently — you always see why.

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
