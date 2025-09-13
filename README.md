# Talk To Me
Flexible Intercom-Lösung

## Konfiguration
- Admin-UI: `https://localhost/admin.html`

## Nutzung
- App aufrufen unter: `https://<IP-ADRESSE>/`

## Tally-/HTTP-API
Sende Tally-Informationen per **HTTP POST** an den Endpunkt:

- **URL:** `https://<IP-ADRESSE>/cut-camera`
- **Methode:** `POST`
- **Header:** `Content-Type: application/json`
- **Body (JSON):**
  ```json
  {
    "user": "<BENUTZERNAME>"
  }
