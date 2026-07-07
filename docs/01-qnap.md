# 1. QNAP einrichten (Backend + Foto-Speicher)

Das Backend läuft als Docker-Container direkt auf deinem QNAP. Dort werden die
**Fotos** gespeichert – du behältst die volle Kontrolle. Alle übrigen Daten
(Nutzer/E-Mails, Zuordnungen, Bestellungen, Meldungen) liegen in **Cloud
Firestore**, die Eltern-Anmeldung läuft über **Firebase Authentication**.
Richte zuerst Firebase ein: **[8. Firebase](08-firebase.md)**.

## 1.1 Voraussetzungen

- QNAP mit **Container Station** (App Center → „Container Station“ installieren).
- Genug Speicherplatz auf einer Freigabe für die Fotos.
- Optional, aber empfohlen: SSH-Zugang zum QNAP (Systemsteuerung → Telnet/SSH →
  „SSH-Dienst aktivieren“).

## 1.2 Ordner (Volume) für die Fotos

Standardmäßig speichert die App ihre Fotos im Unterordner `data` **direkt im
Projektordner** (`foto-app-code/data`) – siehe `docker-compose.yml` (`./data:/data`).
Du musst also normalerweise **keinen** separaten Foto-Ordner anlegen; der `data`-
Ordner entsteht beim ersten Start automatisch. Darin legt die App an:

- `storage/originals/` – Originaldateien (geschützt)
- `storage/admin/`, `storage/thumbs/`, `storage/previews/` – generierte Varianten

(Eine lokale Datenbankdatei gibt es nicht mehr – die Daten liegen in Firestore.)

> **Brauche ich einen separaten `foto-app`-Ordner?** Nein. Der ist nur nötig,
> wenn du die Fotos bewusst **außerhalb** des Projektordners ablegen willst (z. B.
> auf einer anderen Freigabe). Dann passt du den Volume-Pfad an (siehe 1.4). Mit
> der Standard-Einstellung liegen alle Fotos unter `foto-app-code/data` und ein
> zusätzlicher `foto-app`-Ordner wird nicht verwendet.

## 1.3 Projekt auf das QNAP bringen

**Variante A – per Git (empfohlen, wenn Git auf dem QNAP verfügbar ist):**

```bash
cd /share/CACHEDEV1_DATA/photographic
git clone <DEINE_REPO_URL> foto-app-code
cd foto-app-code
```

**Variante B – per File Station:** Lade dieses Projekt als ZIP herunter,
entpacke es und kopiere den Ordner über File Station auf das QNAP, z. B. nach
`/share/CACHEDEV1_DATA/photographic/foto-app-code`.

> Hinweis: In der Standard-Einstellung liegen die Fotos im Unterordner `data`
> **innerhalb** von `foto-app-code` (`foto-app-code/data`). Ein separater
> `foto-app`-Ordner daneben ist nur nötig, wenn du den Volume-Pfad in
> `docker-compose.yml` bewusst dorthin umbiegst (siehe 1.4).

## 1.4 Konfiguration (.env) anlegen

Im Projektordner (`foto-app-code`):

```bash
cp .env.example .env
```

`.env` öffnen (z. B. via File Station Texteditor) und mindestens setzen:

```ini
PUBLIC_APP_URL=https://photographic.alae.app          # deine App-Domain (Netlify)
EXTRA_CORS_ORIGINS=https://creartphotographic.netlify.app
FIREBASE_PROJECT_ID=photographic-7ba68
FIREBASE_SERVICE_ACCOUNT_PATH=/run/secrets/firebase-service-account.json
JWT_SECRET=<openssl rand -base64 48>
FILE_TOKEN_SECRET=<openssl rand -base64 48>
ADMIN_USERNAME=admin
ADMIN_PASSWORD=<starkes-passwort>              # für ersten Start; später Hash, s. u.
ADMIN_EMAIL=vonallmenalain@gmail.com          # für Login per E-Mail + "Passwort vergessen"
# Empfohlen: API unter api.alae.app -> dann genuegt SameSite=lax + COOKIE_DOMAIN
COOKIE_SECURE=true
COOKIE_SAMESITE=lax
COOKIE_DOMAIN=.alae.app
```

> **Firebase-Service-Account:** Lade die Service-Account-JSON aus der Firebase
> Console (siehe [docs/08-firebase.md](08-firebase.md)) herunter und lege sie als
> `firebase-service-account.json` in den Projektordner (neben `.env`). Die
> `docker-compose.yml` hängt sie schreibgeschützt in den Container ein. Diese
> Datei niemals ins Git committen!

> Secrets erzeugen (auf einem Mac/Linux/QNAP-SSH):
> `openssl rand -base64 48`

**Volume-Pfad anpassen (optional):** In `docker-compose.yml` zeigt das Volume
standardmäßig auf `./data`, d. h. die Fotos landen in `foto-app-code/data`. Das
ist für die meisten Setups ausreichend. **Nur** wenn die Fotos woanders liegen
sollen (z. B. auf einer anderen Freigabe), änderst du den linken Pfad:

```yaml
    volumes:
      - /share/CACHEDEV1_DATA/photographic/foto-app:/data
```

## 1.5 Container bauen & starten

### Variante A: SSH (am einfachsten)

```bash
cd /share/CACHEDEV1_DATA/photographic/foto-app-code
docker compose pull backend          # fertiges Image aus GHCR holen
docker compose up -d backend
# Logs ansehen:
docker compose logs -f backend
```

> Standardmäßig wird das **fertig gebaute Image** aus der GitHub Container
> Registry verwendet (von GitHub Actions automatisch gebaut). Willst du stattdessen
> direkt auf dem QNAP bauen, nutze das Override:
> `docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build backend`.
> Für vollautomatische Updates siehe **[9. Automatisches Deployment](09-auto-deploy.md)**.

