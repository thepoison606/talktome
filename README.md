# Talk To Me
Intercom / talkback app built with Node.js and mediasoup for low-latency audio.

## What it does
- Web client with per-target talk buttons, reply, and “talk lock”.
- Admin UI to manage users, conferences, feeds, and target order.
- Feed accounts for program audio injection (no AGC/NS/EC applied).
- mDNS advertising (`intercom.local`), optional HTTP→HTTPS redirect, self-signed TLS generation.
- HTTP hooks for camera tally and remote talk control.

## Quick start
Prerequisites: **Node.js 18+** (with `npm`) and a build toolchain for mediasoup (`python3`, `make`, `gcc/g++`, …).
- macOS: `xcode-select --install`
- Debian/Ubuntu: `sudo apt install build-essential python3 make`

Setup:
```bash
git clone https://github.com/thepoison606/talktome.git
cd talktome
npm install
node server.js            # defaults to 443
```
Visit `https://localhost:443/` (accept the self-signed cert warning) or `https://<IP>:<PORT>/`.
- Main client: `/`
- Admin UI: `/admin.html`

Ports:
- Override with `PORT=8443 node server.js` (or `HTTPS_PORT`) or `node server.js 8080`.
- HTTP redirect listener defaults to port 80 when mDNS is on; change via `HTTP_PORT=8080` or disable with `HTTP_PORT=off`.
- mDNS hostname defaults to `intercom.local`; override with `MDNS_HOST=myalias.local`.

TLS:
- If `certs/key.pem` and `certs/cert.pem` are missing, the server generates a self-signed pair in `./certs`.

Data:
- All state lives in `app.db` (SQLite). Back it up before upgrades if you need to preserve accounts and routing.

## Admin accounts & passwords
- On first boot, a superadmin `admin` user is auto-created with password `admin` and the flag `admin_must_change=1`.
- First admin login happens at `/admin.html`; the UI enforces a password change before access is granted.
- Admin sessions are stored as an httpOnly cookie (`admin_session`) with a 12h TTL.
- Superadmins cannot be demoted; admin accounts cannot be deleted.
- Create additional admins in the Admin UI; they share the same login page as operators.

## Using the app
- Operators and feeds log in on `/`.
- Admins use `/admin.html` to create users/conferences/feeds and assign talk targets.
- Feeds appear as a third target category with volume sliders and mute controls; they cannot be used as talk targets.

## Camera tally
Post when a user’s camera is on-air; their UI background turns red.
- **URL:** `https://<IP-ADDRESS>:<PORT>/cut-camera`
- **Method:** `POST`
- **Headers:** `Content-Type: application/json`
- **Body:**
  ```json
  { "user": "<USERNAME>" }
  ```

## Remote talk control API
Trigger a user’s talk buttons over HTTP (e.g. Stream Deck via Companion).
> Simultaneous talk into multiple destinations is not supported yet.

- **URL:** `https://<IP-ADDRESS>:<PORT>/users/<USER_ID>/talk`
- **Method:** `POST`
- **Headers:** `Content-Type: application/json`

Body:
```json
{
  "action": "press",          // "press", "release", or "lock-toggle"
  "targetType": "conference", // "conference" (default), "user", or "reply"
  "targetId": 12              // required unless targetType is "reply"
}
```

Examples:
- Talk to conference ID 3:
  ```bash
  curl -X POST https://localhost/users/8/talk \
       -H "Content-Type: application/json" \
       -d '{"action":"press","targetType":"conference","targetId":3}'
  ```
- Talk to user ID 8:
  ```bash
  curl -X POST https://localhost/users/8/talk \
       -H "Content-Type: application/json" \
       -d '{"action":"press","targetType":"user","targetId":8}'
  ```
- Release (stop talking):
  ```bash
  curl -X POST https://localhost/users/8/talk \
       -H "Content-Type: application/json" \
       -d '{"action":"release"}'
  ```
- Hold-to-talk on Reply:
  ```bash
  curl -X POST https://localhost/users/8/talk \
       -H "Content-Type: application/json" \
       -d '{"action":"press","targetType":"reply"}'
  ```

Notes:
- Space bar: hold-to-talk on the selected Reply target.
- If no Reply target is selected in the UI, `targetType: "reply"` is ignored by the client.
