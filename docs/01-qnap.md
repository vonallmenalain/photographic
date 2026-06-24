# 1. QNAP einrichten (Backend + Foto-Speicher)

Das Backend läuft als Docker-Container direkt auf deinem QNAP. Dort werden auch
die Fotos und die Datenbank gespeichert – du behältst die volle Kontrolle.

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
   - `app.db` – die SQLite-Datenbank

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
PUBLIC_APP_URL=https://deine-app.netlify.app   # trägst du nach Netlify-Setup ein
JWT_SECRET=<openssl rand -base64 48>
FILE_TOKEN_SECRET=<openssl rand -base64 48>
ADMIN_USERNAME=admin
ADMIN_PASSWORD=<starkes-passwort>              # für ersten Start; später Hash, s. u.
COOKIE_SECURE=true
COOKIE_SAMESITE=none
```

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

Beim ersten Start legt die App Schema, Standardprodukte und (aus `ADMIN_PASSWORD`)
den Admin-Benutzer an. In den Logs solltest du sehen:

```
[migrate] schema ready at /data/app.db
[server] listening on :4000 (env=production)
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

Die Datenbank in `/data/app.db` bleibt erhalten (liegt im Volume).

## 1.9 Backups

Sichere regelmäßig den gesamten `data/`-Ordner (DB **und** Fotos). Am besten mit
QNAP **Hybrid Backup Sync** auf ein zweites Ziel. Die Datei `app.db` enthält
sämtliche Zuordnungen und Bestellungen.

➡️ Weiter mit **[2. Cloudflare Tunnel](02-cloudflare-tunnel.md)**.
