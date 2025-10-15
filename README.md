# Talk To Me
A flexible intercom solution built with node.js and mediasoup.

## Installation

### Prerequisites
- **Node.js 18+** (with `npm`) – mediasoup uses native addons that are built during install.
- **Build toolchain** for mediasoup (`python3`, `make`, `gcc/g++`, etc.).  
  - macOS: `xcode-select --install`
  - Debian/Ubuntu: `sudo apt install build-essential python3 make`

### Setup
```bash
git clone https://github.com/thepoison606/talktome.git
cd talktome
npm install
```

Once dependencies are installed, start the server as described below.

## Usage

### Starting the Server
By default, the server listens on **port 443**. Start it with: 

   ```bash
   node server.js
   ```
   → Server available at `https://localhost:443/`

You can override the port in two different ways:

1. **Environment variable**
   ```bash
   PORT=8443 node server.js
   ```
   → Server available at `https://localhost:8443/`

2. **Command-line argument**
   ```bash
   node server.js 8080
   ```
   → Server available at `https://localhost:8080/`


### Accessing the Application

- Admin UI: `https://<IP-ADDRESS>:<PORT>/admin.html`
- Main app: `https://<IP-ADDRESS>:<PORT>/`
- On first visit, acknowledge the browser warning about the self-signed connection so the page can load.

### Push‑to‑Talk (PTT)
- Hold the Space bar to talk to the currently selected target (the Reply button becomes active while Space is held).
- Release the Space bar to stop talking.
- The keyboard shortcut is ignored while typing in input fields and when a Talk‑Lock is active.

### Feeds
- Manage feeds via the **Feeds** card in the admin panel; they can be assigned to users as targets just like conferences or users.
- A feed account logs in through the same page as operators but only sees the audio-input selector and a start/stop button. No audio processing (AGC, noise suppression, echo cancel) is applied to feed streams.
- Operators see feeds as a third target category with volume sliders and mute controls. Feed tiles automatically dim when other sources speak, but cannot be used as talk targets.

### Bonjour / mDNS Alias
- On the local network the server advertises `https://intercom.local:<PORT>` via mDNS.
- Override the advertised host with `MDNS_HOST=myalias.local node server.js`.
- Disable advertising entirely with `MDNS_HOST="" node server.js`.
- When possible the server starts an HTTP→HTTPS redirect listener on port 80 so `http://intercom.local` forwards to TLS. Change the redirect port via `HTTP_PORT=8080` or disable it with `HTTP_PORT=off`.

---

## Camera Tally

You can send tally information to the server using **HTTP POST** requests. The Website background of the user will be red if their camera is cut.

- **URL:**  
  `https://<IP-ADDRESS>:<PORT>/cut-camera`

- **Method:**  
  `POST`

- **Headers:**  
  `Content-Type: application/json`

- **Body (JSON):**
  ```json
  {
    "user": "<USERNAME>"
  }
  ```

---

## Remote Talk Control API

Trigger a user’s talk buttons over HTTP for example to use control panels such as Elgato Stream Deck (via Bitfocus Companion).

> Note: Simultaneous talk into multiple destinations is not supported yet.

- **URL:** `https://<IP-ADDRESS>:<PORT>/users/<USER_ID>/talk`
- **Method:** `POST`
- **Headers:** `Content-Type: application/json`

### Request Body
```json
{
  "action": "press",          // required: "press", "release", or "lock-toggle"
  "targetType": "conference",  // optional: "conference" (default), "user", or "reply"
  "targetId": 12               // required
}
```

### Examples
- Hold-to-talk on current Reply target (no targetId required):
  ```bash
  curl -X POST https://localhost/users/8/talk \
       -H "Content-Type: application/json" \
       -d '{"action":"press","targetType":"reply"}'
  ```

- Talk to user with ID 8:
  ```bash
  curl -X POST https://localhost/users/8/talk \
       -H "Content-Type: application/json" \
       -d '{"action":"press","targetType":"conference","targetId":12}'
  ```

- Release (stop talking):
  ```bash
  curl -X POST https://localhost/users/8/talk \
       -H "Content-Type: application/json" \
       -d '{"action":"release"}'
  ```

- Talk to conference ID 3:
  ```bash
  curl -X POST https://localhost/users/8/talk \
       -H "Content-Type: application/json" \
       -d '{"action":"press","targetType":"conference","targetId":3}'
  ```

- Toggle talk lock for conference ID 3 (behaves like clicking Talk Lock in the UI):
  ```bash
  curl -X POST https://localhost/users/8/talk \
       -H "Content-Type: application/json" \
       -d '{"action":"lock-toggle","targetType":"conference","targetId":3}'
  ```

---

## Notes
- For local development you can choose any high port (e.g. 3000, 8080, 8443).  
- On Linux/macOS, binding to **port 443** requires elevated privileges (`sudo`) or capabilities (`setcap`).  
- For production, using a reverse proxy like **Nginx** or **Caddy** in front of Node.js is recommended.