Beim ersten Start legt die App Standardprodukte und (aus `ADMIN_PASSWORD`)
den Admin-Benutzer in Firestore an. In den Logs solltest du sehen:

```
[migrate] Firestore ready (project=photographic-7ba68)
[server] listening on :4000 (env=production)
[server] firestore   : project photographic-7ba68
```

### Variante B: Container Station GUI

1. Container Station → **Anwendungen erstellen** (Applications → Create).
2. Inhalt von `docker-compose.yml` einfügen, Volume-Pfad anpassen.
3. Im Hintergrund müssen die Umgebungsvariablen aus `.env` verfügbar sein –
   am einfachsten ist hier die SSH-Variante. Alternativ die Variablen direkt im
   Compose-Editor unter `environment:` eintragen.

## 1.6 Funktioniert es?

Im selben Netzwerk im Browser oder per SSH:

```bash
curl http://<QNAP-IP>:4000/health
# {"ok":true,"time":"..."}
```

## 1.7 Admin-Benutzer sicher anlegen (bcrypt-Hash)

Für den Dauerbetrieb solltest du kein Klartext-Passwort in `.env` lassen, sondern
einen **bcrypt-Hash** verwenden:

```bash
# im Container (optional die Admin-E-Mail als 3. Argument):
docker compose exec backend npm run create-admin -- admin "DeinSicheresPasswort" vonallmenalain@gmail.com
```

Das gibt einen Hash aus. Trage ihn in `.env` ein und entferne `ADMIN_PASSWORD`:

```ini
ADMIN_USERNAME=admin
ADMIN_PASSWORD_HASH=$2a$10$....
# ADMIN_PASSWORD=   (leer / entfernt)
ADMIN_EMAIL=vonallmenalain@gmail.com
```

Danach Container neu starten:

```bash
docker compose up -d backend
```

> **Admin-E-Mail / „Passwort vergessen“:** Wird `ADMIN_EMAIL` gesetzt, trägt die
> App die Adresse beim Start automatisch (normalisiert) am Admin-Konto ein. Du
> kannst dich dann **mit dem Benutzernamen *oder* der E-Mail-Adresse** anmelden
> und „Passwort vergessen“ nutzen. Damit die Reset-Mail wirklich verschickt wird,
> muss SMTP konfiguriert sein (siehe [docs/04-email-smtp.md](04-email-smtp.md));
> ohne SMTP landet der Link nur im Server-Log (`mail: DEV LOG ONLY`).
>
> **Direkter Notnagel ohne E-Mail-Versand:** Der obige `create-admin`-Befehl mit
> E-Mail als 3. Argument setzt sofort ein neues Passwort **und** registriert die
> Admin-E-Mail – unabhängig davon, ob SMTP eingerichtet ist. Danach kannst du
> dich direkt mit der E-Mail-Adresse und dem neuen Passwort anmelden.
>
> **Benutzername ändern (z. B. weg von „admin“):** Melde dich im Adminbereich an
> und öffne **Konto** in der Seitenleiste. Dort kannst du Benutzername und
> E-Mail-Adresse frei ändern (z. B. auf „Alain“). Danach kannst du dich mit dem
> neuen Benutzernamen **oder** der E-Mail-Adresse anmelden. Die Umbenennung wird
> beim nächsten Start **nicht** überschrieben – `ADMIN_USERNAME` aus der `.env`
> legt nur beim allerersten Start (wenn noch kein Admin existiert) den Namen fest.

## 1.8 Updates einspielen

**Empfohlen – automatisch (kein ZIP/Kopieren mehr):** Richte das automatische
Deployment ein. Dann baut GitHub Actions bei jedem Merge nach `main` das Image
und Watchtower aktualisiert das Backend auf dem QNAP von selbst. Schritt für
Schritt: **[9. Automatisches Deployment](09-auto-deploy.md)**.

**Manuell (fertiges Image aus GHCR ziehen):**

```bash
cd /share/CACHEDEV1_DATA/photographic/foto-app-code
docker compose pull backend          # neues Image aus der Registry holen
docker compose up -d backend
```

**Manuell + lokal bauen (nur falls nötig, z. B. eigener Test-Stand):**

```bash
cd /share/CACHEDEV1_DATA/photographic/foto-app-code
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build backend
```

> **Kein `git` auf dem QNAP?** Das ist normal. Den Quellcode brauchst du dort gar
> nicht mehr – im Normalbetrieb wird nur das fertige Image gezogen. Musst du
> einmalig die `docker-compose.yml` aktualisieren, hol sie ohne git per `curl`
> (das Repo ist öffentlich):
> `curl -fsSL https://raw.githubusercontent.com/vonallmenalain/photographic/main/docker-compose.yml -o docker-compose.yml`
> Details: **[9. Automatisches Deployment](09-auto-deploy.md)**.

Die Daten in Firestore bleiben unverändert erhalten (liegen in der Cloud, nicht
im Container). Die Fotos im `/data`-Volume bleiben ebenfalls erhalten.

## 1.9 Backups

Sichere regelmäßig den `data/`-Ordner (die **Fotos**). Am besten mit QNAP
**Hybrid Backup Sync** auf ein zweites Ziel. Die übrigen Daten (Zuordnungen,
Bestellungen, Meldungen) liegen in **Firestore**; sichere sie über die Firebase
Console bzw. `gcloud firestore export` (siehe [docs/08-firebase.md](08-firebase.md)).

➡️ Weiter mit **[2. Cloudflare Tunnel](02-cloudflare-tunnel.md)**.
