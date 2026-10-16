FROM node:22-slim
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY public ./public
COPY scripts ./scripts
COPY self-host.md ./
RUN mkdir -p /data && chown -R node:node /app /data
ENV PORT=8787 HOST=0.0.0.0 DATABASE_PATH=/data/relay.db NPM_CONFIG_UPDATE_NOTIFIER=false
VOLUME /data
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8787/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# The entrypoint fixes data-directory ownership, then drops to the node user.
ENTRYPOINT ["/app/scripts/docker-entrypoint.sh"]
CMD ["npm", "start"]
