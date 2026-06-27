# Geschützte Foto-Galerie für Kinderfotos

Eine sichere, E-Mail-basierte Plattform, über die Eltern **ausschließlich die
ihnen zugeordneten Kinderfotos** ansehen und kaufen können. Kein offener Shop,
keine erratbaren Galerien, Originale niemals frei zugänglich.

> Kernlogik: **E-Mail bestätigen → zugeordnete Fotos sehen → geschützte
> Wasserzeichen-Previews beurteilen → kaufen → Original/Bestellung erhalten.**

Daten & Login laufen über **Firebase**: Alle Informationen (Nutzer/E-Mails,
Events, Foto-Metadaten, Bestellungen, Meldungen) liegen in **Cloud Firestore**,
die Eltern-Anmeldung in **Firebase Authentication** (passwortloser E-Mail-Link).
Nur die Foto-Originale + Wasserzeichen-Varianten bleiben auf dem QNAP-Volume,
damit Originale geschützt sind. Einrichtung: [`docs/08-firebase.md`](docs/08-firebase.md).

Was du noch selbst einrichten musst (Firebase, QNAP, Cloudflare Tunnel, Netlify,
optional SMTP/Stripe), ist Schritt für Schritt in [`docs/`](docs/) beschrieben.

---

## 1. Architektur

```
   ┌──────────────────────────┐         HTTPS          ┌───────────────────────────┐
   │      Eltern / Admin       │  ───────────────────▶  │   Netlify (Frontend)       │
   │      (Browser)            │                        │   React-App  fotos.alae.app│
   └──────────────────────────┘                        └─────────────┬─────────────┘
                                                                      │ API-Aufrufe (HTTPS)
                                                                      ▼
                                                        ┌───────────────────────────┐
                                          Cloudflare    │  Cloudflare Tunnel         │
                                          (kein offener │  api.alae.app              │
                                           Port am NAS) └─────────────┬─────────────┘
                                                                      ▼
                                                        ┌───────────────────────────┐
                                                        │  QNAP (Docker)            │
                                                        │  Backend-API + Bild-       │
                                                        │  verarbeitung (sharp)      │
                                                        │  Fotos auf dem QNAP-Volume │
                                                        └─────────────┬─────────────┘
                                                                      │ Admin SDK
                                                                      ▼
                                                        ┌───────────────────────────┐
                                                        │  Firebase                  │
                                                        │  Firestore (Datenbank)     │
                                                        │  Authentication (E-Mail)   │
                                                        └───────────────────────────┘
```

- **Frontend** (`frontend/`): React + Vite, gehostet auf **Netlify**. Enthält den
  Eltern- **und** den strikt getrennten Adminbereich (`/admin`).
- **Backend** (`backend/`): Node + Express + TypeScript, läuft als **Docker-
  Container auf dem QNAP**. Verarbeitet Uploads, erzeugt Bildvarianten
  (Thumbnail + Wasserzeichen-Preview), spricht via **Firebase Admin SDK** mit
  Firestore/Authentication und steuert alle Zugriffe.
- **Datenbank & Login**: **Cloud Firestore** speichert alle Daten, **Firebase
  Authentication** verifiziert Eltern-E-Mails (passwortloser E-Mail-Link).
- **Speicherung der Fotos**: Originale + Varianten liegen auf einem QNAP-Volume –
  Originale verlassen den Server nur nach Kauf über zeitlich begrenzte Grants.
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
| Klassenfotos | Gruppen-/Klassenfoto „für die ganze Klasse sichtbar“ → alle Familien des Events sehen es automatisch; optional zusätzlich einzelnen E-Mails zuweisbar |
| Veröffentlichungs-Workflow | Event-Status steuert die Sichtbarkeit; zugeordnete Fotos werden sichtbar, sobald das Event „published“ ist |
| Warenkorb & Kauf | Produkte (digital/Print), Warenkorb, Checkout (Stripe-ready oder manuell), Bestellstatus |
| Nach dem Kauf | Bestellübersicht, Download-Links, Bestätigungs-E-Mail |
| Aufbewahrung 30 Tage | `expires_at` je Event (Standard 30 Tage), nach Ablauf nicht mehr sichtbar |
| Meldefunktion | Eltern-Formular → Admin „Meldungen“ |
| Adminbereich | Aufträge/Fotos/Zuordnung/E-Mails (je Auftrag)/Auswertung/Bestellungen/Meldungen/Produkte |
| Massen-Import | E-Mails + Kinder + Verknüpfungen per Copy-&-Paste oder CSV/Excel (tolerante Spaltenerkennung); **mehrere Eltern-Adressen pro Kind** (Komma-getrennt in einer Spalte oder über mehrere E-Mail-Spalten) |
| Auto-Zuordnung | Fotos werden beim Upload automatisch dem Kind im Dateinamen zugeordnet – schon der Vorname samt Nummer (z. B. `Elin 1.jpg`) genügt; mehrdeutige Treffer bleiben unzugeordnet |
| Statuswerte | Fotos, E-Mails, Bestellungen, Events – wie im Konzept benannt |

