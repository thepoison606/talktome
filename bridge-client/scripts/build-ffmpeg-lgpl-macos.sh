#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

FFMPEG_VERSION="${FFMPEG_VERSION:-8.1.2}"
OPUS_VERSION="${OPUS_VERSION:-1.6.1}"
FFMPEG_SHA256="${FFMPEG_SOURCE_SHA256:-464beb5e7bf0c311e68b45ae2f04e9cc2af88851abb4082231742a74d97b524c}"
OPUS_SHA256="${OPUS_SOURCE_SHA256:-6ffcb593207be92584df15b32466ed64bbec99109f007c82205f0194572411a1}"
TARGET_TRIPLE="${TAURI_TARGET_TRIPLE:-}"
RELEASE_MODE=0

for arg in "$@"; do
  case "$arg" in
    --release)
      RELEASE_MODE=1
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      exit 2
      ;;
  esac
done

if [[ "${CI:-}" == "true" ]]; then
  RELEASE_MODE=1
fi

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This script currently builds FFmpeg only on macOS." >&2
  exit 1
fi

if [[ -z "$TARGET_TRIPLE" ]]; then
  case "$(uname -m)" in
    arm64)
      TARGET_TRIPLE="aarch64-apple-darwin"
      ;;
    x86_64)
      TARGET_TRIPLE="x86_64-apple-darwin"
      ;;
    *)
      echo "Unsupported macOS architecture: $(uname -m)" >&2
      exit 1
      ;;
  esac
fi

BUILD_ROOT="${FFMPEG_BUILD_ROOT:-$PROJECT_ROOT/.ffmpeg-build/$TARGET_TRIPLE}"
DOWNLOAD_DIR="$BUILD_ROOT/downloads"
PREFIX="$BUILD_ROOT/prefix"
OUTPUT_DIR="${FFMPEG_OUTPUT_DIR:-$PROJECT_ROOT/.ffmpeg-sidecars}"
OUTPUT="$OUTPUT_DIR/ffmpeg-$TARGET_TRIPLE"
JOBS="${JOBS:-$(sysctl -n hw.logicalcpu)}"

mkdir -p "$DOWNLOAD_DIR" "$PREFIX" "$OUTPUT_DIR"

download() {
  local url="$1"
  local output="$2"
  if [[ -f "$output" ]]; then
    return
  fi
  curl -fL --retry 3 --retry-delay 2 "$url" -o "$output"
}

verify_sha256() {
  local file="$1"
  local expected="$2"
  local label="$3"
  local actual
  actual="$(shasum -a 256 "$file" | awk '{print $1}')"
  if [[ -z "$expected" ]]; then
    echo "$label SHA256: $actual"
    if [[ "$RELEASE_MODE" == "1" ]]; then
      echo "$label SHA256 must be configured for release builds." >&2
      exit 1
    fi
    return
  fi
  if [[ "$actual" != "$expected" ]]; then
    echo "$label SHA256 mismatch. Expected $expected, got $actual." >&2
    exit 1
  fi
}

OPUS_ARCHIVE="$DOWNLOAD_DIR/opus-$OPUS_VERSION.tar.gz"
FFMPEG_ARCHIVE="$DOWNLOAD_DIR/ffmpeg-$FFMPEG_VERSION.tar.xz"

download "https://downloads.xiph.org/releases/opus/opus-$OPUS_VERSION.tar.gz" "$OPUS_ARCHIVE"
download "https://ffmpeg.org/releases/ffmpeg-$FFMPEG_VERSION.tar.xz" "$FFMPEG_ARCHIVE"
verify_sha256 "$OPUS_ARCHIVE" "$OPUS_SHA256" "Opus source"
verify_sha256 "$FFMPEG_ARCHIVE" "$FFMPEG_SHA256" "FFmpeg source"

rm -rf "$PREFIX" "$BUILD_ROOT/opus-$OPUS_VERSION" "$BUILD_ROOT/ffmpeg-$FFMPEG_VERSION"
mkdir -p "$PREFIX"
tar -xzf "$OPUS_ARCHIVE" -C "$BUILD_ROOT"
tar -xJf "$FFMPEG_ARCHIVE" -C "$BUILD_ROOT"

(
  cd "$BUILD_ROOT/opus-$OPUS_VERSION"
  ./configure \
    --prefix="$PREFIX" \
    --disable-shared \
    --enable-static \
    --disable-doc \
    --disable-extra-programs
  make -j"$JOBS"
  make install
)

(
  cd "$BUILD_ROOT/ffmpeg-$FFMPEG_VERSION"
  PKG_CONFIG_PATH="$PREFIX/lib/pkgconfig" ./configure \
    --prefix="$PREFIX" \
    --pkg-config-flags="--static" \
    --extra-cflags="-I$PREFIX/include" \
    --extra-ldflags="-L$PREFIX/lib" \
    --extra-libs="-lm" \
    --enable-static \
    --disable-shared \
    --disable-autodetect \
    --disable-everything \
    --disable-doc \
    --disable-debug \
    --disable-ffplay \
    --disable-ffprobe \
    --disable-gpl \
    --disable-nonfree \
    --enable-libopus \
    --enable-protocol=file,pipe,rtp,udp \
    --enable-demuxer=pcm_f32le,rtp,sdp \
    --enable-muxer=pcm_f32le,rtp \
    --enable-decoder=libopus,opus,pcm_f32le \
    --enable-encoder=libopus,pcm_f32le \
    --enable-parser=opus \
    --enable-filter=aformat,aresample,anull,volume
  make -j"$JOBS" ffmpeg
)

cp "$BUILD_ROOT/ffmpeg-$FFMPEG_VERSION/ffmpeg" "$OUTPUT"
chmod 755 "$OUTPUT"

"$OUTPUT" -hide_banner -encoders | grep -q 'libopus'
if "$OUTPUT" -version | grep -q -- '--enable-gpl'; then
  echo "Built FFmpeg unexpectedly contains --enable-gpl." >&2
  exit 1
fi

echo "Built LGPL FFmpeg sidecar candidate: $OUTPUT"
echo "Binary SHA256: $(shasum -a 256 "$OUTPUT" | awk '{print $1}')"
