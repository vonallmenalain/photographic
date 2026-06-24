# 9. Automatisches Deployment (kein ZIP mehr kopieren)

Bisher musstest du bei jeder Änderung eine ZIP herunterladen, entpacken, per
File Station aufs QNAP kopieren und neu bauen. Das ist mühsam und fehleranfällig.

Ab jetzt läuft das automatisch:

1. **GitHub Actions** baut das Backend-Image bei jedem Merge nach `main` und legt
   es in der **GitHub Container Registry (GHCR)** ab.
2. **Watchtower** auf dem QNAP merkt, dass ein neues Image da ist, zieht es und
   startet den Backend-Container automatisch neu.

```
  Merge / PR nach main
          │
          ▼
  ┌─────────────────────┐   docker push   ┌──────────────────────────┐
  │  GitHub Actions      │ ──────────────▶ │  GHCR                    │
  │  (baut das Image)    │                 │  ghcr.io/.../backend:latest
  └─────────────────────┘                 └────────────┬─────────────┘
                                                        │ docker pull (automatisch)
                                                        ▼
                                          ┌──────────────────────────┐
                                          │  QNAP: Watchtower         │
                                          │  -> Backend neu starten   │
                                          └──────────────────────────┘
```

> **Frontend?** Das Frontend deployt Netlify bereits automatisch bei jedem Push
> (siehe [docs/03-netlify.md](03-netlify.md)). Diese Anleitung betrifft nur das
> **Backend** auf dem QNAP.

> **Reihenfolge ist wichtig!** Das Registry-Image entsteht **erst beim ersten
> Merge nach `main`**. Vorher gibt es nichts zu pullen. Arbeite die Schritte
> daher genau in dieser Reihenfolge ab:
> **1) PR mergen → 2) Action grün → 3) Paket öffentlich → 4) QNAP umstellen.**
> Ziehst du das Image vorher, bekommst du `pull access denied` – das ist normal.

> **Begriff „neuer PR“:** Ein Pull Request allein verändert deinen Live-Betrieb
> **nicht**. Erst wenn der PR nach `main` **gemerged** wird, baut Actions ein
> neues `:latest`-Image und das QNAP aktualisiert sich. Für reine PRs (noch nicht
> gemerged) prüft die Pipeline nur, ob der Build durchläuft – das ist die
> gewünschte Sicherung gegen kaputte Stände.

---

## Schritt 1: Die GitHub-Action ist bereits eingerichtet

Im Repository liegt `.github/workflows/build-backend-image.yml`. Diese Datei
baut das Backend und pusht es nach GHCR. Du musst dafür **nichts installieren** –
GitHub führt sie automatisch aus.

So prüfst du, dass es läuft:

1. Merge einen Pull Request nach `main` (oder ändere etwas in `backend/`).
2. Öffne auf GitHub den Tab **Actions** → Workflow **„Build & Push Backend
   Image“**. Der Lauf sollte grün durchlaufen.
3. Danach erscheint unter **Code → Packages** (rechte Seitenleiste) ein Paket
   namens **`photographic-backend`**.

> **Berechtigungen:** Die Action nutzt das automatische `GITHUB_TOKEN`. Falls der
> Push fehlschlägt (`denied: permission_denied`), aktiviere unter
> **Settings → Actions → General → Workflow permissions** die Option
> **„Read and write permissions“**.

---

## Schritt 2: Das Image lesbar machen (einmalig)

Das QNAP muss das Image **pullen** können. Wähle eine der beiden Varianten:

### Variante A – Image öffentlich machen (am einfachsten, empfohlen)

Das Image enthält nur kompilierten Code, **keine** Secrets (deine `.env` und die
`firebase-service-account.json` liegen ausschließlich auf dem QNAP). Es kann
daher problemlos öffentlich sein.

1. GitHub → **dein Profil/Org → Packages → `photographic-backend`**.
2. **Package settings → Danger Zone → Change visibility → Public**.

Dann braucht das QNAP **keine** Login-Daten. Fertig mit diesem Schritt.

### Variante B – Image privat lassen (mit Login auf dem QNAP)

Bleibt das Paket privat, muss sich das QNAP bei GHCR anmelden:

1. Erstelle auf GitHub ein **Personal Access Token (classic)** mit dem Scope
   **`read:packages`** (Settings → Developer settings → Personal access tokens).
2. Auf dem QNAP per SSH einloggen:

