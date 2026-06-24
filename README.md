# Geschützte Foto-Galerie für Kinderfotos

Eine sichere, E-Mail-basierte Plattform, über die Eltern **ausschließlich die
ihnen zugeordneten Kinderfotos** ansehen und kaufen können. Kein offener Shop,
keine erratbaren Galerien, Originale niemals frei zugänglich.

> Kernlogik: **E-Mail bestätigen → zugeordnete Fotos sehen → geschützte
> Wasserzeichen-Previews beurteilen → kaufen → Original/Bestellung erhalten.**

Diese App wurde **komplett neu** gebaut (kein bestehender Code übernommen) und
setzt das gelieferte Konzept um. Was du noch selbst einrichten musst (QNAP,
Cloudflare Tunnel, Netlify, SMTP, optional Stripe), ist Schritt für Schritt in
[`docs/`](docs/) beschrieben.

---

## 1. Architektur

```
   ┌──────────────────────────┐         HTTPS          ┌───────────────────────────┐
   │      Eltern / Admin       │  ───────────────────▶  │   Netlify (Frontend)       │
   │      (Browser)            │                        │   React-App, statisch      │
   └──────────────────────────┘                        └─────────────┬─────────────┘
                                                                      │ API-Aufrufe (HTTPS)
                                                                      ▼
                                                        ┌───────────────────────────┐
                                          Cloudflare    │  Cloudflare Tunnel         │
                                          (kein offener │  api.deinedomain.de        │
                                           Port am NAS) └─────────────┬─────────────┘
                                                                      ▼
                                                        ┌───────────────────────────┐
                                                        │  QNAP (Docker)            │
                                                        │  Backend-API + Bild-       │
                                                        │  verarbeitung (sharp)      │
                                                        │  SQLite-DB + Fotos auf      │
                                                        │  dem QNAP-Volume           │
                                                        └───────────────────────────┘
```

- **Frontend** (`frontend/`): React + Vite, gehostet auf **Netlify**. Enthält den
  Eltern- **und** den strikt getrennten Adminbereich (`/admin`).
- **Backend** (`backend/`): Node + Express + TypeScript, läuft als **Docker-
  Container auf dem QNAP**. Verarbeitet Uploads, erzeugt Bildvarianten
  (Thumbnail + Wasserzeichen-Preview), verwaltet Datenbank und Zugriffe.
- **Speicherung**: Alle Originale **und** die SQLite-Datenbank liegen auf einem
  QNAP-Volume – du behältst die volle Kontrolle, nichts liegt bei einem
  beliebigen externen Anbieter.
- **Cloudflare Tunnel**: Verbindet das Netlify-Frontend sicher mit der QNAP-API,
  **ohne** Portfreigabe am Router.

> Du kannst das Frontend auch direkt auf dem QNAP ausliefern lassen, aber das
> Konzept sieht Netlify vor – diese Anleitung folgt dem.

---

## 2. Was die App alles kann (Konzept-Abdeckung)

| Konzept-Anforderung | Umsetzung |
|---|---|
| E-Mail als zentrale Identität, kein Passwortzwang | Eltern bestätigen per **Code oder Magic-Link**, Session bleibt im Browser gespeichert |
| Keine Fotos vor Verifizierung | Galerie-Endpunkte erfordern verifizierte Session |
| Keine offenen Galerien | Eltern sehen nur explizit verknüpfte Fotos (Kind- oder Direktzuweisung) |
| Keine Info-Lecks | Neutrale Meldung („Falls freigeschaltet …“), keine internen IDs/Namen, keine technischen Fehlertexte |
| Originale geschützt | Originale nie als Vorschau; Download nur nach Kauf via Grant + Session |
| Wasserzeichen-Previews | Server-seitig gerendert (diagonal gekachelt), reduzierte Auflösung/Qualität |
| Nur ein Original hochladen | `sharp` erzeugt Admin-Thumb, Eltern-Thumb, Preview automatisch |
| Familienlogik | E-Mail ↔ Kind als n:m (Mutter+Vater, mehrere Kinder, Geschwister) |
| Klassenfotos | Foto ohne Kind-Bezug, direkt einzelnen E-Mails zugewiesen |
| Veröffentlichungs-Workflow | Status für Events & Fotos; sichtbar erst bei „published“ + freigegeben |
| Warenkorb & Kauf | Produkte (digital/Print), Warenkorb, Checkout (Stripe-ready oder manuell), Bestellstatus |
| Nach dem Kauf | Bestellübersicht, Download-Links, Bestätigungs-E-Mail |
| Aufbewahrung 30 Tage | `expires_at` je Event (Standard 30 Tage), nach Ablauf nicht mehr sichtbar |
| Meldefunktion | Eltern-Formular → Admin „Meldungen“ |
| Adminbereich | Events/Fotos/Zuordnung/E-Mails/Bestellungen/Meldungen/Produkte |
| Statuswerte | Fotos, E-Mails, Bestellungen, Events – wie im Konzept benannt |

