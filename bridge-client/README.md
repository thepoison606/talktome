# Talk To Me Bridge Client

This is the first native bridge-client spike for routing Talk To Me audio to
local multichannel audio interfaces such as Dante Virtual Soundcard.

The current scope is intentionally small:

- Tauri/Rust desktop app shell for macOS and Windows.
- Native audio device enumeration through CPAL.
- Native F32/48 kHz stream probe for a selected input channel pair.
- Optional local loopback from selected input pair to selected output pair.
- Multiple local bridge-port rows with independent native streams.
- A local bridge-port model for future admin-provided routing.
- No WebRTC, mediasoup, server pairing, or live audio routing yet.

## Development

Install a Rust toolchain and Node.js dependencies, then run:

```bash
cd bridge-client
npm install
npm run dev
```

The app lists input/output devices, supported stream configs, max channel
counts, 48 kHz availability and possible stereo channel pairs. The stream
probe can open selected input pairs and display live RMS levels per local
bridge-port row. Each running row currently opens independent native input and
output streams, which is useful for testing whether a multichannel device allows
parallel port-style routing.

Useful checks:

```bash
npm run build:ui
cd src-tauri
cargo check
```

## Next Milestones

1. Verify Dante Virtual Soundcard on macOS and Windows.
2. Decide whether parallel native streams are good enough or whether one shared
   stream per device is required.
3. Add Bridge device pairing with the Talk To Me server.
4. Load bridge ports from Admin config.
5. Add WebRTC/mediasoup routing per bridge port.
