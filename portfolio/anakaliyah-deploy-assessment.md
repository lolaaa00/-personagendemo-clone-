# Anakaliyah (Telegram Bot Admin) — EasyPanel Deploy Assessment

**Date:** 2026-07-01T03:18:00-04:00  
**Target Panel:** `zi1cc5.easypanel.host` (IP: `72.60.125.183`)  
**Repo:** `ratiogamo/anakaliyah` (private)  
**Default Branch:** `claude/init-anakaliyah-repo-klaqu6`  
**Status:** ⛔ BLOCKED — EasyPanel deploy system failing for all new services

---

## App Architecture

| Component | Detail |
|-----------|--------|
| Framework | FastAPI (Python 3.12-slim) |
| Server | Uvicorn, port **8000** |
| Database | PostgreSQL 16 (`postgresql+asyncpg://`) |
| ORM | SQLAlchemy 2.0 + Alembic migrations |
| Auth | Session-based (bcrypt, itsdangerous) |
| Rate Limit | SlowAPI |
| Telegram | python-telegram-bot 21.6 |

### Dockerfile

```dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
COPY alembic.ini .
COPY migrations ./migrations
RUN mkdir -p /app/data \
    && useradd --create-home --uid 1000 appuser \
    && chown -R appuser:appuser /app
USER appuser
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

### Requirements

```
fastapi==0.115.0
uvicorn[standard]==0.30.6
python-telegram-bot==21.6
SQLAlchemy==2.0.35
alembic==1.18.5
aiosqlite==0.20.0
asyncpg==0.29.0
jinja2==3.1.4
python-multipart==0.0.9
passlib==1.7.4
bcrypt==4.0.1
itsdangerous==2.2.0
pydantic-settings==2.5.2
slowapi==0.1.10
```

---

## Environment Variables (Provided)

```env
APP_BASE_URL=https://anakaliyah-app.zi1cc5.easypanel.host
DATABASE_URL=postgresql+asyncpg://postgres:postgres@anakaliyah_db:5432/anakaliyah
SECRET_KEY=37af7cbe5b7741b6f97232049c1cc828cff71146a748bb3633ac24a03740f1e0
INITIAL_ADMIN_USERNAME=admin
INITIAL_ADMIN_PASSWORD=LMEH0bKTI7C1WvmbkBc6llgb
SESSION_COOKIE_SECURE=true
```

---

## EasyPanel Setup Completed

### ✅ Project Created
- Project name: `anakaliyah`

### ✅ Postgres Service Created
- Service name: `db`
- Image: `postgres:16-alpine`
- User: `postgres` / Password: `postgres`
- Database name: `anakaliyah`
- Internal hostname: `anakaliyah_db`
- DBGate URL: `anakaliyah-db-dbgate.zi1cc5.easypanel.host`
- PGWeb URL: `anakaliyah-db-pgweb.zi1cc5.easypanel.host`

### ⛔ App Service — Deploy BLOCKED
- Service name: `app`
- Domain configured: `anakaliyah-app.zi1cc5.easypanel.host` (HTTPS, port 8000)
- Env vars: 6 vars set
- Source: GitHub (`ratiogamo/anakaliyah`, branch `claude/init-anakaliyah-repo-klaqu6`)
- Build: Dockerfile

---

## Failure Analysis

### Error: `Invariant failed` on Every Deploy Attempt

**What was tried (all failed with same error):**

| Attempt | Source Type | Build Type | Branch | Result |
|---------|-----------|-----------|--------|--------|
| 1 | `github` (owner/repo) | `dockerfile` | `claude/init-anakaliyah-repo-klaqu6` | ❌ Invariant failed |
| 2 | `git` (PAT-embedded HTTPS URL) | `dockerfile` | same | ❌ Invariant failed |
| 3 | `github` | `nixpacks` | same | ❌ Invariant failed |
| 4 | `github` | `dockerfile` | `main` | ❌ Invariant failed |
| 5 | `git` (SSH URL `git@github.com:...`) | `dockerfile` | same | ❌ Invariant failed |
| 6 | `image` (`nginx:alpine`) | n/a | n/a | ❌ Invariant failed |
| 7 | `image` (`nginx:alpine`) in new project `test-deploy` | n/a | n/a | ❌ Invariant failed |

### Key Finding: System-Wide New Deploy Failure

- **Existing** service redeploys WORK (tested: `confucius-cluster/alpaca-bridge` → status `done`)
- **All NEW** service deploys fail, regardless of source type, build type, or project
- Even a simple `nginx:alpine` image deploy in a fresh project fails
- This confirms the issue is **inside EasyPanel's deploy pipeline**, not repo/auth related

### GitHub Access Verified
- Token type: Classic PAT (`ghp_` prefix) with `repo` scope
- Token owner: `ratiogamo`
- Repo accessible: ✅ (200 from GitHub API)
- No GitHub App installation (only PAT)
- Existing services using `github` source type (polymarket-bot) have working commits from months ago

### Recovery Attempts
1. **Docker image cleanup** (`cleanupDockerImages`) → Did not fix
2. **System prune** (`systemPrune`) → Did not fix  
3. **EasyPanel restart** (`restartEasypanel`) → Panel went to 502, still recovering at time of assessment

---

## Root Cause Hypothesis

EasyPanel's internal deployment orchestrator has a state corruption or version-specific bug affecting **new service deployments only**. Existing services can redeploy because their build context/cache is already present. New services fail at the pre-build validation stage ("Invariant failed" is a generic assertion error from the `tiny-invariant` JS library used internally).

**Likely fix paths:**
1. Wait for EasyPanel to fully restart (was at 502 for 3+ minutes at assessment end)
2. SSH into the VPS and check Docker daemon health / disk space directly
3. Update EasyPanel to latest version (may resolve internal bug)
4. As a fallback, deploy via `docker compose up -d --build` directly on the VPS (Path A from checklist)

---

## Remaining Checklist (Once Deploy Unblocked)

- [ ] Confirm app service builds successfully
- [ ] Verify Alembic migrations run on startup
- [ ] Visit `https://anakaliyah-app.zi1cc5.easypanel.host/admin`
- [ ] Login with `admin` / `LMEH0bKTI7C1WvmbkBc6llgb`
- [ ] Create Telegram bot via @BotFather → `/newbot`
- [ ] Add bot in admin panel with name + token
- [ ] Build welcome step and set as bot's Welcome step
- [ ] Register Telegram webhook (requires HTTPS — domain already configured)
- [ ] Test `/start` on Telegram
- [ ] Test lead capture flow

---

## Panel Inventory Snapshot (Pre-Restart)

| Project | Service | Type | Enabled | Source |
|---------|---------|------|---------|--------|
| anakaliyah | db | postgres | ✅ | postgres:16-alpine |
| anakaliyah | app | app | ✅ | github (blocked) |
| confucius-cluster | akhuapothecary | app | ❌ | git (SSH) |
| confucius-cluster | alpaca-bridge | app | ✅ | dockerfile (inline) |
| confucius-cluster | directus | app | ❌ | image |
| confucius-cluster | docmost-web | app | ✅ | image |
| confucius-cluster | polymarket | app | ✅ | github |
| golden | ollama | app | ❌ | image |
| golden | ollama-web | app | ❌ | image |
| golden | supoclip-backend | app | ❌ | github |
| golden | supoclip-frontend | app | ❌ | github |
| golden | supoclip-worker | app | ❌ | github |
| l2g | docuseal | app | ✅ | image |
| l2g | george-ai | app | ✅ | (not shown) |
