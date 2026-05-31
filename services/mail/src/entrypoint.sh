#!/usr/bin/env bash
set -euo pipefail

DKIM_DIR="/data/dkim"
DKIM_PRIVATE="${DKIM_DIR}/private.pem"
DKIM_PUBLIC="${DKIM_DIR}/public.pem"
DKIM_SELECTOR="${DKIM_SELECTOR:-agenticmail}"
MAIL_DOMAIN="${MAIL_DOMAIN:-l2gseo.com}"
STALWART_DATA="${STALWART_DATA_DIR:-/data/stalwart}"
CONFIG_PATH="/tmp/stalwart-config.toml"

echo "============================================="
echo "  PersonaGen AgenticMail — Entrypoint"
echo "============================================="
echo ""

# ── Ensure directories ──────────────────────────
mkdir -p "${DKIM_DIR}" "${STALWART_DATA}/data" /var/log/supervisor

# ── DKIM key generation (first run only) ────────
if [ ! -f "${DKIM_PRIVATE}" ]; then
    echo "[INIT] Generating DKIM keys..."
    openssl genrsa -out "${DKIM_PRIVATE}" 2048 2>/dev/null
    openssl rsa -in "${DKIM_PRIVATE}" -pubout -out "${DKIM_PUBLIC}" 2>/dev/null
    chmod 600 "${DKIM_PRIVATE}"
    chmod 644 "${DKIM_PUBLIC}"
    echo "[INIT] DKIM keys generated."
else
    echo "[INIT] DKIM keys already exist, skipping."
fi

# ── Write Stalwart config directly (no Node.js script) ──
echo "[INIT] Writing Stalwart configuration to ${CONFIG_PATH}..."

cat > "${CONFIG_PATH}" <<TOML
[server]
hostname = "${MAIL_DOMAIN}"
max-connections = 1024

[server.listener.smtp]
bind = ["0.0.0.0:25"]
protocol = "smtp"

[server.listener.submission]
bind = ["0.0.0.0:587"]
protocol = "smtp"

[server.listener.imap]
bind = ["0.0.0.0:143"]
protocol = "imap"

[server.listener.http]
bind = ["0.0.0.0:8443"]
protocol = "http"

[store."db"]
type = "rocksdb"
path = "${STALWART_DATA}/data"
compression = "lz4"

[storage]
data = "db"
blob = "db"
fts = "db"
lookup = "db"

[session.rcpt]
max-recipients = 100
relay = true
[session.data.pipe."deliver"]
command = "node"
arguments = ["/app/src/inbox-deliver.js"]
timeout = "30s"

[sieve.trusted.from-config]
name = "deliver-all"
script = """
require [\"vnd.stalwart.execute\"];
execute :pipe \"deliver\";
"""

[tracer."stdout"]
type = "stdout"
level = "info"
ansi = false

TOML

# Verify the file was written and is not empty
CONFIG_SIZE=$(wc -c < "${CONFIG_PATH}")
echo "[INIT] Config written: ${CONFIG_SIZE} bytes at ${CONFIG_PATH}"

if [ "${CONFIG_SIZE}" -lt 100 ]; then
    echo "[ERROR] Config file too small (${CONFIG_SIZE} bytes) — aborting"
    cat "${CONFIG_PATH}"
    exit 1
fi

# ── Start supervisor ──────────────────────────────
echo "[INIT] Starting supervisor..."
exec /usr/bin/supervisord -c /etc/supervisor/conf.d/personagen-mail.conf
