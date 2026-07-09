# PersonaGen SvelteKit Portal

Everything you need to build and deploy the PersonaGen portal, Svelte 5 + Supabase multi-container stack.

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
