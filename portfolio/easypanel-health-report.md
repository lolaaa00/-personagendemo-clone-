# EasyPanel Infrastructure Health Report

**Date:** 2026-07-01T03:18:00-04:00  
**Panel:** `zi1cc5.easypanel.host`  
**Server IP:** `72.60.125.183`

---

## Executive Summary

The EasyPanel instance is experiencing a **critical deploy pipeline failure** affecting all new service deployments. Existing services continue to run and can be redeployed, but no new services can be built or started. A panel restart was initiated and the system was at 502 (recovering) at the time of this report.

---

## System State

### GitHub Integration
- **Token type:** Classic PAT (`ghp_` prefix)
- **Token scope:** `repo`
- **Token owner:** `ratiogamo`
- **API rate limit:** 5000 (52 used, 4948 remaining)
- **GitHub App installed:** ❌ No (only PAT)

> [!WARNING]
> No GitHub App installation was found. EasyPanel's `github` source type may require the GitHub App for private repo access. The existing PAT works for API access but may not satisfy EasyPanel's internal clone mechanism for new deployments.

### Active Services (Enabled)

| Project | Service | Type | Status |
|---------|---------|------|--------|
| confucius-cluster | alpaca-bridge | app | ✅ Running (redeploy tested OK) |
| confucius-cluster | docmost-web | app | ✅ Running |
| confucius-cluster | docmost-db | postgres | ✅ Running |
| confucius-cluster | docmost-redis | redis | ✅ Running |
| confucius-cluster | polymarket | app | ✅ Running |
| l2g | docuseal | app | ✅ Running |
| l2g | docuseal-db | postgres | ✅ Running |
| l2g | george-ai | app | ✅ Running |
| anakaliyah | db | postgres | ✅ Running (newly created) |
| anakaliyah | app | app | ⛔ Deploy blocked |

### Disabled Services

| Project | Service | Type |
|---------|---------|------|
| confucius-cluster | akhuapothecary | app |
| confucius-cluster | directus | app |
| confucius-cluster | directus-db | postgres |
| confucius-cluster | directus-redis | redis |
| golden | ollama | app |
| golden | ollama-web | app |
| golden | postgres-db | postgres |
| golden | redis-cache | redis |
| golden | supoclip-backend | app |
| golden | supoclip-frontend | app |
| golden | supoclip-worker | app |

---

## Deploy Pipeline Test Matrix

| Test | Source | Target | Result |
|------|--------|--------|--------|
| Redeploy existing `alpaca-bridge` | inline dockerfile | confucius-cluster | ✅ **PASS** |
| New service with `github` source | ratiogamo/anakaliyah | anakaliyah | ❌ Invariant failed |
| New service with `git` source (HTTPS+PAT) | PAT-embedded URL | anakaliyah | ❌ Invariant failed |
| New service with `git` source (SSH) | git@github.com:... | anakaliyah | ❌ Invariant failed |
| New service with `image` source | nginx:alpine | anakaliyah | ❌ Invariant failed |
| New service with `image` source in new project | nginx:alpine | test-deploy | ❌ Invariant failed |
| Deploy after Docker cleanup | any | anakaliyah | ❌ Invariant failed |
| Deploy after system prune | any | anakaliyah | ❌ Invariant failed |

**Conclusion:** ALL new service deploys fail. Only redeploys of pre-existing services work.

---

## Recovery Actions Taken

| Action | Timestamp | Result |
|--------|-----------|--------|
| Docker image cleanup | 07:14:29 UTC | No effect on deploys |
| System prune | 07:14:34 UTC | No effect on deploys |
| EasyPanel restart | 07:15:34 UTC | Panel went to 502, not yet recovered |

---

## Recommended Next Steps

### Immediate (Unblock Anakaliyah Deploy)
1. **Wait for EasyPanel restart to complete** — check `https://zi1cc5.easypanel.host` in browser
2. **Retry deploy** after panel is back — the restart may clear the state corruption
3. If still failing, **SSH into VPS** and run:
   ```bash
   # Check disk space
   df -h
   
   # Check Docker daemon health
   docker info
   docker system df
   
   # Check EasyPanel container logs
   docker logs easypanel -n 100
   
   # Force recreate EasyPanel
   docker compose -f /etc/easypanel/docker-compose.yml up -d --force-recreate
   ```

### Fallback (If EasyPanel Stays Broken)
4. **Deploy anakaliyah via docker compose directly on VPS** (Path A from checklist):
   ```bash
   cd /opt/anakaliyah  # or wherever you want
   git clone https://<PAT>@github.com/ratiogamo/anakaliyah.git .
   # Create .env with the values
   docker compose up -d --build
   ```

### Long-term
5. **Install EasyPanel GitHub App** on the `ratiogamo` GitHub account to properly support private repo deployments via the `github` source type
6. **Update EasyPanel** to latest version — the "Invariant failed" error may be a known bug in the current version
7. Consider disabling unused services (11 disabled services consuming panel resources)

---

## Security Notes

> [!CAUTION]
> The panel inventory dump revealed environment variables for ALL services including API keys, database passwords, and secrets. These are accessible via the `projects.listProjectsAndServices` API query. Ensure the EasyPanel admin token is rotated periodically and stored securely.
