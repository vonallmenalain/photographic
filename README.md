# Photographic

Photographic ist ein MVP fuer eine sichere Kindergarten- und Schulfoto-Plattform. Eltern melden sich per Firebase Magic Link an, sehen nur freigegebene Fotos ihres Kindes und koennen spaeter Bestellungen ausloesen.

## Architektur

- Netlify hostet nur die statische React-App unter `fotos.alae.app`.
- Firebase Auth verschickt Magic Links und liefert verifizierte ID Tokens.
- Die Web-App sendet jedes API-Request mit `Authorization: Bearer <Firebase ID token>`.
- Firestore speichert Metadaten, Berechtigungen, Warenkorb-/Order-Vorstufen und Audit Logs.
- Der Backend-Service `photos-api` laeuft als Docker-Container auf dem QNAP NAS.
- Cloudflare Tunnel exponiert ausschliesslich `photos-api` unter `api.alae.app`.
- Die Bilddateien bleiben lokal auf dem QNAP, zum Beispiel unter `/share/FotosSchuleApp`.

## Kein Cloudflare R2

R2 wurde bewusst entfernt. Dateien bleiben lokal auf dem QNAP. Es gibt keine AWS SDK-Abhaengigkeiten, keine presigned R2 URLs und keine R2-Umgebungsvariablen.

## Keine Netlify Functions

Netlify liefert nur die statische Frontend-App aus. Das Backend laeuft auf dem QNAP als `photos-api`; Backend-Secrets liegen ausschliesslich in den Container-Umgebungsvariablen auf dem NAS.

## Environment Variables

Frontend, `apps/web`:

```env
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_APP_ID=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_PHOTOS_API_BASE_URL=http://localhost:8787
# Produktion: VITE_PHOTOS_API_BASE_URL=https://api.alae.app
```

QNAP Backend, `apps/photos-api`:

```env
PORT=8787
PHOTO_ROOT=/data/photos
FIREBASE_SERVICE_ACCOUNT_BASE64=
FIREBASE_PROJECT_ID=
ADMIN_EMAILS=
ACCESS_CODE_PEPPER=
APP_BASE_URL=http://localhost:5173
CORS_ORIGINS=http://localhost:5173,http://localhost:8888,https://fotos.alae.app
MAX_UPLOAD_MB=150
```

Future variables, nur dokumentiert:

```env
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
EMAIL_PROVIDER_API_KEY=
EMAIL_FROM=
```

Docker Compose / Cloudflare Tunnel:

```env
CLOUDFLARE_TUNNEL_TOKEN=
```

Keine `.env`, Firebase Admin JSON-Dateien, Tunnel Tokens oder privaten Keys committen.

## FIREBASE_SERVICE_ACCOUNT_BASE64 erstellen

PowerShell:

```powershell
$path = "$env:USERPROFILE\Desktop\firebase-admin.json"
[Convert]::ToBase64String([IO.File]::ReadAllBytes($path)) | Set-Clipboard
```

## ACCESS_CODE_PEPPER erstellen

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Firebase Setup

1. Firebase Authentication aktivieren.
2. Email/Password aktivieren.
3. Email link passwordless sign-in aktivieren.
4. Autorisierte Domains hinzufuegen: `localhost`, die Netlify-Domain und `fotos.alae.app`.
5. Firestore-Datenbank erstellen.
6. `firestore.rules` deployen. Die Regeln verweigern direkten Client-Zugriff; `photos-api` nutzt die Firebase Admin SDK und prueft Berechtigungen serverseitig.

## Lokale Entwicklung

```bash
npm install
npm run dev:api
```

In einem zweiten Terminal:

```bash
npm run dev:web
```

Frontend oeffnen und lokal setzen:

```env
VITE_PHOTOS_API_BASE_URL=http://localhost:8787
```

Ohne echte Firebase Admin Credentials startet der Health-Endpoint, geschuetzte API-Routen benoetigen aber gueltige Backend-Umgebungsvariablen.

## Netlify Deployment

- Repo mit Netlify verbinden.
- Build command: `npm install && npm run build:web`
- Publish directory: `apps/web/dist`
- Nur Frontend-Variablen in Netlify setzen.
- Keine Backend-Secrets in Netlify speichern.
- Keine Netlify Functions verwenden.

Produktiv:

```env
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_APP_ID=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_PHOTOS_API_BASE_URL=https://api.alae.app
```

## QNAP Deployment

1. Auf dem QNAP `/share/FotosSchuleApp` erstellen.
2. `docker-compose.example.yml` als Vorlage verwenden.
3. Auf dem QNAP eine private `.env` mit Backend-Secrets erstellen.
4. `photos-api` starten.
5. Cloudflare Tunnel Hostname `api.alae.app` auf `http://photos-api:8787` routen.
6. `APP_BASE_URL=https://fotos.alae.app` setzen, damit Login-Links auf das Frontend zeigen.
7. `CORS_ORIGINS` mindestens mit `https://fotos.alae.app` setzen.
8. QNAP Admin-Oberflaechen, SMB, WebDAV, File Station und Photo Station niemals oeffentlich exponieren.

