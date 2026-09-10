---
name: verify
description: Build, launch and drive the PersonaGen SvelteKit portal to observe changes at their real surface (browser). Use when verifying UI/UX changes in personagen-svelte.
---

# Verifying personagen-svelte

Surface is a **browser**. Drive it with Playwright; don't run vitest/svelte-check as verification.

## ⚠️ Booting the server is itself a live action

Starting `dev` **or** `preview` boots `src/lib/server/scheduler.ts`, which begins a
**60-second tick that publishes due scheduled posts to real social accounts**. This happens
with no clicking — "Do NOT drive live" below is necessary but not sufficient. You will see:

```
[Scheduler] Starting SvelteKit social posting scheduler worker (60s tick)...
```

Scrub the server-side secrets before starting, so the scheduler can reach neither the DB nor
any provider:

```bash
export SUPABASE_SERVICE_ROLE_KEY="disabled-for-verification"
export FAL_API_KEY="" GEMINI_API_KEY="" OPENROUTER_API_KEY="" FIRECRAWL_API_KEY=""
export AUTOPILOT_MAX_PER_RUN=0 AUTOPILOT_LOOKAHEAD_DAYS=0
```

This log line confirms it is neutered and safe to drive:

```
[Scheduler] DB lease acquire failed (Invalid authentication credentials) — using file lock for this tick.
```

The scrub leaves `/login` and `/signup` fully renderable — the client bundle already carries
the public Supabase values from build time.

## Launch

```bash
cd personagen-svelte
npx vite dev --port 5199 --strictPort   # 5199 is often already taken; pick another if it fails
```

**Do not use `npm run dev -- --port N` here** — on this setup npm swallows the `--port`
flag and vite receives `vite dev N`, treating N as its ROOT DIRECTORY: it boots "successfully"
on the default port and serves a blank white page from the wrong root. Looks exactly like an
app bug. Call vite directly as above; the boot log must say `vite dev` with no stray number.

`npm run build && npx vite preview --port 4178 --strictPort` is the better choice when you
want to verify what actually ships; `--strictPort` fails loudly instead of silently drifting.

**The server binds IPv6 only.** `curl 127.0.0.1:4178` returns `000` and looks like a boot
failure; `http://localhost:4178` and `http://[::1]:4178` both work. To stop it — a plain
`taskkill //IM node.exe` does not catch it:

```powershell
Get-NetTCPConnection -LocalPort 4178 -State Listen |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
```

Vite prints `Local: http://localhost:<port>/`. It silently increments when the port is busy —
**always read the actual port out of the log** rather than assuming.

## Driving it

`playwright` (not just `@playwright/test`) is in `node_modules`, and chromium is installed.
Scripts must live **inside `personagen-svelte/`** or `import { chromium } from 'playwright'`
fails module resolution — but **do not put them in the app root**: Vite watches it, your new
`.mjs` triggers an HMR page reload, and any in-flight `page.goto` dies with
`net::ERR_ABORTED`. Put the harness in **`node_modules/.verify-tmp/`** — module resolution
still walks up to `personagen-svelte/node_modules`, and Vite ignores it. `rm -rf` it after.

```js
import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await p.goto('http://localhost:<port>/login', { waitUntil: 'domcontentloaded' });
```

**Never `waitUntil: 'networkidle'` on `(portal)/personas/[agentId]`.** That page polls
(kit jobs, feed sync), so networkidle never fires and `goto` throws a 30s timeout that reads
like the page is broken. Use `domcontentloaded` everywhere, then poll for the thing you need:

```js
const end = Date.now() + 30000;                       // lists hydrate async
while (Date.now() < end && (await p.locator('.post-tile').count()) === 0)
  await p.waitForTimeout(500);
```

Counting straight after `waitForTimeout(2000)` is the single biggest source of phantom
failures here — you measure an empty list and report a working feature as broken.

**One dialog handler for the whole run.** Destructive actions use native `confirm()`. Stacked
`page.once('dialog', …)` handlers double-fire on the next dialog and throw
`Cannot accept dialog which is already handled`. Register once:
`p.on('dialog', (d) => d.accept())`.

## Auth: seed a disposable account

`/` and every `(portal)` route redirects to `/login` when unauthenticated. You do **not** need
to ask the user for their credentials — provision a throwaway account instead:

