#!/usr/bin/env bash
set -euo pipefail

DKIM_DIR="/data/dkim"
DKIM_PRIVATE="${DKIM_DIR}/private.pem"
DKIM_PUBLIC="${DKIM_DIR}/public.pem"
DKIM_SELECTOR="${DKIM_SELECTOR:-personagen}"
MAIL_DOMAIN="${MAIL_DOMAIN:-mail.personagen.com}"
STALWART_DATA="${STALWART_DATA_DIR:-/data/stalwart}"

echo "============================================="
echo "  PersonaGen AgenticMail — Entrypoint"
echo "============================================="
echo ""

# ── Ensure directories ──────────────────────────
mkdir -p "${DKIM_DIR}" "${STALWART_DATA}" /var/log/supervisor

# ── DKIM key generation (first run only) ────────
if [ ! -f "${DKIM_PRIVATE}" ]; then
    echo "[INIT] First run detected — generating DKIM keys..."
    openssl genrsa -out "${DKIM_PRIVATE}" 2048 2>/dev/null
    openssl rsa -in "${DKIM_PRIVATE}" -pubout -out "${DKIM_PUBLIC}" 2>/dev/null
    chmod 600 "${DKIM_PRIVATE}"
    chmod 644 "${DKIM_PUBLIC}"

    # Extract public key for DNS record (strip headers, join lines)
    DKIM_DNS_VALUE=$(grep -v "^-" "${DKIM_PUBLIC}" | tr -d '\n')

    echo ""
    echo "============================================="
    echo "  REQUIRED DNS RECORDS"
    echo "============================================="
    echo ""
    echo "Add the following DNS records to your domain:"
    echo ""
    echo "── MX Record ────────────────────────────────"
    echo "  Type:     MX"
    echo "  Name:     @"
    echo "  Value:    ${MAIL_DOMAIN}"
    echo "  Priority: 10"
    echo ""
    echo "── SPF Record ───────────────────────────────"
    echo "  Type:     TXT"
    echo "  Name:     @"
    echo "  Value:    v=spf1 mx a:${MAIL_DOMAIN} -all"
    echo ""
    echo "── DKIM Record ──────────────────────────────"
    echo "  Type:     TXT"
    echo "  Name:     ${DKIM_SELECTOR}._domainkey"
    echo "  Value:    v=DKIM1; k=rsa; p=${DKIM_DNS_VALUE}"
    echo ""
    echo "── DMARC Record ─────────────────────────────"
    echo "  Type:     TXT"
    echo "  Name:     _dmarc"
    echo "  Value:    v=DMARC1; p=quarantine; rua=mailto:admin@${MAIL_DOMAIN}; pct=100"
    echo ""
    echo "── Reverse DNS (PTR) ────────────────────────"
    echo "  Set PTR for your server IP → ${MAIL_DOMAIN}"
    echo ""
    echo "============================================="
    echo ""
else
    echo "[INIT] DKIM keys already exist, skipping generation."
fi

# ── Run Stalwart setup script ───────────────────
echo "[INIT] Running Stalwart configuration..."
node /app/src/setup-stalwart.js

# ── Start supervisor (health check + Stalwart) ──
echo "[INIT] Starting services via supervisor..."

# Note: In production, Stalwart binary would be installed and managed by supervisor.
# For the wrapper structure, supervisor manages the health endpoint and setup process.
exec /usr/bin/supervisord -c /etc/supervisor/conf.d/personagen-mail.conf