Details zur fachlichen Logik: [`docs/07-konzept-abgleich.md`](docs/07-konzept-abgleich.md).

---

## 3. Schnellstart (lokal zum Ausprobieren)

Voraussetzung: Node.js 20+ (getestet mit 22) und für die Emulatoren Java 11+.

```bash
# 1) Firebase-Emulatoren (Firestore + Auth) – kein echtes Konto nötig
npx firebase-tools emulators:start --only firestore,auth --project photographic-7ba68

# 2) Backend (neues Terminal) gegen die Emulatoren
cd backend
cp .env.example .env
npm install
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
FIREBASE_PROJECT_ID=photographic-7ba68 \
ADMIN_PASSWORD=test1234 npm run dev          # API auf http://localhost:4000

# 3) Frontend (neues Terminal)
cd frontend
cp .env.example .env            # VITE_API_BASE_URL=http://localhost:4000 eintragen
npm install
npm run dev                     # startet App auf http://localhost:5173
```

> Ohne Emulatoren kannst du das Backend auch direkt gegen dein echtes Firebase-
> Projekt laufen lassen – dann brauchst du einen Service-Account, siehe
> [`docs/08-firebase.md`](docs/08-firebase.md).

- Eltern-App: <http://localhost:5173>
- Adminbereich: <http://localhost:5173/admin> (Login: `admin` / `test1234`)

**E-Mail im lokalen Modus:** Mit den Emulatoren erscheint der Firebase-
Anmeldelink in der **Auth-Emulator-UI** (`http://127.0.0.1:4001/auth`). Ist die
Firebase-Anmeldung deaktiviert, schreibt das Backend den 6-stelligen Code in die
**Backend-Konsole**.

Typischer erster Durchlauf:
1. Admin-Login → **Event** anlegen.
2. **Import** öffnen → Eltern-Adressen + Kinder als Tabelle einfügen oder als
   CSV/Excel hochladen (legt E-Mails, Kinder und die Verknüpfungen in einem
   Schritt an). Alternativ einzeln unter **E-Mail-Adressen** / im Event anlegen.
3. **Fotos** hochladen – Fotos, deren Dateiname den Kindnamen enthält
   (z. B. `Lena_Mueller_01.jpg` oder nur der Vorname wie `Elin 1.jpg`), werden
   automatisch zugeordnet. Gruppen-/Klassenfotos lassen sich „für die ganze
   Klasse“ freischalten, sodass alle Familien des Events sie sehen.
4. Event-Status auf **„published“** setzen – die zugeordneten Fotos werden dadurch sichtbar.
5. Eltern-App: Adresse eingeben → Anmeldelink öffnen (Auth-Emulator-UI) → Galerie sehen → kaufen.

> Mehr zum Schnell-Import und zur automatischen Foto-Zuordnung:
> [`docs/06-betrieb.md`](docs/06-betrieb.md) (Abschnitt 6.1a).

---

## 4. Produktiv-Setup (Schritt-für-Schritt)

In dieser Reihenfolge durcharbeiten:

1. **[Firebase](docs/08-firebase.md)** – Firestore-Regeln, Authentication (E-Mail-Link) und Service-Account einrichten.
2. **[QNAP einrichten](docs/01-qnap.md)** – Docker/Container Station, Volume, Service-Account, Backend bauen & starten, Admin anlegen.
3. **[Cloudflare Tunnel](docs/02-cloudflare-tunnel.md)** – API sicher unter `api.alae.app` erreichbar machen.
4. **[Netlify](docs/03-netlify.md)** – Frontend deployen (`fotos.alae.app`), `VITE_API_BASE_URL` + `VITE_FIREBASE_*` setzen.
5. **[E-Mail / SMTP](docs/04-email-smtp.md)** – nur für den optionalen Code-Fallback & Bestellbestätigungen.
6. **[Stripe (optional)](docs/05-stripe.md)** – echte Bezahlung; ohne Stripe gibt es einen manuellen Bestellabschluss.
7. **[Betrieb, Admin, Backups, Aufbewahrung](docs/06-betrieb.md)**.
8. **[Automatisches Deployment](docs/09-auto-deploy.md)** – Backend bei jedem
   Merge ohne ZIP/Kopieren automatisch aufs QNAP bringen (GitHub Actions + Watchtower).

