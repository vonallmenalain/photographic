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
| `VITE_API_BASE_URL` | `https://api.alae.app` (deine Cloudflare-Tunnel-URL) |
| `VITE_FIREBASE_API_KEY` | aus der Firebase Web-Config |
| `VITE_FIREBASE_AUTH_DOMAIN` | `photographic-7ba68.firebaseapp.com` |
| `VITE_FIREBASE_PROJECT_ID` | `photographic-7ba68` |
| `VITE_FIREBASE_STORAGE_BUCKET` | `photographic-7ba68.firebasestorage.app` |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | `83987903614` |
| `VITE_FIREBASE_APP_ID` | aus der Firebase Web-Config |

> Diese Variablen werden beim Build eingebacken. Wenn du sie änderst, musst du
> **neu deployen** (Trigger deploy → Clear cache and deploy site).
>
> **Wichtig (Firebase Authentication):** Trage **`photographic.alae.app`** UND
> **`creartphotographic.netlify.app`** in der Firebase Console unter
> **Authentication → Settings → Authorized domains** ein, und aktiviere unter
> **Authentication → Sign-in method** den Anbieter **„E-Mail/Passwort“** inkl.
> **„E-Mail-Link (passwortlose Anmeldung)“**. Details: [docs/08-firebase.md](08-firebase.md).

## 3.4 Eigene Domain (photographic.alae.app)

Diese App nutzt die Netlify-Site **`creartphotographic.netlify.app`** mit der
eigenen Domain **`photographic.alae.app`**.

1. **Site configuration → Domain management → Add a domain** → `photographic.alae.app`.
2. Im DNS deiner Domain `alae.app` einen **CNAME** `photographic` auf
   `creartphotographic.netlify.app` setzen (oder Netlify-DNS verwenden).
3. Netlify stellt automatisch ein **HTTPS-Zertifikat** aus (Let’s Encrypt).
4. Optional: `photographic.alae.app` als **Primary domain** festlegen, damit Aufrufe der
   `*.netlify.app`-Adresse dorthin umgeleitet werden.

> Beide Adressen bleiben erreichbar. Deshalb ist `creartphotographic.netlify.app`
> sowohl in den Firebase „Authorized domains“ als auch in `EXTRA_CORS_ORIGINS`
> hinterlegt – falls jemand die rohe Netlify-URL öffnet, funktioniert alles trotzdem.

## 3.5 Deployen

**Deploys → Trigger deploy → Deploy site.** Nach dem Build ist die App unter
`https://photographic.alae.app` (und `https://creartphotographic.netlify.app`) erreichbar.

## 3.6 Backend auf diese Domain einstellen

Im **Backend** (`.env` auf dem QNAP) die App-Domain eintragen, damit CORS und
E-Mail-/Bestätigungslinks stimmen:

```ini
PUBLIC_APP_URL=https://photographic.alae.app
EXTRA_CORS_ORIGINS=https://creartphotographic.netlify.app
```

Backend neu starten:

```bash
docker compose up -d backend
```

## 3.7 Cookies (mit api.alae.app besonders einfach)

- **Empfohlen:** Betreibe die API auf **`api.alae.app`** (siehe Cloudflare-Doku).
  Dann liegen Frontend (`photographic.alae.app`) und API (`api.alae.app`) unter derselben
  Hauptdomain `alae.app` → das ist **„same-site“**. Im Backend genügt dann:

  ```ini
  COOKIE_SECURE=true
  COOKIE_SAMESITE=lax
  COOKIE_DOMAIN=.alae.app
  ```

  Das ergibt robuste First-Party-Cookies (auch mit Safari ITP).
- **Falls die API auf einer anderen Domain liegt** (echtes Cross-Site), nutze
  stattdessen `COOKIE_SAMESITE=none` und lass `COOKIE_DOMAIN` leer. Beide Seiten
  müssen über HTTPS laufen (Netlify + Cloudflare erfüllen das).

## 3.8 Test

1. `https://photographic.alae.app` öffnen → Startseite mit E-Mail-Eingabe.
2. `https://photographic.alae.app/admin` → Admin-Login.
3. Admin-Login testen (Benutzer/Passwort wie im Backend gesetzt).

Wenn der Login „Failed to fetch“ zeigt: meist falsche `VITE_API_BASE_URL`,
fehlendes HTTPS, oder `PUBLIC_APP_URL` im Backend passt nicht zu `photographic.alae.app`
(CORS). Zeigt Firebase `auth/unauthorized-continue-uri`, fehlt die Domain in den
**Authorized domains**. Siehe [Betrieb / Troubleshooting](06-betrieb.md).

➡️ Weiter mit **[4. E-Mail / SMTP](04-email-smtp.md)**.