Der Docker-Kontext ist aktuell `./apps/photos-api`. Dort liegt keine eigene `package-lock.json`; der Container installiert deshalb die API-Abhaengigkeiten aus `apps/photos-api/package.json`, baut mit Dev-Dependencies und entfernt sie danach mit `npm prune --omit=dev`. Fuer einen voll lockfile-reproduzierbaren Containerbuild sollte der Docker-Kontext in einer spaeteren Iteration auf das Monorepo-Root mit Root-`package-lock.json` umgestellt werden.

## Preview-Dateien neu generieren

Bestehende Derivate koennen aus den unveraenderten Originaldateien neu erzeugt werden:

```bash
npm run regenerate:previews
```

Das Script liest die `photos`-Metadaten aus Firestore, prueft `originalPath`, `previewPath` und `thumbPath`, erzeugt fehlende Preview-/Thumbnail-Dateien neu und aktualisiert Dateigroessen, Bildmasse und `processingStatus`. Vorhandene Previews werden nur kontrolliert ueberschrieben:

```bash
npm run regenerate:previews -- --overwrite
npm run regenerate:previews -- --limit=20
```

Fehler bei einzelnen Bildern werden geloggt und im jeweiligen Firestore-Dokument als `processingStatus: "error"` mit `processingError` gespeichert; danach laeuft das Script mit dem naechsten Bild weiter.

## Bild-Pipeline

Jeder neue Upload erzeugt drei lokale Varianten unter `PHOTO_ROOT`:

```text
org_abc/job_def/ph_xyz/original/original.jpg
org_abc/job_def/ph_xyz/thumbs/thumb.webp
org_abc/job_def/ph_xyz/previews/preview.webp
```

Das Original bleibt privat und wird nie als Pfad an Eltern ausgeliefert. Thumbnail und Preview werden serverseitig mit `sharp` erzeugt. Die Preview wird auf maximal 1200 px Kantenlaenge reduziert, leicht weichgezeichnet, als WebP mit reduzierter Qualitaet gespeichert und erhaelt ein eingebranntes, diagonal gekacheltes Wasserzeichen `VORSCHAU` mit hellem Text und dunklem Stroke/Schatten.

Manuelle Checks:

```bash
npm run build:api
npm run build:web
npm run regenerate:previews -- --limit=1
```

Nach einem Upload muessen genau Original, Thumbnail und Preview existieren. `GET /api/photos/:photoId/thumb` und `GET /api/photos/:photoId/preview` duerfen nur authentifiziert funktionieren. `GET /api/photos/:photoId/original` liefert fuer Eltern vor bezahlter Bestellung `402 ORIGINAL_NOT_PAID` und streamt erst nach bezahlter Order beziehungsweise fuer Admins.

## Sicherheitscheckliste

- Niemals QNAP QTS oder Admin UI oeffentlich exponieren.
- Niemals SMB, WebDAV, File Station oder Photo Station oeffentlich exponieren.
- Nur `photos-api` ueber Cloudflare Tunnel exponieren.
- `PHOTO_ROOT` privat halten.
- Firebase ID Token bei jedem API-Request pruefen.
- Firestore-Rechte pruefen, bevor Bilder gestreamt werden.
- Originaldateien nie statisch ausliefern und nie als Pfad/URL an das Frontend senden.
- Previews nur als eingebrannte, serverseitig entwertete Dateien ausliefern.
- Keine echten Kinderfotos in fruehen Tests verwenden.
- Alle hochgeladenen oder geteilten Test-Secrets vor Produktion rotieren.
- Backups von `/share/FotosSchuleApp` pflegen.
- QNAP und Container regelmaessig aktualisieren.

## MVP Limitierungen

- Stripe ist noch nicht implementiert.
- Kein echter Mailversand an ganze Klassen.
- Keine Print-Fulfillment-Integration.
- Kein produktionsreifer Rechts-/Einwilligungsworkflow.
- Original-Download ist serverseitig abgesichert, echte Zahlungsmarkierung muss durch Stripe/Webhook noch gesetzt werden.
- Keine Background Job Queue.
- NAS-Uptime und Internet-Upload begrenzen die Verfuegbarkeit.

## Daten und Pfade

Firestore speichert nur Metadaten und Berechtigungen. Lokale Dateipfade enthalten keine Kinder-, Eltern-, Schul- oder Klassennamen. Die API erzeugt zufaellige IDs und speichert relative Pfade wie:

```text
org_abc/job_def/ph_xyz/previews/preview.webp
```

Originale werden nur ueber `GET /api/photos/:photoId/original` gestreamt. Die Route prueft Authentifizierung, Fotozugriff und eine bezahlte Order mit passendem `photoId`; vor dem Kauf wird niemals das Original ausgeliefert.
