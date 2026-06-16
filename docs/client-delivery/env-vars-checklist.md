# Environment Variables Checklist — Account Factory

**Platform:** PersonaGen Account Factory  
**Document Type:** Client Delivery — Environment Reference  

> Complete reference for all environment variables across both Account Factory services. Configure these in Easypanel → Service → Environment tab.

---

## Factory Service (`personagen-factory`)

### Core Configuration

| Variable | Required | Default | Description | Example |
|----------|----------|---------|-------------|---------|
| `FACTORY_PORT` | Optional | `8080` | HTTP port the factory API listens on | `8080` |
| `FACTORY_API_KEY` | **Required** | — | API key for authenticating requests to the factory | `af_sk_a1b2c3d4e5f6...` |
| `ENCRYPTION_KEY` | **Required** | — | 32-byte hex key for AES-256 encryption of stored sessions/cookies | `e3b0c44298fc1c14...` (64 hex chars) |
| `ALLOWED_ORIGINS` | Optional | `*` | Comma-separated list of allowed CORS origins | `https://dashboard.yourdomain.com` |

### Mail Integration

| Variable | Required | Default | Description | Example |
|----------|----------|---------|-------------|---------|
| `MAIL_URL` | **Required** | — | Internal URL of the AgenticMail service | `http://personagen-mail:8080` |
| `MAIL_API_KEY` | **Required** | — | API key to authenticate with the mail service (must match mail `MAIL_API_KEY`) | `am_sk_x9y8z7w6...` |

### Proxy Configuration

| Variable | Required | Default | Description | Example |
|----------|----------|---------|-------------|---------|
| `PROXY_HOST` | Optional | — | Proxy server hostname or IP | `us.smartproxy.com` |
| `PROXY_PORT` | Optional | — | Proxy server port | `10001` |
| `PROXY_USER` | Optional | — | Proxy authentication username | `sp_user_abc123` |
| `PROXY_PASS` | Optional | — | Proxy authentication password | `proxy_pass_xyz` |
| `PROXY_TYPE` | Optional | `http` | Proxy protocol type (`http`, `socks5`) | `http` |

> [!TIP]
> Proxy format shorthand: `host:port:user:pass`. The factory accepts either individual env vars or a single `PROXY_URL` in the format `http://user:pass@host:port`.

### CAPTCHA Configuration

| Variable | Required | Default | Description | Example |
|----------|----------|---------|-------------|---------|
| `CAPTCHA_PROVIDER` | Optional | — | CAPTCHA solving service provider (`2captcha`, `anticaptcha`, `capsolver`) | `2captcha` |
| `CAPTCHA_API_KEY` | Optional | — | API key for the CAPTCHA solving service | `2cap_abc123def456...` |

### Engine Integration

| Variable | Required | Default | Description | Example |
|----------|----------|---------|-------------|---------|
| `ENGINE_WEBHOOK_URL` | Optional | — | Engine webhook URL for status callbacks on account creation events | `https://<your-portal-domain>/webhook/personagen-factory` |

### Rate Limiting

| Variable | Required | Default | Description | Example |
|----------|----------|---------|-------------|---------|
| `MAX_CREATIONS_PER_DAY` | Optional | `10` | Maximum number of accounts to create per 24-hour period | `5` |
| `COOLDOWN_MINUTES` | Optional | `15` | Minimum minutes to wait between account creation attempts | `30` |

### Storage

| Variable | Required | Default | Description | Example |
|----------|----------|---------|-------------|---------|
| `PROFILES_DIR` | Optional | `./data/profiles` | Directory path for storing browser profiles and session data | `/app/data/profiles` |
| `DB_PATH` | Optional | `./data/factory.db` | Path to the SQLite database file | `/app/data/factory.db` |

---

## Mail Service (`personagen-mail`)

### Core Configuration