```bash
echo "DEIN_TOKEN" | docker login ghcr.io -u DEIN_GITHUB_NAME --password-stdin
```

Das schreibt `~/.docker/config.json`. Für Watchtower hängst du diese Datei in den
Container ein – kommentiere dazu in `docker-compose.yml` beim `watchtower`-Service
die Zeile mit `watchtower-config.json` ein und lege die Datei daneben:

```bash
cp ~/.docker/config.json /share/CACHEDEV1_DATA/photographic/foto-app-code/watchtower-config.json
```

---

## Schritt 3: QNAP auf das Registry-Image umstellen

Die `docker-compose.yml` zieht jetzt standardmäßig das fertige Image aus GHCR
statt lokal zu bauen:

```yaml
  backend:
    image: ${BACKEND_IMAGE:-ghcr.io/vonallmenalain/photographic-backend:latest}
```

> Heißt dein GitHub-Owner anders als `vonallmenalain`, setze in der `.env`:
> `BACKEND_IMAGE=ghcr.io/<dein-owner>/photographic-backend:latest`

Damit der QNAP pullt statt baut, muss **einmalig** die neue `docker-compose.yml`
(und `docker-compose.build.yml`) dorthin. Auf dem QNAP ist **kein `git`**
installiert – nutze daher eine der folgenden Varianten.

### Variante 1 – per `curl`/`wget` (kein git nötig, empfohlen)

Das Repository ist öffentlich, du kannst die Dateien also direkt von GitHub
laden (Dateien aus dem Branch `main`):

```bash
cd /share/CACHEDEV1_DATA/photographic/foto-app-code
BASE=https://raw.githubusercontent.com/vonallmenalain/photographic/main
# Sicherheitskopie der alten Datei:
cp docker-compose.yml docker-compose.yml.bak
# Neue Compose-Dateien holen:
curl -fsSL "$BASE/docker-compose.yml"       -o docker-compose.yml
curl -fsSL "$BASE/docker-compose.build.yml" -o docker-compose.build.yml
```

> Hat das QNAP kein `curl`, geht auch `wget -O docker-compose.yml "$BASE/docker-compose.yml"`.

### Variante 2 – per File Station

Lade `docker-compose.yml` (und `docker-compose.build.yml`) aus dem GitHub-Repo
herunter und kopiere sie per File Station nach
`/share/CACHEDEV1_DATA/photographic/foto-app-code` (vorhandene Datei ersetzen).

### Variante 3 – bestehende Datei direkt bearbeiten

Öffne die alte `docker-compose.yml` im File-Station-Texteditor und ersetze beim
`backend`-Dienst die Zeilen `build:`/`image: photo-app-backend:latest` durch:

```yaml
    image: ${BACKEND_IMAGE:-ghcr.io/vonallmenalain/photographic-backend:latest}
    labels:
      com.centurylinklabs.watchtower.enable: "true"
```

(Für Watchtower zusätzlich den `watchtower`-Dienst aus der neuen Datei kopieren.)

### Dann: Image ziehen und starten

```bash
cd /share/CACHEDEV1_DATA/photographic/foto-app-code
docker compose pull backend    # zieht das fertige Image aus GHCR
docker compose up -d backend
docker compose logs -f backend
```

> Das machst du nur **einmal** für die Umstellung. Künftige **Code-Updates**
> kommen über das Image automatisch (Schritt 4) – du musst den Quellcode auf dem
> QNAP nie wieder anfassen. Nur wenn sich die `docker-compose.yml` oder `.env`
> selbst ändert, holst du sie erneut (Variante 1).

> **`git` doch installieren?** Optional über das QNAP-Paket **Entware**
> (`opkg install git git-http`). Nötig ist das aber nicht – Variante 1 reicht.

---

## Schritt 4: Watchtower für Auto-Updates starten

Watchtower ist in der `docker-compose.yml` als optionaler Dienst (Profil
`autoupdate`) hinterlegt. Einmal aktivieren:

```bash
cd /share/CACHEDEV1_DATA/photographic/foto-app-code
docker compose --profile autoupdate up -d
```

Das startet zusätzlich den Container `photo-app-watchtower`. Er prüft alle
**5 Minuten** (einstellbar über `WATCHTOWER_POLL_INTERVAL` in der `.env`), ob ein
neueres `:latest`-Image vorliegt, zieht es und startet das Backend neu. Alte
Images werden aufgeräumt (`WATCHTOWER_CLEANUP=true`).

