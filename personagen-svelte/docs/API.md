# PersonaGen Platform API

Developer reference for driving PersonaGen programmatically — building an
agentic controller that provisions personas, generates content, and publishes,
without clicking the UI.

> **Status of this doc:** generated from the route handlers in
> `src/routes/api/**`. It covers the endpoints a deployment/automation
> controller actually needs. The full route list is in
> [§ Endpoint index](#endpoint-index); anything there without a request/response
> block below follows the same conventions (§ Conventions) — ask and we'll
> expand it.

---

## Authentication

**There is no machine API-key auth yet.** Every endpoint authenticates from the
**Supabase session** attached to the request (cookie-based, read server-side via
`safeGetSession()`). A controller authenticates the same way a browser does:

1. `POST /api/auth/login` with `{ email, password }`.
2. The response includes `session.access_token` (a JWT) and
   `session.refresh_token`.
3. Send the access token on every subsequent call as either:
   - the Supabase auth **cookie** the login response sets, **or**
   - an `Authorization: Bearer <access_token>` header.

```jsonc
// POST /api/auth/login
{ "email": "kelvin@monarchstack.com", "password": "•••••••" }

// 200
{
  "user":    { "id": "…", "email": "…", … },
  "session": { "access_token": "eyJ…", "refresh_token": "…", "expires_at": 1234567890, … }
}
// 401 → { "error": "Invalid login credentials" }
```

### Limits of session auth for automation (read before you build)

- **Tokens expire (~1 hour).** The controller must refresh via the
  `refresh_token` (Supabase token endpoint) or re-login, and retry a `401`.
- **A session IS a human seat.** Every call runs with that user's workspace
  **role** (owner / admin / manager / creator / viewer — see § Roles). A
  `creator` login literally cannot publish, by design; use an account whose role
  matches what the controller needs to do.
- **No per-machine scoping or revocation.** Rotating access means changing the
  human account's password.

> **Durable path (not built yet):** a first-class **scoped API-key / service
> token** — non-expiring, tied to a workspace rather than a person, with its own
> role. That's the right foundation for an agentic controller. Flagged as a
> feature to spec; this doc will grow an `Authorization: ApiKey …` section when
> it lands.

---

## Conventions

- **Transport:** JSON in, JSON out. `Content-Type: application/json`.
- **Success shape:** almost every route returns `{ "success": true, … }`.
  Auth is the exception (`{ user, session }`).
- **Error shape:** `{ "success": false, "error": "<human message>" }` with a
  meaningful HTTP status (`400` bad input, `401` unauthenticated, `403` role too
  low, `404` not found / no access, `409` conflict, `410` gone/expired,
  `500` server).
- **404 hides existence.** If you lack any access to a persona/post, you get
  `404 "not found or ownership mismatch"` — never a `403` that would confirm it
  exists. Don't treat 404 as "definitely deleted."
- **Action-dispatch routes.** Several endpoints are a single `POST` that
  switches on an `action` field in the body (`/api/posts`, `/api/accounts`) —
  they are **not** REST resources. The `action` is required.
- **Async generation.** Paid generation returns **`202` immediately** with a
  post id and `status: "generating"`; the controller **polls the post row**
  (`POST /api/posts {action:"get"}`) until `status` leaves `generating`
  (→ `draft`/`scheduled`, or `failed`). Never block on the generate call.
- **IDs** are Supabase UUIDs.

---

## Roles

Access is enforced in the database (RLS + triggers), not just here — calling the
API a different way cannot escalate. Ranked low→high:

| Role | Can |
|------|-----|
| `viewer`  | read a persona and its content |
| `creator` | + generate & draft, edit posts, chat, memories — **cannot** publish or touch connections |
| `manager` | + approve/publish, connect/disconnect accounts, delete posts, see spend & analytics |
| `admin`   | + manage other seats (invite/re-role/remove), set seat spend caps |
| `owner`   | + rename/delete the persona, move it in/out of a workspace, rename/delete the workspace (implicit — the account that owns the row; never a stored role) |

Per-seat monthly spend caps (set by owner/admin, in retail USD — the wallet's money at the platform markup, 1 credit = 1¢) are enforced on every paid
generation; hitting one returns `400` with a "budget" message.

---

## Core pipeline (the deployment sequence)

The order an agentic controller provisions and runs a persona:

### 1. Create a persona

```jsonc
// POST /api/agents
{
  "name": "Sofia Rivera",              // required
  "niche": "Fitness & Wellness",       // optional (default "Lifestyle")
  "handle": "@sofiarivera.ai",         // optional (auto-derived from name)
  "bio": "…",                          // optional → persona "soul"
  "personaProfile": { … },             // optional full profile (archetype/appearance/voice)
  "ugcVoice": "…",                     // optional pinned TTS voice
  "brandBriefId": "uuid"               // optional link to a brand brief
}
// 200 → { "success": true, "data": { "id": "uuid", "name": …, "handle": …, … } }
```

Creating also seeds a default `agent_configs` row (timezone, 3 posts/day, active
hours, `autonomy_level: "advisor"`). Persona creation is **owner-scoped** — the
persona belongs to the calling account's `user_id`.

### 2. Configure the persona (the "soul + brief" that drives quality)

This is where reverse-engineered voice/format guidance gets baked in — the
per-avatar identity every generation conditions on.

```jsonc
// POST /api/agents/config   (creator+)
{
  "agentId": "uuid",                   // required
  "soulText": "worldview, POV, recurring formats, vocabulary…",
  "skillsText": "…",
  "ugcVoice": "…",
  "timezone": "Australia/Sydney",
  "postsPerDay": 3,
  "activeHoursStart": 8,
  "activeHoursEnd": 22,
  "autonomyLevel": "advisor",          // advisor | … (autopilot mode)
  "brandBriefId": "uuid",
  "personaProfile": { … },             // merged, not overwritten
  // identity fields (manager+ only; a creator sending these gets a trigger error):
  "name": "…", "handle": "…", "niche": "…", "status": "active|paused"
}
// 200 → { "success": true }
```

Only the fields you send are touched (merge semantics). Identity/status fields
are gated to owner/manager at the DB layer.

### 3. Generate a post (async)

```jsonc
// POST /api/agent/{agentId}/generate-post   (creator+)
{
  "topic": "…",                        // optional; Director writes one if omitted
  "media": "video",                    // "video" | "image" | "cinematic"
  "platforms": ["instagram"],          // target platforms
  "provider": "auto",                  // "auto" | "fal" | "openrouter"
  "format": "auto",                    // "spokesperson" | "broll" | "auto"
  "still": "photo",                    // "photo" | "graphic" (typographic card)
  "scene": "…",                        // optional; pins the visual prompt exactly
  "product_id": "…",                   // optional; from the brand brief
  "product_photo_url": "https://…",    // optional override
  "character_ref_url": "https://…",    // optional override
  "video_model": "…",                  // optional model id (see /api/models)
  "captions": false,                   // burn on-screen hook caption
  "ai_badge": false,                   // burn "AI GENERATED" badge
  "scheduled_date": "2026-09-10",      // optional; else stamped "now" on completion
  "scheduled_time": "09:00",
  "preview": false                     // true = price & plan only, generate nothing
}
// 202 → { "success": true, "post_id": "uuid", "status": "generating" }
// preview:true → 200 → { "success": true, "preview": { steps:[…], estimatedCostUsd, … } }
// 400 → over spend cap (message contains "budget")
```

Use `preview: true` first to get the step plan and `estimatedCostUsd` without
spending — useful for a controller that reports cost before committing.

### 4. Poll until ready

```jsonc
// POST /api/posts   (viewer+)
{ "action": "get", "id": "<post_id>" }
// 200 → { "success": true, "data": { "id", "status": "generating|draft|scheduled|failed", "content", … } }
```

### 5. Approve / schedule / publish

```jsonc
// Move a draft to scheduled (manager+; a creator gets 403 "requires manager"):
// POST /api/posts
{ "action": "update", "id": "…", "status": "scheduled",
  "scheduled_date": "2026-09-10", "scheduled_time": "09:00" }

// Publish now (manager+):
// POST /api/agent/{agentId}/publish-post
{ "post_id": "…" }
```

Scheduled posts publish automatically via the server scheduler at their slot;
`publish-post` is the immediate path.

### 6. Connect social accounts (manager+)

```jsonc
// POST /api/accounts   (action-dispatch)
{ "action": "check_status",       "persona_id": "uuid" }                       // viewer+
{ "action": "initiate_connection","persona_id": "uuid", "platform": "instagram" } // manager+
{ "action": "sync_zernio",        "persona_id": "uuid" }                       // manager+
{ "action": "disconnect",         "persona_id": "uuid", "platform": "instagram" } // manager+
```

Publishing runs through Zernio; a persona needs a connected account before a
publish will land. Connections require a Zernio key configured for the persona
(Settings → API Keys / Zernio Keys).

---

## Posts API — full action list

`POST /api/posts`, switched on `action`:

| action | role | body | notes |
|--------|------|------|-------|
| `create` | creator+ | `{ post: { agent_id, content, platforms[], status } }` | draft creation |
| `update` | creator+ | `{ id, content?, status?, scheduled_date?, scheduled_time?, platforms? }` | setting a publish-adjacent `status` needs manager+ |
| `reschedule` | creator+ | `{ id, scheduled_date?, scheduled_time? }` | draft/scheduled only |
| `favorite` | creator+ | `{ id, value: bool }` | |
| `delete` | manager+ | `{ id }` | soft-delete (Trash) |
| `delete_many` | manager+ | `{ ids: [] }` | per-item checked; max 200 |
| `restore` | manager+ | `{ ids: [] }` \| `{ id }` | out of Trash; past-due scheduled → draft |
| `purge` / `purge_all` | manager+ | `{ ids }` / — | permanent |
| `get` | viewer+ | `{ id }` | single post (poll target) |
| `list` | viewer+ | `{ agent_id? }` | |
| `calendar` | viewer+ | `{ month, year, persona_id? }` | |
| `trash` | viewer+ | `{ agent_id? }` | Trash contents |
| `upcoming` / `recent` | authed | `{ limit? }` | acting user's own scheduled/published |

---

## Workspaces & seats

For an agency running a client's brand as a shared workspace.

```jsonc
GET  /api/workspaces                                  // { owned:[], memberships:[], pendingInvites:[] }
POST /api/workspaces                    { name }      // create (caller = owner)
PATCH  /api/workspaces/{id}             { name }      // rename (owner only)
DELETE /api/workspaces/{id}                           // delete (owner only)

GET  /api/workspaces/{id}/members                     // roster (owner/admin)
PATCH  /api/workspaces/{id}/members  { userId, role?, spendLimitUsd? }  // owner/admin; spendLimitUsd is retail USD (1 credit = 1¢); null = unlimited
DELETE /api/workspaces/{id}/members  { userId }       // remove; a member may remove self (leave)

GET  /api/workspaces/{id}/invites                     // pending (owner/admin)
POST /api/workspaces/{id}/invites  { email, role }    // → { invite, acceptUrl:"/invite/<token>" }
DELETE /api/workspaces/{id}/invites { inviteId }      // revoke

GET  /api/workspaces/{id}/personas                    // { inWorkspace:[], available:[] }
POST /api/workspaces/{id}/personas  { agentId }       // file a persona in (persona's own owner only)
DELETE /api/workspaces/{id}/personas { agentId }      // remove from workspace

POST /api/workspaces/invites/{token}/accept           // requires a logged-in session matching the invite email
POST /api/workspaces/invites/{token}/decline
```

---

## Account self-service

```jsonc
POST /api/settings/email     { newEmail, confirmEmail, currentPassword }   // change login email (applied immediately)
POST /api/settings/password  { newPassword, confirmPassword }              // change password; clears first-login gate
POST /api/settings/profile   { displayName?, preferences? }
GET/POST /api/settings/api-keys      // OUTBOUND provider keys (Zernio/Gemini/…) the platform uses — not inbound auth
GET/POST /api/settings/zernio-keys   // Zernio publishing keys
```

---

## Endpoint index

Auth: `auth/login`, `auth/logout`, `auth/signup`, `auth/callback`
Personas: `agents`, `agents/config`, `persona-groups`,
`agent/{id}/favorite`, `agent/{id}/spend`, `agent/{id}/post-observability`,
`agent/{id}/delete-assets`
Generation: `agent/{id}/generate-post`, `agent/{id}/generate-avatar`,
`agent/{id}/generate-reference-kit`, `agent/{id}/refine-post`,
`agent/{id}/restore-avatar`, `agent/{id}/restore-kit-stage`, `voices`, `models`
Publishing: `agent/{id}/publish-post`, `accounts`, `review`
Content: `posts`, `analytics`
Workspaces: `workspaces`, `workspaces/{id}`, `.../members`, `.../invites`,
`.../personas`, `workspaces/invites/{token}[/accept|/decline]`
Account: `settings/profile`, `settings/email`, `settings/password`,
`settings/api-keys`, `settings/zernio-keys`, `account/delete`
Automation surfaces: `autopilot`, `engine`
Ops: `health`, `feature-requests`, `studio/card-sample/{templateId}/{idx}`

---

## Minimal end-to-end (pseudocode)

```js
const { session } = await post('/api/auth/login', { email, password });
const auth = { Authorization: `Bearer ${session.access_token}` };

const { data: persona } = await post('/api/agents',
  { name: 'Sofia Rivera', niche: 'Fitness & Wellness' }, auth);

await post('/api/agents/config',
  { agentId: persona.id, soulText: DISTILLED_VOICE, ugcVoice: VOICE_ID }, auth);

const { post_id } = await post(`/api/agent/${persona.id}/generate-post`,
  { media: 'video', platforms: ['instagram'], topic: '…' }, auth);

let p; do { await sleep(5000);
  ({ data: p } = await post('/api/posts', { action: 'get', id: post_id }, auth));
} while (p.status === 'generating');

// (manager+ session) publish:
await post(`/api/agent/${persona.id}/publish-post`, { post_id }, auth);
```
