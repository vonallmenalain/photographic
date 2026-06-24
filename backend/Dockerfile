# Backend image for the QNAP (Container Station / docker-compose).
# Multi-stage: build TypeScript, then run a slim production image.

FROM node:22-bookworm-slim AS build
WORKDIR /app
# Build tools for native modules (better-sqlite3, sharp) just in case.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
RUN npm install
COPY tsconfig.json ./
COPY scripts ./scripts
COPY src ./src
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
RUN npm install --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
# Storage + DB live on a mounted volume.
VOLUME ["/data"]
EXPOSE 4000
CMD ["node", "dist/index.js"]
