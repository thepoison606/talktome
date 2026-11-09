#!/usr/bin/env bash
# Builds the talktome-headless Debian package for the host or a cross target.
#
#   scripts/build-deb.sh                      # host architecture
#   scripts/build-deb.sh aarch64-unknown-linux-gnu
#   scripts/build-deb.sh armv7-unknown-linux-gnueabihf
#
# Cross builds expect the Debian multiarch toolchain for the target
# (crossbuild-essential-<arch>, libasound2-dev:<arch>, libudev-dev:<arch>) and
# the usual cargo cross environment (CARGO_TARGET_<T>_LINKER, CC_<t>,
# PKG_CONFIG_ALLOW_CROSS=1, PKG_CONFIG_PATH_<t>); armhf additionally needs
# CFLAGS_<t>="-mfpu=neon-vfpv4 -mfloat-abi=hard" for libopus' NEON code. See
# .github/workflows/headless-client-release.yml for the exact settings.
#
# The version is resolved like every other Talktome build: TALKTOME_BUILD_VERSION
# (set by CI from scripts/resolve-build-version.js) or the nearest Git tag.
# Debian versions use "~" for development builds so they sort before the
# release: 1.2.5-dev.3 -> 1.2.5~dev.3+g<sha>.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
TARGET="${1:-}"

resolve_version() {
    if [[ -n "${TALKTOME_BUILD_VERSION:-}" ]]; then
        printf '%s\n' "${TALKTOME_BUILD_VERSION#v}"
        return
    fi
    if command -v node >/dev/null 2>&1 && [[ -f "$REPO/scripts/resolve-build-version.js" ]]; then
        local resolved
        if resolved="$(node "$REPO/scripts/resolve-build-version.js" --json 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin)["appVersion"])' 2>/dev/null)" && [[ -n "$resolved" ]]; then
            printf '%s\n' "$resolved"
            return
        fi
    fi
    local base distance dirty
    base="$(git -C "$REPO" describe --tags --match 'v[0-9]*' --abbrev=0 HEAD 2>/dev/null || echo v0.0.0)"
    distance="$(git -C "$REPO" rev-list --count "${base}..HEAD" 2>/dev/null || echo 0)"
    dirty=""
    if [[ -n "$(git -C "$REPO" status --porcelain --untracked-files=no 2>/dev/null)" ]]; then dirty=".dirty"; fi
    if [[ "$distance" == "0" && -z "$dirty" ]]; then
        printf '%s\n' "${base#v}"
    else
        printf '%s-dev.%s%s\n' "${base#v}" "$distance" "$dirty"
    fi
}

debian_version() {
    local app="$1" sha
    sha="$(git -C "$REPO" rev-parse --short=8 HEAD 2>/dev/null || echo unknown)"
    if [[ "$app" == *-* ]]; then
        printf '%s+g%s\n' "${app/-/\~}" "$sha"
    else
        printf '%s\n' "$app"
    fi
}

APP_VERSION="$(resolve_version)"
DEB_VERSION="$(debian_version "$APP_VERSION")"
export TALKTOME_BUILD_VERSION="$APP_VERSION"

echo "Building talktome-headless ${APP_VERSION} (deb ${DEB_VERSION}) ${TARGET:+for $TARGET}"
cd "$HERE"

if ! command -v cargo-deb >/dev/null 2>&1; then
    echo "cargo-deb is not installed: cargo install cargo-deb" >&2
    exit 1
fi

ARGS=(--locked --deb-version "$DEB_VERSION" --no-strip)
if [[ -n "$TARGET" ]]; then
    ARGS+=(--target "$TARGET")
fi
cargo deb "${ARGS[@]}"
