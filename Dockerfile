FROM node:18-bookworm-slim

WORKDIR /app

# Native modules such as better-sqlite3 may need a compiler toolchain during npm ci.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY applePttPushService.js ./
COPY dataPaths.js ./
COPY db.js ./
COPY dbHandler.js ./
COPY server.js ./
COPY serverCore.js ./
COPY public ./public
COPY LICENSE ./
COPY README.md ./

ENV NODE_ENV=production \
  TALKTOME_NO_WIZARD=1 \
  TALKTOME_DATA_DIR=/data \
  MDNS_HOST=off \
  HTTPS_PORT=8443 \
  HTTP_PORT=8080

VOLUME ["/data"]

EXPOSE 8443 8080

CMD ["node", "server.js"]
