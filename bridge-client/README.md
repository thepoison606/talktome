# Talk To Me Bridge Client

This is the first native bridge-client spike for routing Talk To Me audio to
local multichannel audio interfaces such as Dante Virtual Soundcard.

The current bridge path includes:

- Tauri/Rust desktop app shell for macOS and Windows.
- Native audio device enumeration through CPAL.
- Native F32/48 kHz stream probe for a selected input channel pair.
- Optional local loopback from selected input pair to selected output pair.
- Multiple local bridge-port rows with independent native streams.
- Server registration and automatic loading of Admin bridge assignments.
- One managed headless user session per configured bridge endpoint.
- Native CPAL input/output on the exact configured channel pairs.
- Opus/RTP transport to and from mediasoup through the server's plain RTP API.
- Companion press, release and lock commands for managed bridge users.
- Bundled FFmpeg sidecar support for Opus encoding/decoding.

FFmpeg is used only for Opus encoding/decoding; audio device and channel access
remain native through CPAL. Packaged builds use a platform-specific FFmpeg
sidecar. Development builds can also use `ffmpeg` from `PATH` or an explicit
binary path via `TALKTOME_FFMPEG`.

## Development

Install a Rust toolchain and Node.js dependencies, then run:

```bash
cd bridge-client
npm install
npm run dev
```

The app lists input/output devices, supported stream configs, max channel
counts, 48 kHz availability and possible stereo channel pairs. After Server URL,
API key and Bridge name are configured, `Announce` loads all bridge endpoints
assigned to this bridge and starts them automatically. The manual stream probe
remains available as a collapsed diagnostic tool.

Useful checks:

```bash
npm run build:ui
npm run prepare:ffmpeg -- --optional
npm run build:ffmpeg:macos
npm run build:ffmpeg:windows # requires an MSYS2 MinGW shell
npm run build:release
cd src-tauri
cargo check
```

## FFmpeg Sidecar

The Tauri bundle expects the FFmpeg binary under `src-tauri/binaries` using the
target-specific sidecar name, for example:

- `ffmpeg-aarch64-apple-darwin`
- `ffmpeg-x86_64-apple-darwin`
- `ffmpeg-x86_64-pc-windows-msvc.exe`

`npm run build` runs `npm run prepare:ffmpeg` first. The prepare script copies
the binary from `FFMPEG_SIDECAR_SOURCE`, `TALKTOME_FFMPEG` or the first `ffmpeg`
found on `PATH`.

For release builds, use:

```bash
FFMPEG_SIDECAR_URL=https://example.invalid/ffmpeg-portable.zip \
FFMPEG_SIDECAR_ARCHIVE_SHA256=<expected-archive-sha256> \
FFMPEG_SIDECAR_SHA256=<expected-ffmpeg-binary-sha256> \
npm run build:release
```

To evaluate a candidate URL and print the exact hashes without copying it into
the Tauri sidecar directory, run:

```bash
FFMPEG_SIDECAR_URL=https://example.invalid/ffmpeg-portable.zip \
npm run prepare:ffmpeg -- --discover --force
```

`FFMPEG_SIDECAR_URL` can point to a direct binary, `.zip`, `.tar`, `.tar.gz`,
`.tgz`, `.tar.xz` or `.txz` archive. The script extracts the archive and uses
the first `ffmpeg`/`ffmpeg.exe` binary it finds. `FFMPEG_SIDECAR_SOURCE` can
still point to an already downloaded binary.

Target-specific variables override the generic ones, which is useful in CI:

- `FFMPEG_SIDECAR_URL_AARCH64_APPLE_DARWIN`
- `FFMPEG_SIDECAR_ARCHIVE_SHA256_AARCH64_APPLE_DARWIN`
- `FFMPEG_SIDECAR_SHA256_AARCH64_APPLE_DARWIN`
- `FFMPEG_SIDECAR_URL_X86_64_PC_WINDOWS_MSVC`
- `FFMPEG_SIDECAR_ARCHIVE_SHA256_X86_64_PC_WINDOWS_MSVC`
- `FFMPEG_SIDECAR_SHA256_X86_64_PC_WINDOWS_MSVC`

The `Bridge Client Builds` GitHub workflow builds minimal LGPL/libopus FFmpeg
sidecars from pinned source tarballs for macOS arm64 and Windows x64. No
prebuilt FFmpeg binary is downloaded for releases by default.

The source builds use official source archives by default:

- FFmpeg `8.1.2`,
  SHA256 `464beb5e7bf0c311e68b45ae2f04e9cc2af88851abb4082231742a74d97b524c`
- Opus `1.6.1`,
  SHA256 `6ffcb593207be92584df15b32466ed64bbec99109f007c82205f0194572411a1`

`build:release` refuses a PATH-only FFmpeg and validates that the binary exposes
the `libopus` encoder. It also fails when the binary looks unsuitable for
redistribution, for example when it links against Homebrew libraries or was
built with `--enable-gpl`. A Homebrew FFmpeg binary is useful for local
development, but it can depend on dynamic libraries that are not present on
other Macs.

The Windows source build must run inside an MSYS2 MinGW shell. The GitHub
workflow installs that toolchain automatically.

If a non-portable or GPL-enabled binary is intentionally used for a private test,
set `ALLOW_NON_PORTABLE_FFMPEG=1` explicitly.

## Next Milestones

1. Verify Dante Virtual Soundcard on macOS and Windows.
2. Decide whether parallel native streams are good enough or whether one shared
   stream per device is required.
3. Add per-return-path gain/mute handling for Companion volume commands.
4. Add device-reconnect recovery and long-running soak tests.
5. Add signed Bridge installer builds for macOS and Windows.
