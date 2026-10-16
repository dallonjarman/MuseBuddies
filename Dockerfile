# Pinned so builds are reproducible; Dependabot proposes patch and minor updates,
# and a weekly CI rebuild picks up security fixes in the base image.
FROM node:22.23.3-slim

WORKDIR /app
ENV NODE_ENV=production PORT=8787 HOST=0.0.0.0 DATABASE_PATH=/data/relay.db

# The relay has no runtime dependencies: just the source and the website.
COPY package.json self-host.md docker-compose.yml ./
COPY scripts ./scripts
COPY src ./src
COPY public ./public

# Build the client package (served at /client.tar.gz) once, here, instead of at every start.
# /app stays root-owned and read-only to the relay; only /data is writable.
RUN bash scripts/package-client.sh \
 && mkdir -p /data && chown node:node /data

VOLUME /data
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8787/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# The entrypoint fixes data-directory ownership, then execs Node as the unprivileged node user.
# Node runs as PID 1 directly (no npm wrapper), so SIGTERM reaches the relay's graceful shutdown.
ENTRYPOINT ["/app/scripts/docker-entrypoint.sh"]
CMD ["node", "--no-warnings", "src/server/main.ts"]
