FROM node:24.22.2-bookworm-slim

ARG TALKTOME_VERSION=""

WORKDIR /app

# Native modules may need a compiler toolchain; mediasoup's worker build also uses pip.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-pip make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy the complete server source tree, including shared path resolution.
COPY server.js ./
COPY src ./src
COPY scripts/container-healthcheck.js ./scripts/container-healthcheck.js
COPY scripts/resolve-build-version.js ./scripts/resolve-build-version.js
COPY public ./public
COPY LICENSE ./
COPY README.md ./

# Preserve the build version independently of runtime environment overrides.
# Local builds without a version argument retain the existing unknown fallback.
RUN if [ -n "$TALKTOME_VERSION" ]; then \
      TALKTOME_BUILD_VERSION="$TALKTOME_VERSION" \
        node scripts/resolve-build-version.js --version-json build-version.json; \
    fi

ENV NODE_ENV=production \
  TALKTOME_VERSION=${TALKTOME_VERSION} \
  TALKTOME_NO_WIZARD=1 \
  TALKTOME_DATA_DIR=/data \
  MDNS_HOST=off \
  HTTP_PORT=8080

VOLUME ["/data"]

EXPOSE 8443 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "scripts/container-healthcheck.js"]

CMD ["node", "server.js"]
