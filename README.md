# Talk To Me

Local WebRTC intercom app built with Node.js, mediasoup and Socket.IO.

<img src="public/images/iphone_ipad.png" alt="Talk To Me mobile UI" width="800">

## Features

- Browser-based intercom with direct targets, conferences, reply and talk lock.
- Admin UI for users, feeds, conferences, target order, network config, RTC port range, backups and Guest login.
- Optional program-audio feeds with volume and mute controls.
- Camera tally and remote control through HTTP API.
- Remote control via Bitfocus Companion module and keyboard shortcuts.

## Quick Start

Choose one way to run Talk To Me:

- **macOS / Windows release:** easiest local install for a dedicated intercom computer -> [GitHub Releases page](https://github.com/thepoison606/talktome/releases).
- **Docker:** best for a small server, NAS, mini PC, or always-on host.
- **Source:** for development.

### First Start

1. Start Talk To Me and open the shown HTTPS URL, usually `https://<HOST-IP>:8443/`.
2. Accept the browser warning for the self-signed local certificate.
3. Open `https://<HOST-IP>:8443/admin`.
4. Log in with the initial admin account:
   - Username: `admin`
   - Password: `admin`
5. Change the admin password when prompted.
6. In Admin, create users, feeds and conferences, then assign targets to the users who should talk to each other.
7. Operators log in at `/` with their user credentials and allow microphone access.

If clients can open the page but audio does not connect, check Admin `Config`,
the announced media address and the RTC port range/firewall rules.

### Docker

Replace `<HOST-IP>` with the LAN address clients use to reach this host.

Host networking:
```bash
docker pull thepoison606/talktome:latest
docker run -d --restart unless-stopped --name talktome \
  --network host \
  -e PUBLIC_IP=<HOST-IP> \
  -v talktome_data:/data \
  thepoison606/talktome:latest
```

Explicit port publishing:
```bash
docker run -d --restart unless-stopped --name talktome \
  -e PUBLIC_IP=<HOST-IP> \
  -p 8443:8443 -p 8080:8080 \
  -p 40000-49999:40000-49999/udp \
  -p 40000-49999:40000-49999/tcp \
  -v talktome_data:/data \
  thepoison606/talktome:latest
```

Open `https://<HOST-IP>:8443/`. Allow the HTTPS port and the configured RTC port range in your firewall.

### Source

Requirements: Node.js 18+ and a build toolchain for mediasoup.

```bash
git clone https://github.com/thepoison606/talktome.git
cd talktome
npm install
node server.js
```

Open `https://localhost/` or `https://<IP>:<PORT>/` and accept the self-signed certificate warning.

## Configuration

On first interactive start, Talk To Me creates `config.json` and asks for:

- HTTPS port
- mDNS hostname, or `off`
- RTC port range: start port and number of ports
- WebRTC media network mode: automatic, preferred adapter, or manual announced IP/hostname

The same settings can be changed later in Admin `Config`.

Useful environment overrides:

- `PORT` / `HTTPS_PORT`: HTTPS UI port
- `HTTP_PORT`: redirect port, or `off`
- `PUBLIC_IP`: manual WebRTC announced address
- `MDNS_HOST`: mDNS hostname, or `off`
- `TALKTOME_MEDIA_INTERFACE`: preferred network adapter
- `TALKTOME_RTC_PORT_START` and `TALKTOME_RTC_PORT_COUNT`: RTC range override
- `TALKTOME_DATA_DIR`: data directory override
- `COMPANION_API_KEY`: fixed Companion/API key

Changing the media network or RTC port range requires a server restart. Guest login changes apply immediately.

## Data

State is stored in SQLite `app.db`; config, certificates and generated API keys live in the same app data directory.

- macOS: `~/Library/Application Support/talktome`
- Windows: `%LOCALAPPDATA%\talktome`
- Linux: `$XDG_DATA_HOME/talktome` or `~/.local/share/talktome`
- Override: `TALKTOME_DATA_DIR=/path/to/data`

Back up this directory before upgrades if you need to preserve accounts and routing.


## Users, Feeds And Guests

- Operators log in at `/` and can talk to assigned users/conferences.
- Feeds log in at `/`, publish their assigned feed, and cannot talk back.
- Guests are enabled in Admin `Config`.
- All Guests share the targets and conference memberships of the generated `Guest` profile.
- Guest profiles cannot be direct targets, admins, deleted, or password-reset.
- Online Guests can still be answered through `Reply`.
- Guest login is passwordless and stored only in browser `sessionStorage`, so page refresh keeps it, but closing the browser session clears it.

## Companion And HTTP API

Companion module source is maintained separately:
`https://github.com/bitfocus/companion-module-talktome-intercom.git`

Auth:

- API key via `x-api-key: <KEY>` or `Authorization: Bearer <KEY>`
- User-scoped token via `POST /api/v1/companion/auth/login`

Main endpoints:

- `GET /api/v1/companion/config`
- `GET /api/v1/companion/state`
- `GET /api/v1/companion/users`
- `GET /api/v1/companion/conferences`
- `GET /api/v1/companion/feeds`
- `GET /api/v1/companion/users/:id/targets`
- `POST /api/v1/companion/users/:id/talk`
- `POST /api/v1/companion/users/:id/target-audio`
- Legacy: `POST /users/:id/talk`

Socket.IO namespace: `/companion` with `snapshot`, `user-state`, `command-result`, and `cut-camera` events.

Guest profiles are intentionally hidden from Companion and cannot be controlled as direct targets.

## Camera Tally

```bash
curl -X POST https://<IP>:<PORT>/cut-camera \
  -H "Content-Type: application/json" \
  -d '{"user":"<USERNAME>"}'
```

The matching user UI turns red while on-air.

## Shortcuts

- `Space`: Reply
- Number keys: talk to targets in list order

## Native Bridge Client Prototype

`bridge-client/` contains an experimental Tauri/Rust desktop spike for Dante and other multichannel audio interfaces on macOS and Windows.

Current scope:

- native input/output device enumeration through CPAL
- supported stream configs, max channel counts, 48 kHz availability and stereo channel-pair detection
- F32/48 kHz input stream probe with live RMS levels
- multiple local bridge-port rows with loopback from selected input pairs to selected output pairs
- a bridge-port status/model shape for future Admin-provided routing

It does not yet connect to the Talk To Me server, WebRTC/mediasoup, or admin-provided routing. See `bridge-client/README.md` for local development commands and next milestones.

## Radio Gateway Prototype

The repository includes a generic hardware gateway helper for bridging Talk To Me to an external radio or intercom device. It expects a Linux gateway host with ALSA audio I/O, an audio interface connected to the external device, and an optional GPIO-controlled PTT circuit.

The helper can control PTT through `pinctrl`, monitor receive audio level, and stream bidirectional audio between the external device and a Talk To Me conference.

Commands:

```bash
npm run radio:ptt -- 2
npm run radio:play -- test.wav
npm run radio:monitor
npm run radio:record
npm run radio:calibrate
TALKTOME_SERVER_URL=https://<SERVER-IP>:8443 TALKTOME_GATEWAY_USER_ID=<USER-ID> TALKTOME_GATEWAY_CONFERENCE_ID=<CONFERENCE-ID> npm run radio:stream
```

Run `npm run radio:calibrate` on the gateway host to measure idle noise, remote PTT without speech, and quiet speech. It writes `gateway/radio-config.json`; environment variables still override that file.

Defaults can be configured in `gateway/radio-config.json` or overridden with environment variables:

```bash
TALKTOME_RADIO_CONFIG=gateway/radio-config.json
TALKTOME_RADIO_GPIO=17
TALKTOME_RADIO_AUDIO_DEVICE=plughw:CARD=CODEC,DEV=0
TALKTOME_RADIO_RX_ON_THRESHOLD=0.002
TALKTOME_RADIO_RX_OFF_THRESHOLD=0.003
TALKTOME_RADIO_RX_HANG_MS=600
TALKTOME_RADIO_RX_PRE_ROLL_MS=500
TALKTOME_RADIO_RX_RESUME_LEAD_MS=150
TALKTOME_RADIO_RX_WARMUP_MS=500
TALKTOME_RADIO_RX_GAIN_DB=6
TALKTOME_RADIO_TX_ENABLED=true
TALKTOME_RADIO_TX_RTP_IP=<auto-detected-gateway-ip>
TALKTOME_RADIO_TX_RTP_PORT=5006
TALKTOME_RADIO_TX_GAIN_DB=0
TALKTOME_RADIO_RX_SEGMENTS_DIR=gateway/rx-segments
TALKTOME_SERVER_URL=https://talktome.local:8443
TALKTOME_GATEWAY_USER_ID=1
TALKTOME_GATEWAY_CONFERENCE_ID=1
TALKTOME_GATEWAY_NAME=Radio Gateway
```

Sync gateway changes from a development machine to a gateway host without pushing to GitHub:

```bash
TALKTOME_GATEWAY_HOST=user@gateway-host.local npm run gateway:sync
```
