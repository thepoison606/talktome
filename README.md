# Talk To Me
Flexible Intercom-Solution

## Config
- Admin-UI: `https://localhost/admin.html`

## Use
- App aufrufen unter: `https://<IP-ADRESS>/`

## Tally-/HTTP-API
Send Tally-Information per **HTTP POST** to the Endpoint:

- **URL:** `https://<IP-ADRESS>/cut-camera`
- **Method:** `POST`
- **Header:** `Content-Type: application/json`
- **Body (JSON):**
  ```json
  {
    "user": "<USERNAME>"
  }