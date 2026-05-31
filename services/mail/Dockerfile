FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    supervisor \
    curl \
    openssl \
    bash \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install Stalwart Mail Server binary (v0.16.7)
RUN curl -fsSL "https://github.com/stalwartlabs/stalwart/releases/download/v0.16.7/stalwart-x86_64-unknown-linux-gnu.tar.gz" \
    -o /tmp/stalwart.tar.gz \
    && mkdir -p /tmp/stalwart-extract \
    && tar xzf /tmp/stalwart.tar.gz -C /tmp/stalwart-extract/ \
    && find /tmp/stalwart-extract -type f -name "stalwart*" -exec cp {} /usr/local/bin/stalwart-mail \; \
    && chmod +x /usr/local/bin/stalwart-mail \
    && rm -rf /tmp/stalwart.tar.gz /tmp/stalwart-extract

WORKDIR /app

COPY services/mail/src/ ./src/

RUN mkdir -p /data/stalwart/etc /data/stalwart/data /data/stalwart/queue /data/stalwart/logs \
    /data/dkim /data/inboxes /var/log/supervisor

# Supervisor configuration — runs setup (once), stalwart, health, and api
RUN cat > /etc/supervisor/conf.d/personagen-mail.conf <<'EOF'
[supervisord]
nodaemon=true
logfile=/var/log/supervisor/supervisord.log

[program:setup]
command=node /app/src/setup-stalwart.js
autorestart=false
startsecs=0
priority=1
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0

[program:stalwart]
command=/usr/local/bin/stalwart-mail -c /data/stalwart/etc/config.toml
autostart=false
autorestart=true
startretries=10
startsecs=3
priority=10
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0

[program:health]
command=node /app/src/health.js
autorestart=true
priority=20
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0

[program:api]
command=node /app/src/api.js
autorestart=true
priority=20
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0
EOF

# SMTP(25), Submission(587), IMAPS(993), API(8080), Health(8081)
EXPOSE 25 587 993 8080 8081

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD curl -sf http://localhost:8081/health || exit 1

ENTRYPOINT ["bash", "/app/src/entrypoint.sh"]