Details zur fachlichen Logik: [`docs/07-konzept-abgleich.md`](docs/07-konzept-abgleich.md).

---

## 3. Schnellstart (lokal zum Ausprobieren)

Voraussetzung: Node.js 20+ (getestet mit 22).

```bash
# 1) Backend
cd backend
cp .env.example .env            # für lokal reichen die Defaults
npm install
ADMIN_PASSWORD=test1234 npm run dev   # startet API auf http://localhost:4000

# 2) Frontend (neues Terminal)
cd frontend
cp .env.example .env            # VITE_API_BASE_URL=http://localhost:4000 eintragen
npm install
npm run dev                     # startet App auf http://localhost:5173
```

- Eltern-App: <http://localhost:5173>
- Adminbereich: <http://localhost:5173/admin> (Login: `admin` / `test1234`)

**E-Mail im lokalen Modus:** Ohne SMTP werden Codes/Links in die **Backend-
Konsole** geschrieben – dort den 6-stelligen Code kopieren.

Typischer erster Durchlauf:
1. Admin-Login → **Event** anlegen → **Fotos** hochladen.
2. **Kind** anlegen, Foto dem Kind zuordnen, Foto **veröffentlichen**.
3. Event-Status auf **„published“** setzen.
4. Unter **E-Mail-Adressen** eine Eltern-Adresse anlegen, mit dem Kind verknüpfen.
5. Eltern-App: Adresse eingeben → Code aus der Konsole → Galerie sehen → kaufen.

---

## 4. Produktiv-Setup (Schritt-für-Schritt)

In dieser Reihenfolge durcharbeiten:

1. **[QNAP einrichten](docs/01-qnap.md)** – Docker/Container Station, Volume, Backend bauen & starten, Admin anlegen.
2. **[Cloudflare Tunnel](docs/02-cloudflare-tunnel.md)** – API sicher unter `api.deinedomain.de` erreichbar machen.
3. **[Netlify](docs/03-netlify.md)** – Frontend deployen, `VITE_API_BASE_URL` setzen.
4. **[E-Mail / SMTP](docs/04-email-smtp.md)** – Versand von Codes/Links/Bestätigungen.
5. **[Stripe (optional)](docs/05-stripe.md)** – echte Bezahlung; ohne Stripe gibt es einen manuellen Bestellabschluss.
6. **[Betrieb, Admin, Backups, Aufbewahrung](docs/06-betrieb.md)**.

> **Wichtig zur Reihenfolge:** Du brauchst die Netlify-URL für `PUBLIC_APP_URL`
> (Backend) und die Cloudflare-API-URL für `VITE_API_BASE_URL` (Netlify). Lege
> beides zuerst an, trage die URLs dann gegenseitig ein und deploye neu.

---

## 5. Projektstruktur

```
.
├── backend/                 # Node/Express API (läuft auf QNAP via Docker)
│   ├── src/
│   │   ├── routes/          # parent, admin, files, webhook
│   │   ├── services/        # access, orders, verification, payments
│   │   ├── lib/             # images (sharp), email, auth, ids, cookies
│   │   ├── middleware/      # auth, rate-limit, errors
│   │   └── db/              # schema.sql, migrate, connection
│   ├── Dockerfile
│   └── .env.example
├── frontend/                # React/Vite SPA (Netlify)
│   ├── src/pages/parent/    # Eltern: Landing, Verify, Gallery, Cart, ...
│   ├── src/pages/admin/     # Admin: Events, Emails, Orders, Reports, ...
│   └── netlify.toml
├── docs/                    # Detaillierte Einrichtungs-Anleitungen
├── docker-compose.yml       # Backend (+ optional Cloudflare Tunnel)
└── .env.example             # Compose-/Backend-Konfiguration
```

---

## 6. Sicherheits-Hinweise (bitte beachten)

- Setze **eigene, lange** `JWT_SECRET` und `FILE_TOKEN_SECRET` (z. B. `openssl rand -base64 48`).
- Verwende ein **starkes Admin-Passwort** (als bcrypt-Hash, siehe Docs).
- `COOKIE_SECURE=true` und `COOKIE_SAMESITE=none` sind nötig, weil Frontend
  (Netlify) und API (Cloudflare) auf verschiedenen Domains liegen → erfordert HTTPS (beides erfüllt).
- Lege regelmäßige **Backups** des QNAP-Volumes an (`data/` enthält DB + Fotos).
- Originale verlassen den Server nur über zeitlich begrenzte Download-Grants
  nach erfolgtem Kauf.

Die vollständige Konzept-Abdeckung inkl. „Nicht-Ziele“ steht in
[`docs/07-konzept-abgleich.md`](docs/07-konzept-abgleich.md).
