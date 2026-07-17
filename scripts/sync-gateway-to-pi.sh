#!/usr/bin/env bash
set -euo pipefail

target="${TALKTOME_GATEWAY_HOST:-${TALKTOME_PI:-}}"
dest="${TALKTOME_GATEWAY_DIR:-${TALKTOME_PI_DIR:-~/talktome-dev}}"

if [[ -z "$target" ]]; then
  echo "Set TALKTOME_GATEWAY_HOST=user@gateway-host.local before running gateway sync." >&2
  exit 1
fi

rsync -az package.json package-lock.json README.md serverCore.js webrtcConfig.js "${target}:${dest}/"
rsync -az \
  --exclude radio-config.json \
  --exclude rx-segments/ \
  gateway/ "${target}:${dest}/gateway/"
