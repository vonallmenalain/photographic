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

## 1.2 Ordner (Volume) für die App anlegen

1. Öffne **File Station**.
2. Lege auf einer Freigabe einen Ordner an, z. B. `Photos/foto-app`.
3. Darin wird die App später automatisch anlegen:
   - `storage/originals/` – Originaldateien (geschützt)
   - `storage/admin/`, `storage/thumbs/`, `storage/previews/` – generierte Varianten

   (Eine lokale Datenbankdatei gibt es nicht mehr – die Daten liegen in Firestore.)

Den vollständigen Pfad merken, z. B. `/share/Photos/foto-app`
(unter manchen QNAPs `/share/CACHEDEV1_DATA/Photos/foto-app`).

## 1.3 Projekt auf das QNAP bringen

**Variante A – per Git (empfohlen, wenn Git auf dem QNAP verfügbar ist):**

```bash
cd /share/Photos
git clone <DEINE_REPO_URL> foto-app-code
cd foto-app-code
```

**Variante B – per File Station:** Lade dieses Projekt als ZIP herunter,
entpacke es und kopiere den Ordner über File Station auf das QNAP, z. B. nach
`/share/Photos/foto-app-code`.

## 1.4 Konfiguration (.env) anlegen

Im Projektordner (`foto-app-code`):

```bash
cp .env.example .env
```

`.env` öffnen (z. B. via File Station Texteditor) und mindestens setzen:

```ini
PUBLIC_APP_URL=https://fotos.alae.app          # deine App-Domain (Netlify)
EXTRA_CORS_ORIGINS=https://creartphotographic.netlify.app
FIREBASE_PROJECT_ID=photographic-7ba68
FIREBASE_SERVICE_ACCOUNT_PATH=/run/secrets/firebase-service-account.json
JWT_SECRET=<openssl rand -base64 48>
FILE_TOKEN_SECRET=<openssl rand -base64 48>
ADMIN_USERNAME=admin
ADMIN_PASSWORD=<starkes-passwort>              # für ersten Start; später Hash, s. u.
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

**Volume-Pfad anpassen:** In `docker-compose.yml` zeigt das Volume standardmäßig
auf `./data`. Ändere den linken Pfad auf deinen QNAP-Ordner, falls die Fotos
woanders liegen sollen:

```yaml
    volumes:
      - /share/Photos/foto-app:/data
```

## 1.5 Container bauen & starten

### Variante A: SSH (am einfachsten)

```bash
cd /share/Photos/foto-app-code
docker compose up -d --build backend
# Logs ansehen:
docker compose logs -f backend
```

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
# im Container:
docker compose exec backend npm run create-admin -- admin "DeinSicheresPasswort"
```

Das gibt einen Hash aus. Trage ihn in `.env` ein und entferne `ADMIN_PASSWORD`:

```ini
ADMIN_USERNAME=admin
ADMIN_PASSWORD_HASH=$2a$10$....
# ADMIN_PASSWORD=   (leer / entfernt)
```

Danach Container neu starten:

```bash
docker compose up -d backend
```

## 1.8 Updates einspielen

```bash
cd /share/Photos/foto-app-code
git pull            # oder neue Dateien per File Station kopieren
docker compose up -d --build backend
```

Die Daten in Firestore bleiben unverändert erhalten (liegen in der Cloud, nicht
im Container). Die Fotos im `/data`-Volume bleiben ebenfalls erhalten.

## 1.9 Backups

Sichere regelmäßig den `data/`-Ordner (die **Fotos**). Am besten mit QNAP
**Hybrid Backup Sync** auf ein zweites Ziel. Die übrigen Daten (Zuordnungen,
Bestellungen, Meldungen) liegen in **Firestore**; sichere sie über die Firebase
Console bzw. `gcloud firestore export` (siehe [docs/08-firebase.md](08-firebase.md)).

➡️ Weiter mit **[2. Cloudflare Tunnel](02-cloudflare-tunnel.md)**.
