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

## Notes
- For local development you can choose any high port (e.g. 3000, 8080, 8443).  
- On Linux/macOS, binding to **port 443** requires elevated privileges (`sudo`) or capabilities (`setcap`).  
- For production, using a reverse proxy like **Nginx** or **Caddy** in front of Node.js is recommended.
