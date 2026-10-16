FROM node:22-slim
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY public ./public
COPY scripts ./scripts
ENV PORT=8787 DATABASE_PATH=/data/relay.db
VOLUME /data
EXPOSE 8787
CMD ["npm", "start"]