```bash
node scripts/verify-seed.mjs create     # prints {email, password, userId, agentA}
# … drive the app …
node scripts/verify-seed.mjs destroy    # ALWAYS, even if the run failed
```

It creates one fixed-address user (re-running `create` recycles it) preloaded with 3 personas,
5 draft posts with media, a reference kit + avatar, and a brand brief with products and
competitors — enough to exercise every list surface.

**The fixed address is shared state across concurrent sessions.** A parallel verify run's
`destroy` (or recycle) yanks the account mid-drive — logins start failing with
"Invalid login credentials" for no app reason, and recycling mints **new** user/agent ids, so
any hardcoded `agentA` goes stale. On sudden auth failure: re-run `create`, take the fresh ids
from its output, resume. Same applies to `node_modules/.verify-tmp/` — another session's
teardown may sweep your harness files; keep filenames distinct and re-write if gone.

Log in normally:

```js
await p.fill('input[type="email"]', email);
await p.fill('input[type="password"]', password);
await Promise.all([
  p.waitForURL((u) => !u.pathname.includes('login'), { timeout: 30000 }),
  p.click('button[type="submit"]')
]);
```

Supabase is a **live self-hosted instance** (`PUBLIC_SUPABASE_URL` → easypanel host), so this
really does write rows. Two consequences: run `create` **before** scrubbing
`SUPABASE_SERVICE_ROLE_KEY` for the scheduler (the script needs it), and never skip `destroy`.

Reachable without credentials: `/login`, `/signup`, and the redirect guards.

## Do NOT drive live

`.env` carries real keys for fal, Gemini, OpenRouter, Firecrawl and the Supabase service role.
These cost money or mutate real accounts — stay off them unless explicitly asked:

- persona **Generate** / avatar / reference-kit buttons (fal + Gemini spend)
- brand-brief **Scrape & Populate** (Firecrawl credits)
- review **Approve** / **Post now** / publish-fallback (posts to real social accounts)
- any **Delete** (brief, agent, account) — live rows

Navigation, tabs, modals, drawers, collapsibles, keyboard and responsive behaviour are all safe.

**Exception — the seeded harness account.** Delete/bulk-delete flows *are* the change whenever
you're verifying manageability, and they can't be observed without running them. Drive them
freely against `verify-harness@personagen.test`; the rule is "never against a real user's
rows", not "never delete". Re-run `create` to restore fixtures between destructive sections
(deleting personas cascades their posts, so a later section can find an empty queue and report
a false failure).

## Selector gotcha

Password fields have a **"Show password" toggle button that precedes the submit button in DOM
order**. `page.locator('form button').first()` grabs the toggle, not Sign In — it silently flips
the field to `type="text"` and no submit happens. Use `button[type="submit"]` or
`getByRole('button', { name: /sign in/i })`.

Likewise `.first()` on generic `a`/`button` selectors across the portal is unreliable; prefer
`getByRole` with an accessible name.

More of the same family, each of which produced a wrong result before being caught:

- **`.btn-delete` matches two different things** on `/review` — the disabled bulk
  "Delete selected (0)" button *and* the per-card ones. `.first()` grabs the disabled one and
  the click times out. Scope it: `.queue-card .btn-delete`.
- **`/review` defaults to TABLE view** (viewMode 'table', persisted in localStorage;
  board/grid/deck are alternates). `.queue-card` exists ONLY in grid mode — count
  `tbody tr` in the default view, or switch to grid first, or a populated queue
  reads as empty.
- **`.row-pick input, .row-pick`** double-counts (label + input), so "4 rows" is really 2.
  Count the inputs only.
- **The reference-kit controls sit inside a collapsed `<details class="profile-section">`.**
  They exist in the DOM with a 0×0 rect, so a click waits forever on visibility. Open them
  first: `await p.evaluate(() => document.querySelectorAll('details').forEach(d => d.open = true))`.
- **The persona page SSR-paints seconds before hydration attaches handlers.** Clicks in that
  window dispatch fine (no Playwright error) and are silently eaten — a working toggle reads
  as broken. Waiting for the element to EXIST is not enough. The Studio action chrome
  (Output toggle, `.studio-use`, Plan a campaign) now renders `disabled` until hydration —
  wait for `isDisabled()` to go false and use that as the hydration signal; for other
  controls, settle ~2–3s after the section appears before the first click.

