# 3. Netlify (Frontend hosten)

Das Frontend (React/Vite) wird als statische Seite auf Netlify deployed. Es
enthält sowohl den Eltern- als auch den Adminbereich (`/admin`).

## 3.1 Repository verbinden

1. Bei [netlify.com](https://www.netlify.com/) anmelden.
2. **Add new site → Import an existing project** → Git-Anbieter wählen → dieses
   Repository auswählen.

## 3.2 Build-Einstellungen

Die Datei `frontend/netlify.toml` ist bereits vorbereitet. Wichtig ist nur, dass
das **Base directory** auf `frontend` zeigt. Netlify liest dann automatisch:

- **Base directory**: `frontend`
- **Build command**: `npm run build`
- **Publish directory**: `frontend/dist` (relativ: `dist`)

Falls Netlify die Werte nicht automatisch übernimmt, trage sie manuell so ein.

## 3.3 Umgebungsvariable setzen (sehr wichtig)

**Site configuration → Environment variables → Add a variable:**

| Key | Value |
|---|---|
| `VITE_API_BASE_URL` | `https://api.deinedomain.de` (deine Cloudflare-Tunnel-URL) |

> Diese Variable wird beim Build eingebacken. Wenn du sie änderst, musst du **neu
> deployen** (Trigger deploy → Clear cache and deploy site).

## 3.4 Deployen

**Deploys → Trigger deploy → Deploy site.** Nach dem Build erhältst du eine URL
wie `https://deine-app.netlify.app` (unter „Domain settings“ änderbar / eigene
Domain möglich).

## 3.5 Backend auf diese URL einstellen

Jetzt im **Backend** (`.env` auf dem QNAP) die Netlify-URL eintragen, damit CORS
und E-Mail-Links stimmen:

```ini
PUBLIC_APP_URL=https://deine-app.netlify.app
```

Backend neu starten:

```bash
docker compose up -d backend
```

Nutzt du eine **eigene Domain** in Netlify (z. B. `fotos.deinedomain.de`), trage
diese in `PUBLIC_APP_URL` ein. Mehrere erlaubte Origins (z. B. Preview-Deploys)
kannst du über `EXTRA_CORS_ORIGINS` (Komma-getrennt) ergänzen.

## 3.6 Cookies über zwei Domains (wichtig zu verstehen)

- Frontend läuft auf `*.netlify.app` (oder deiner Domain), die API auf
  `api.deinedomain.de`. Das sind unterschiedliche Domains.
- Damit die Sitzungs-Cookies funktionieren, sind im Backend gesetzt:
  `COOKIE_SECURE=true` und `COOKIE_SAMESITE=none`. Beide Seiten laufen über
  HTTPS (Netlify + Cloudflare) – das ist erfüllt.
- **Tipp für saubere First-Party-Cookies:** Lege Frontend und API unter dieselbe
  Hauptdomain, z. B. `fotos.deinedomain.de` (Netlify) und `api.deinedomain.de`
  (Cloudflare). Dann kannst du im Backend zusätzlich `COOKIE_DOMAIN=.deinedomain.de`
  setzen. Das ist optional, erhöht aber die Kompatibilität mit strengen
  Browser-Einstellungen (z. B. Safari ITP).

## 3.7 Test

1. `https://deine-app.netlify.app` öffnen → Startseite mit E-Mail-Eingabe.
2. `https://deine-app.netlify.app/admin` → Admin-Login.
3. Admin-Login testen (Benutzer/Passwort wie im Backend gesetzt).

Wenn der Login „Failed to fetch“ zeigt: meist falsche `VITE_API_BASE_URL`,
fehlendes HTTPS, oder `PUBLIC_APP_URL` im Backend passt nicht zur Netlify-URL
(CORS). Siehe [Betrieb / Troubleshooting](06-betrieb.md).

➡️ Weiter mit **[4. E-Mail / SMTP](04-email-smtp.md)**.
