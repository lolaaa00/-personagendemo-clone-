FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    supervisor \
    curl \
    openssl \
    bash \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY src/ ./src/

RUN mkdir -p /data/stalwart /data/dkim /var/log/supervisor

# Supervisor configuration
RUN echo "[supervisord]" > /etc/supervisor/conf.d/personagen-mail.conf && \
    echo "nodaemon=true" >> /etc/supervisor/conf.d/personagen-mail.conf && \
    echo "logfile=/var/log/supervisor/supervisord.log" >> /etc/supervisor/conf.d/personagen-mail.conf && \
    echo "" >> /etc/supervisor/conf.d/personagen-mail.conf && \
    echo "[program:setup]" >> /etc/supervisor/conf.d/personagen-mail.conf && \
    echo "command=node /app/src/setup-stalwart.js" >> /etc/supervisor/conf.d/personagen-mail.conf && \
    echo "autorestart=false" >> /etc/supervisor/conf.d/personagen-mail.conf && \
    echo "startsecs=0" >> /etc/supervisor/conf.d/personagen-mail.conf && \
    echo "priority=1" >> /etc/supervisor/conf.d/personagen-mail.conf && \
    echo "stdout_logfile=/dev/stdout" >> /etc/supervisor/conf.d/personagen-mail.conf && \
    echo "stdout_logfile_maxbytes=0" >> /etc/supervisor/conf.d/personagen-mail.conf && \
    echo "stderr_logfile=/dev/stderr" >> /etc/supervisor/conf.d/personagen-mail.conf && \
    echo "stderr_logfile_maxbytes=0" >> /etc/supervisor/conf.d/personagen-mail.conf && \
    echo "" >> /etc/supervisor/conf.d/personagen-mail.conf && \
    echo "[program:health]" >> /etc/supervisor/conf.d/personagen-mail.conf && \
    echo "command=node /app/src/health.js" >> /etc/supervisor/conf.d/personagen-mail.conf && \
    echo "autorestart=true" >> /etc/supervisor/conf.d/personagen-mail.conf && \
    echo "priority=2" >> /etc/supervisor/conf.d/personagen-mail.conf && \
    echo "stdout_logfile=/dev/stdout" >> /etc/supervisor/conf.d/personagen-mail.conf && \
    echo "stdout_logfile_maxbytes=0" >> /etc/supervisor/conf.d/personagen-mail.conf && \
    echo "stderr_logfile=/dev/stderr" >> /etc/supervisor/conf.d/personagen-mail.conf && \
    echo "stderr_logfile_maxbytes=0" >> /etc/supervisor/conf.d/personagen-mail.conf

EXPOSE 8080 587 993 8081

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD curl -sf http://localhost:8081/health || exit 1

ENTRYPOINT ["bash", "/app/src/entrypoint.sh"]