## Portal map (where the list surfaces actually are)

- **Persona page tabs**: as of 2026-08-20 the `.tab-btn` row renders `Profile` · `Content` ·
  `Studio` (Feed/Calendar/Connections no longer appear as top-level tabs — look inside
  `Content` and the left nav). Studio holds the template shelves: format chips
  (`.studio-cats`), intent sections (`.studio-intent-title`), tiles `.studio-tile` with a
  `button.studio-use` CTA labeled just "Use".
- The old map said `Profile · Feed · Calendar · Connections`, and Feed held a `Posts` /
  `Assets (N)` toggle with the assets grid *inside* Feed — if tabs regress, check there.
- **Assets grid de-dupes by image URL**, so fixtures sharing one URL collapse to a single tile.
- **Reference kit + avatar controls** live on `Profile`, inside the collapsed `<details>` above.
- **Roster multi-select** is on `/dashboard` (`.pick-cell input`); bulk delete opens a
  typed-`DELETE` dialog, and the confirm button stays disabled for `delete` or `DELETE `.
- **Bulk bars** are the shared `SelectionToolbar` (`.sel-toolbar`, `.sel-count`,
  `.sel-btn.danger`); the whole bar unmounts when a list is empty.

## API response shape

The posts endpoints return their result fields at the **top level**, not under `data` —
`res.deleted`, `res.teardown`, not `res.data.deleted`. The `ApiResponse<T>` signature in
`src/lib/services/api.ts` suggests otherwise; believe the wire, not the type.

## Traps that manufacture false failures

Each of these produced a confident, wrong FAIL before being caught:

- **`@property --accent` animates.** `--accent`/`--cyan` are registered custom properties and
  `:root` declares `transition: --accent 1s`. Reading straight after
  `style.setProperty('--accent', …)` returns the *pre-transition* value, which looks exactly
  like "the derived token is hardcoded". `await page.waitForTimeout(1500)` first.
- **`getPropertyValue('--accent-text')` is not a colour.** Unregistered custom properties come
  back as the literal `color-mix(in srgb, …)` token stream. To get real pixels, paint it:
  append `<span style="color: var(--accent-text)">` and read `getComputedStyle(span).color`.
- **Svelte 5 flushes effects asynchronously.** `el.click()` inside `page.evaluate()` followed
  by reading the DOM *in the same evaluate* returns pre-update state — a working toggle reads
  as broken. Drive through Playwright locators and `waitForTimeout(~150)` before asserting.
- **Computed colours are `color(srgb r g b)`, not `rgb()`.** A contrast helper that only
  regexes `rgb()` returns null and silently skips those nodes.
- **Gradient text is uncontrastable.** `.grad-text` sets
  `-webkit-text-fill-color: transparent`, so computed `color` is meaningless — exclude such
  nodes rather than reporting an absurd ratio (the page `h1` reads as 1.18:1).
- Walking up parents for a background colour lands on `rgba(0,0,0,0)` whenever the real
  backdrop is a gradient or image; falling back to `body` gives a wrong pairing.

## Useful probes

- No horizontal scroll: compare `document.documentElement.scrollWidth` vs `clientWidth` at 375/768/1440.
- Touch targets: `getBoundingClientRect()` over `a,button,input,select`, flag `<44px`.
- Focus visibility: text inputs signal focus via **border-color**, buttons/links via
  `outline: solid 2px`. Measuring only `outline`/`boxShadow` gives a false negative on inputs.
- Reduced motion: `newContext({ reducedMotion: 'reduce' })` → computed `animationDuration`
  should collapse to `1e-05s`.
- Native constraint validation is used for `required`/email format, so empty-submit errors are
  **native bubbles invisible to DOM queries** — screenshot to see them.

## Additions 2026-09-05

- **Login click can land before hydration.** With `goto('/login', { waitUntil: 'domcontentloaded' })`
  the submit click fell through to a native form GET (`/login?` twice in the nav log, no POST)
  and `waitForURL` timed out — reads exactly like bad credentials. Use
  `waitUntil: 'networkidle'` on `/login` only (it does not poll) plus `waitForTimeout(1500)`
  before filling.
- **`/settings` sections are URL-addressed:** `?section=profile|notifications|theme`
  (`#zernio-keys` hash also works). The notification `[role="switch"]` toggles exist only on
  `section=notifications`; on the default profile section the locator never resolves.
