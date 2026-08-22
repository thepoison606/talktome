FROM node:24-bookworm-slim

ARG TALKTOME_VERSION=""

WORKDIR /app

# Native modules such as better-sqlite3 may need a compiler toolchain during npm ci.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Keep all root-level runtime modules together so a newly required module cannot
# be omitted from the image by an incomplete list of COPY instructions.
COPY *.js ./
COPY scripts/resolve-build-version.js ./scripts/resolve-build-version.js
COPY public ./public
COPY LICENSE ./
COPY README.md ./

ENV NODE_ENV=production \
  TALKTOME_VERSION=${TALKTOME_VERSION} \
  TALKTOME_NO_WIZARD=1 \
  TALKTOME_DATA_DIR=/data \
  MDNS_HOST=off \
  HTTPS_PORT=8443 \
  HTTP_PORT=8080

VOLUME ["/data"]

EXPOSE 8443 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "containerHealthcheck.js"]

CMD ["node", "server.js"]
