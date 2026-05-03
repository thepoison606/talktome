# Talk To Me

Local WebRTC intercom app built with Node.js, mediasoup and Socket.IO.

<img src="public/images/iphone_ipad.png" alt="Talk To Me mobile UI" width="800">

## Features

- Browser-based intercom with direct targets, conferences, reply, talk lock and keyboard shortcuts.
- Admin UI for users, feeds, conferences, target order, network config, RTC port range, backups and Guest login.
- Optional program-audio feeds with volume and mute controls.
- Camera tally and remote control through HTTP API and the Bitfocus Companion module.
- Optional passwordless Guest login with shared Guest targets.

## Quick Start

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

## Admin

First boot creates a superadmin user:

- Username: `admin`
- Password: `admin`

The first admin login at `/admin` forces a password change. Admin sessions use an httpOnly `admin_session` cookie.

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
