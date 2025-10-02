# Talk To Me
A flexible intercom solution.

## Configuration
- Admin UI: `https://localhost:<PORT>/admin.html`

## Usage

### Starting the Server
By default, the server listens on **port 443**.  
You can override the port in three different ways:

1. **Environment variable (recommended)**
   ```bash
   PORT=8443 node server.js
   ```
   → Server available at `https://localhost:8443/`

2. **Command-line argument**
   ```bash
   node server.js 8080
   ```
   → Server available at `https://localhost:8080/`

3. **No port specified**
   ```bash
   node server.js
   ```
   → Server available at `https://localhost:443/`

### Accessing the Application
- Main app: `https://<IP-ADDRESS>:<PORT>/`
- Admin UI: `https://<IP-ADDRESS>:<PORT>/admin.html`

### Bonjour / mDNS Alias
- On the local network the server advertises `https://intercom.local:<PORT>` via mDNS.
- Override the advertised host with `MDNS_HOST=myalias.local node server.js`.
- Disable advertising entirely with `MDNS_HOST="" node server.js`.
- When possible the server starts an HTTP→HTTPS redirect listener on port 80 so `http://intercom.local` forwards to TLS. Change the redirect port via `HTTP_PORT=8080` or disable it with `HTTP_PORT=off`.

---

## Camera Tally / HTTP API

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

You can trigger a user's talk buttons via HTTP:

- **URL:** `https://<IP-ADDRESS>:<PORT>/users/<USER_ID>/talk`
- **Method:** `POST`
- **Headers:** `Content-Type: application/json`

### Request Body
```json
{
  "action": "press",          // required: "press" or "release"
  "targetType": "global",     // optional: "global" (default), "user", "conference"
  "targetId": 12,              // optional: required when targetType is "user" or "conference", otherwise "null"
  "mode": "all"               // optional for global: "list" (default), "all", "hold"
}
```

### Examples
- Press the `ALL` button for user ID 8:
  ```bash
  curl -X POST https://localhost/users/8/talk \
       -H "Content-Type: application/json" \
       -d '{"action":"press","targetType":"global","mode":"all"}'
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

---

## Notes
- For local development you can choose any high port (e.g. 3000, 8080, 8443).  
- On Linux/macOS, binding to **port 443** requires elevated privileges (`sudo`) or capabilities (`setcap`).  
- For production, using a reverse proxy like **Nginx** or **Caddy** in front of Node.js is recommended.
