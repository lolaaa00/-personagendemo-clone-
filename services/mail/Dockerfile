# Use official Stalwart image — binary pre-installed at /usr/local/bin/stalwart
FROM stalwartlabs/stalwart:v0.15.4

# Install Node.js, supervisor, and tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    supervisor \
    curl \
    openssl \
    nodejs \
    npm \
    bash \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY src/ ./src/

# Install Node deps
RUN cd /app/src && npm install --omit=dev

# Strip Windows CRLF from shell scripts
RUN sed -i 's/\r$//' /app/src/entrypoint.sh && chmod +x /app/src/entrypoint.sh

RUN mkdir -p /data/stalwart/data /data/stalwart/queue /data/stalwart/logs \
    /data/dkim /data/inboxes /var/log/supervisor

# Supervisor config
RUN cat > /etc/supervisor/conf.d/personagen-mail.conf <<'EOF'
[supervisord]
nodaemon=true
logfile=/var/log/supervisor/supervisord.log

[program:stalwart]
command=/usr/local/bin/stalwart -c /tmp/stalwart-config.toml
autostart=true
autorestart=true
startretries=5
startsecs=3
priority=10
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0

[program:api]
command=node /app/src/api.js
autorestart=true
priority=20
startsecs=2
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0

[program:health]
command=node /app/src/health.js
autorestart=true
priority=20
startsecs=2
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0
EOF

EXPOSE 25 587 143 8080 8081

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -sf http://localhost:8081/health || exit 1

ENTRYPOINT ["bash", "/app/src/entrypoint.sh"]