- **The Persona Profile `<details>` on the persona page is collapsed by default** (only Brand
  Kit opens). `#p-niche`, `#pp-archetype`, `#pp-focus` exist with a 0×0 rect until you open
  all `details` — same trick as the reference-kit controls.
- **Engine URL guard is reachable without real spend:** export
  `OPENROUTER_API_KEY="sk-or-v1-verify-fake-key-never-valid"` alongside the scrub. `hasAi`
  becomes true, the guard runs first and returns 400 for internal targets; a public URL
  proceeds to the provider and fails with a harmless 401.

## Additions 2026-09-10

- **A change that needs the service key (storage writes, service-client row updates — e.g.
  the `/api/agent/[id]/cards` batch) cannot run under the service-key scrub.** Use the boot
  gate instead: `export RUN_SCHEDULER=false` skips `startScheduler()` entirely (hooks.server.ts),
  so keep the real `SUPABASE_SERVICE_ROLE_KEY` from `.env`, scrub only the provider keys and
  zero the autopilot vars. Confirm with `grep -c Scheduler <log>` → `0`. The rows you create
  land on the harness account and go away with `destroy`; the PNG/MP4 objects in the storage
  bucket do not — a handful per run, acceptable.
- **The persona Content tab is `?tab=feed`** (`initialTab()` maps feed/assets/posts → Content;
  `?tab=content` is ignored and lands on Profile). Open it by URL rather than clicking `.tab-btn`.
- **"Generate Now" (`.btn-generate`) clicks are eaten in the hydration window even after it
  reports enabled.** Click, wait up to ~8s for the composer's `.kind` radios, and click again
  if they never appear — one attempt reads as "the composer does not open".
- **Feed tiles (`.post-tile`) render no caption text** — only the media and badges (a `T`
  badge marks a text card). To assert on a caption, read the row via
  `POST /api/posts {action:'get', id}` (fields under `.data`) or look at `/review`'s table.
- **Composer walk-through:** kinds `.kind` (Image / Video), formats `.fmt` by `.fmt-name`,
  steps advance with `.btn-primary` whose label is the NEXT step's name; on the last step the
  same button is the spend/create action — guard on `/create|approve|publish/i` before
  clicking. `.sumrow strong` first match is the "Making" row, not the cost.

## Additions 2026-09-10

- **The persona page defeats `getByRole(...).click()`.** It polls, so Playwright's
  actionability wait sits on "waiting for navigation to finish" and throws a 30s timeout that
  reads exactly like a broken tab. Don't fight it: **the composer's best door is `/calendar` →
  `Generate Post Now`**, which opens the full four-step modal (Subject / Look / Craft /
  Deliver) with format cards and live prices. That is the surface for anything about formats,
  stages or quoting.
- **`verify-seed.mjs create` prints an `agentA` that may already be stale.** The fixed-address
  account is shared, and a parallel session's recycle mints new ids while your login still
  works — so you get `404 "Persona not found or ownership mismatch"` on a valid session, which
  reads like an auth bug. Read the ids out of the DOM instead of trusting the seed output:
  ```js
  const hrefs = await p.locator('a[href*="/personas/"]').evaluateAll((e) => e.map((x) => x.getAttribute('href')));
  const ids = [...new Set(hrefs.map((h) => h.split('/personas/')[1]?.split(/[/?#]/)[0]).filter(Boolean))];
  ```
- **Quoting/plan changes are best driven as an API surface from inside the authenticated page**,
  which carries the session cookie for free and avoids the composer's hydration timing:
  ```js
  await p.evaluate(async ([a, body]) => {
    const r = await fetch(`/api/agent/${a}/generate-post`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    return { status: r.status, body: await r.json() };
  }, [agentId, { preview: true, format: 'listicle', list_count: 5 }]);
  ```
  `preview: true` costs nothing and generates nothing — it returns the resolved plan, its steps
  and their prices. Sweeping a numeric input across its range this way is how the
  `source_seconds` quote-under-bill bug was found; no unit test had reached it.
- **Backgrounding the dev server:** `nohup … &` from the Bash tool does not survive, but the
  process it spawns may still be holding the port — a later launch then fails with
  "Port N is already in use" while `curl http://localhost:N/login` returns 200. Check the port
  before assuming the boot failed.
