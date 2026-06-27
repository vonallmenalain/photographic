# Backend image for the QNAP (Container Station / docker-compose).
# Multi-stage: build TypeScript, then run a slim production image.

FROM node:22-bookworm-slim AS build
WORKDIR /app
# Build tools for native modules (sharp) just in case.
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
# Fonts are REQUIRED for the photo watermark: sharp renders the watermark text
# through an SVG overlay (librsvg). The slim base image ships without any fonts,
# in which case the text silently renders as nothing and previews end up WITHOUT
# a watermark. fontconfig + a sans-serif family fix that. The DejaVu/Liberation
# families stay as metric-compatible fallbacks.
RUN apt-get update && apt-get install -y --no-install-recommends \
        fontconfig fonts-dejavu-core fonts-liberation \
    && rm -rf /var/lib/apt/lists/*
# Ship the website display font(s) so the watermark uses the SAME typeface as
# the rest of the site (Kalam by default; see IMG_WATERMARK_FONT_FAMILY).
# Anything dropped into backend/assets/fonts is installed and registered here,
# so adding/swapping a font is just a file + an env var – no code change.
COPY assets/fonts/ /usr/share/fonts/truetype/website/
RUN fc-cache -f
COPY package.json package-lock.json* ./
RUN npm install --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
# Photo originals + generated variants live on a mounted volume.
# (All other data lives in Cloud Firestore.)
VOLUME ["/data"]
EXPOSE 4000
CMD ["node", "dist/index.js"]