| Variable | Required | Default | Description | Example |
|----------|----------|---------|-------------|---------|
| `MAIL_DOMAIN` | **Required** | — | Domain used for email addresses (must have DNS configured) | `mail.<your-domain.com>` |
| `MAIL_API_KEY` | **Required** | — | API key for authenticating requests to the mail service | `am_sk_x9y8z7w6...` |
| `MAIL_API_PORT` | Optional | `8080` | HTTP port the mail API listens on | `8080` |
| `HEALTH_PORT` | Optional | `8081` | HTTP port for aggregate mail health checks | `8081` |

### Email Server Ports

The current Docker image binds SMTP, Submission, and IMAP listeners in `services/mail/src/entrypoint.sh`. Configure host/Easypanel port exposure rather than environment variables for these listeners.

| Variable | Required | Default | Description | Example |
|----------|----------|---------|-------------|---------|
| SMTP listener | Fixed | `25` | Inbound SMTP listener | `25` |
| Submission listener | Fixed | `587` | Authenticated SMTP/submission listener | `587` |
| IMAP listener | Fixed | `143` | IMAP listener | `143` |

### DKIM Configuration

| Variable | Required | Default | Description | Example |
|----------|----------|---------|-------------|---------|
| `DKIM_SELECTOR` | Optional | `default` | DKIM selector for DNS TXT record lookup | `default` |

### Google Voice Integration

| Variable | Required | Default | Description | Example |
|----------|----------|---------|-------------|---------|
| `GOOGLE_VOICE_EMAIL` | Optional | — | Google account email for Voice SMS forwarding | `yourname@gmail.com` |
| `GOOGLE_VOICE_APP_PASSWORD` | Optional | — | Google app password (16-char, generated with 2FA enabled) | `abcd efgh ijkl mnop` |

> [!WARNING]
> Google app passwords require 2FA to be enabled on the Google account. Generate at [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords). This is NOT your Google account password.

### AI Reply Configuration

| Variable | Required | Default | Description | Example |
|----------|----------|---------|-------------|---------|
| `AI_REPLY_ENABLED` | Optional | `false` | Enable AI-drafted replies to inbound emails | `true` |
| `AI_MODEL` | Optional | `claude-haiku-4.5` | AI model for drafting email replies (via OpenRouter) | `claude-sonnet-4.6` |

---

## Quick Copy Template

### Factory `.env`

```env
# === Core ===
FACTORY_PORT=8080
FACTORY_API_KEY=
ENCRYPTION_KEY=
ALLOWED_ORIGINS=https://<your-dashboard-domain>

# === Mail Integration ===
MAIL_URL=http://personagen-mail:8080
MAIL_API_KEY=

# === Proxy (Tier 1+ recommended for production) ===
PROXY_HOST=
PROXY_PORT=
PROXY_USER=
PROXY_PASS=
PROXY_TYPE=http

# === CAPTCHA ===
CAPTCHA_PROVIDER=
CAPTCHA_API_KEY=

# === Engine Callbacks ===
ENGINE_WEBHOOK_URL=

# === Rate Limiting ===
MAX_CREATIONS_PER_DAY=10
COOLDOWN_MINUTES=15

# === Storage ===
PROFILES_DIR=./data/profiles
DB_PATH=./data/factory.db
```

### Mail `.env`

```env
# === Core ===
MAIL_DOMAIN=
MAIL_API_KEY=
MAIL_API_PORT=8080
HEALTH_PORT=8081

# === DKIM ===
DKIM_SELECTOR=default

# === Google Voice ===
GOOGLE_VOICE_EMAIL=
GOOGLE_VOICE_APP_PASSWORD=

# === AI Replies ===
AI_REPLY_ENABLED=false
AI_MODEL=claude-haiku-4.5
```

---

## Key Generation Commands

```bash
# Generate FACTORY_API_KEY
openssl rand -base64 32

# Generate ENCRYPTION_KEY (32-byte hex)
openssl rand -hex 32

# Generate MAIL_API_KEY
openssl rand -base64 32
```

---

*Monarch Stack — Fractional CTO Services*