### Domains dieses Projekts

| Zweck | Domain | Wo eingetragen |
|---|---|---|
| Frontend (App) | `fotos.alae.app` | Netlify Custom Domain; Backend `PUBLIC_APP_URL`; Firebase Authorized domains |
| Frontend (roh) | `creartphotographic.netlify.app` | Backend `EXTRA_CORS_ORIGINS`; Firebase Authorized domains |
| Backend-API | `api.alae.app` | Cloudflare Tunnel Public Hostname; Netlify `VITE_API_BASE_URL` |

> **Wichtig zur Reihenfolge:** `PUBLIC_APP_URL=https://fotos.alae.app` (Backend)
> und `VITE_API_BASE_URL=https://api.alae.app` (Netlify) zeigen aufeinander. Lege
> beide Hostnamen zuerst an, trage die URLs dann gegenseitig ein und deploye neu.
> Da Frontend und API beide unter `alae.app` liegen, sind sie „same-site“ →
> setze im Backend `COOKIE_SAMESITE=lax` und `COOKIE_DOMAIN=.alae.app`.

---

## 5. Projektstruktur

```
.
├── .github/workflows/       # CI: baut & pusht das Backend-Image nach GHCR
├── backend/                 # Node/Express API (läuft auf QNAP via Docker)
│   ├── src/
│   │   ├── routes/          # parent, admin, files, webhook
│   │   ├── services/        # access, orders, verification, payments
│   │   ├── lib/             # images (sharp), email, auth, ids, cookies, firebase
│   │   ├── middleware/      # auth, rate-limit, errors
│   │   └── db/              # Firestore-Datenzugriff + Seed/Migrate
│   ├── Dockerfile
│   └── .env.example
├── frontend/                # React/Vite SPA (Netlify)
│   ├── src/pages/parent/    # Eltern: Landing, Verify, Gallery, Cart, ...
│   ├── src/pages/admin/     # Admin: Events, Emails, Orders, Reports, ...
│   └── netlify.toml
├── docs/                    # Detaillierte Einrichtungs-Anleitungen
├── firestore.rules          # Firestore-Sicherheitsregeln (Client-Zugriff gesperrt)
├── firebase.json            # Firestore/Emulator-Konfiguration
├── docker-compose.yml       # Backend (+ optional Watchtower-Auto-Update / Cloudflare Tunnel)
├── docker-compose.build.yml # Override zum lokalen Bauen statt Pullen (optional)
└── .env.example             # Compose-/Backend-Konfiguration
```

---

## 6. Sicherheits-Hinweise (bitte beachten)

- Setze **eigene, lange** `JWT_SECRET` und `FILE_TOKEN_SECRET` (z. B. `openssl rand -base64 48`).
- Verwende ein **starkes Admin-Passwort** (als bcrypt-Hash, siehe Docs).
- `COOKIE_SECURE=true` ist immer nötig (erfordert HTTPS, ist erfüllt). Liegen
  Frontend (`fotos.alae.app`) und API (`api.alae.app`) unter derselben
  Hauptdomain `alae.app`, sind sie „same-site“ → `COOKIE_SAMESITE=lax` +
  `COOKIE_DOMAIN=.alae.app`. Nur wenn die API auf einer anderen Domain liegt,
  brauchst du `COOKIE_SAMESITE=none` (und `COOKIE_DOMAIN` leer).
- Halte die **Firebase-Service-Account-JSON geheim** (nie ins Git!) und belasse
  die **Firestore-Regeln gesperrt** (`firestore.rules`) – aller Zugriff läuft
  über das Backend (Admin SDK).
- Lege regelmäßige **Backups** an: QNAP-Volume (`data/` = Fotos) **und**
  Firestore (Export, siehe [`docs/08-firebase.md`](docs/08-firebase.md)).
- Originale verlassen den Server nur über Download-Grants nach erfolgtem Kauf.
  Diese sind genau so lange gültig, wie der zugehörige Auftrag verfügbar
  (veröffentlicht und innerhalb der Aufbewahrungsfrist) ist – sobald er
  archiviert wird oder die Frist (Standard 30 Tage) abläuft, werden die
  Downloads automatisch deaktiviert.

Die vollständige Konzept-Abdeckung inkl. „Nicht-Ziele“ steht in
[`docs/07-konzept-abgleich.md`](docs/07-konzept-abgleich.md).
