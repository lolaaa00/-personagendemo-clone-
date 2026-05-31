FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    supervisor \
    openssl \
    bash \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY services/mail/src/ ./src/

# Install Node deps (smtp-server, mailparser)
RUN cd /app/src && npm install --omit=dev

# Strip Windows CRLF from shell scripts
RUN sed -i 's/\r$//' /app/src/entrypoint.sh && chmod +x /app/src/entrypoint.sh

RUN mkdir -p /data/dkim /data/inboxes /var/log/supervisor

# Supervisor — smtp(25), api(8080), health(8081)
RUN cat > /etc/supervisor/conf.d/personagen-mail.conf <<'EOF'
[supervisord]
nodaemon=true
logfile=/var/log/supervisor/supervisord.log

[program:smtp]
command=node /app/src/smtp.js
autostart=true
autorestart=true
startsecs=2
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0

[program:api]
command=node /app/src/api.js
autostart=true
autorestart=true
startsecs=2
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0

[program:health]
command=node /app/src/health.js
autostart=true
autorestart=true
startsecs=2
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0
EOF

# SMTP(25), Submission(587), API(8080), Health(8081)
EXPOSE 25 587 8080 8081

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -sf http://localhost:8081/health || exit 1

ENTRYPOINT ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/personagen-mail.conf"]
