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

Hol dir den aktuellen Code-Stand (mit der neuen Compose-Datei) aufs QNAP und
starte das Backend einmalig neu – ab jetzt wird **gepullt statt gebaut**:

```bash
cd /share/CACHEDEV1_DATA/photographic/foto-app-code
git pull                       # oder neue Dateien per File Station kopieren
docker compose pull backend    # zieht das fertige Image aus GHCR
docker compose up -d backend
docker compose logs -f backend
```

> Diesen `git pull` brauchst du nur **einmal** für die Umstellung. Künftige
> **Code-Updates** kommen über das Image automatisch (Schritt 4) – du musst den
> Quellcode auf dem QNAP nicht mehr aktualisieren. Nur wenn sich die
> `docker-compose.yml` oder `.env` selbst ändert, holst du sie erneut.

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
| QNAP `pull access denied` / `unauthorized` | Image privat → Variante B (Schritt 2): `docker login ghcr.io` bzw. `watchtower-config.json` einhängen, oder Image öffentlich machen. |
| Watchtower aktualisiert nichts | Läuft der Container? `docker compose ps`. Trägt das Backend das Label `...watchtower.enable=true`? Stimmt der Image-Tag (`:latest`)? |
| Image-Name falsch | Owner heißt anders → `BACKEND_IMAGE` in `.env` setzen (Owner muss klein geschrieben sein). |
| Update soll sofort kommen | `WATCHTOWER_POLL_INTERVAL` verkleinern **oder** manuell `docker compose pull && up -d backend`. |

➡️ Zurück zur Übersicht: **[README](../README.md)** · Betrieb &
Troubleshooting: **[6. Betrieb](06-betrieb.md)**.
