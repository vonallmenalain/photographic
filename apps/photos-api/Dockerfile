FROM node:20-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json* ./
RUN npm install

COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

RUN mkdir -p /data/photos && chown -R node:node /app /data/photos

USER node

EXPOSE 8787

CMD ["node", "dist/server.js"]