Watchtower aktualisiert dabei **nur** den Backend-Container, weil dieser das
Label `com.centurylinklabs.watchtower.enable=true` trägt – Cloudflared & Co.
bleiben unangetastet.

Logs / Status prüfen:

```bash
docker compose logs -f watchtower
docker compose ps
```

---

## Der neue Ablauf bei Änderungen

1. Du (oder ein PR) änderst Code → **PR mergen nach `main`**.
2. GitHub Actions baut das Image und pusht `:latest` nach GHCR (1–3 Min.).
3. Watchtower auf dem QNAP zieht es beim nächsten Check und startet das Backend
   neu (standardmäßig innerhalb von 5 Min.).

**Kein ZIP, kein File Station, kein manuelles Bauen mehr.** Deine Fotos im
`/data`-Volume und alle Daten in Firestore bleiben dabei unverändert.

---

## Sofort statt warten? (optional manuell auslösen)

Du willst nicht auf das Poll-Intervall warten:

```bash
cd /share/CACHEDEV1_DATA/photographic/foto-app-code
docker compose pull backend && docker compose up -d backend
```

---

## Auf eine bestimmte Version zurück (Rollback)

Jeder Build erzeugt zusätzlich einen festen Tag `sha-<commit>`. Für ein gezieltes
Zurücksetzen in der `.env`:

```ini
BACKEND_IMAGE=ghcr.io/vonallmenalain/photographic-backend:sha-<commit>
```

Dann `docker compose up -d backend`. Zum Reaktivieren der Auto-Updates wieder auf
`:latest` stellen (Watchtower aktualisiert nur `:latest`).

---

## Troubleshooting

| Symptom | Ursache / Lösung |
|---|---|
| Action `denied: permission_denied` beim Push | **Settings → Actions → General → Workflow permissions → Read and write** aktivieren. |
| QNAP `pull access denied` für `photo-app-backend` | Es läuft noch die **alte** `docker-compose.yml` (z. B. weil `git pull` mangels git nichts tat). Neue Compose-Datei holen (Schritt 3, Variante 1). |
| QNAP `pull access denied` / `unauthorized` für das GHCR-Image | Image noch nicht gebaut (PR noch nicht gemergt) **oder** privat → Image öffentlich machen bzw. `docker login ghcr.io` (Schritt 2, Variante B). |
| `WARN ... variable is not set. Defaulting to a blank string` | Harmlos: dein `ADMIN_PASSWORD_HASH` in der `.env` enthält `$`-Zeichen, die Compose als Variablen liest. Der Hash wird trotzdem korrekt an den Container übergeben. Zum Stummschalten siehe Hinweis unten. |
| `git: command not found` | Auf dem QNAP ist kein git installiert. Nutze Schritt 3, Variante 1 (`curl`/`wget`) – git wird nicht benötigt. |
| Watchtower aktualisiert nichts | Läuft der Container? `docker compose ps`. Trägt das Backend das Label `...watchtower.enable=true`? Stimmt der Image-Tag (`:latest`)? |
| Image-Name falsch | Owner heißt anders → `BACKEND_IMAGE` in `.env` setzen (Owner muss klein geschrieben sein). |
| Update soll sofort kommen | `WATCHTOWER_POLL_INTERVAL` verkleinern **oder** manuell `docker compose pull && up -d backend`. |

### Hinweis: die `$`-Warnungen sind harmlos

Compose liest die `.env` auch für die Variablen-Ersetzung. Ein bcrypt-Hash wie
`ADMIN_PASSWORD_HASH=$2a$10$…` enthält `$`, weshalb Compose `WARN ... variable is
not set`-Meldungen ausgibt. **Du kannst sie ignorieren** – der Hash wird über
`env_file` wörtlich (und damit korrekt) an den Container übergeben; der Login
funktioniert.

> **Bitte den Hash NICHT mit `$$` „escapen“.** Da dieselbe `.env` zugleich als
> `env_file` dient und dort die Werte **wörtlich** übernommen werden, würde ein
> verdoppeltes `$$` im Container landen und den Hash zerstören. Lass den Hash
> also unverändert und ignoriere die Warnung.

➡️ Zurück zur Übersicht: **[README](../README.md)** · Betrieb &
Troubleshooting: **[6. Betrieb](06-betrieb.md)**.
