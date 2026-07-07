# 8. Firebase (Firestore-Datenbank + Authentication)

Diese App speichert **alle Daten** (E-Mail-Adressen/Nutzer, Events, Kinder,
Foto-Metadaten, Zuordnungen, Bestellungen, Meldungen, Audit-Log) in **Cloud
Firestore**. Die **Eltern-Anmeldung** läuft über **Firebase Authentication**
(passwortloser E-Mail-Link). Nur die eigentlichen Foto-Dateien liegen weiterhin
auf dem QNAP-Volume (damit Originale geschützt bleiben und das Wasserzeichen
serverseitig erzeugt werden kann).

```
Browser ──Firebase Auth (E-Mail-Link)──▶ Firebase
   │                                         ▲
   │ API + ID-Token                          │ Admin SDK (Firestore + Auth)
   ▼                                         │
Backend (QNAP) ──────────────────────────────┘
   └─ Foto-Originale + Wasserzeichen-Varianten im /data-Volume
```

Wichtig: Der **Browser greift nie direkt auf Firestore zu**. Das Backend nutzt
das **Firebase Admin SDK** (mit Service-Account) und umgeht damit die
Firestore-Sicherheitsregeln. Deshalb sind die mitgelieferten Regeln bewusst
**komplett gesperrt** (`allow read, write: if false;`) – das ist hier die
sicherste Einstellung.

---

## 8.1 Was du schon hast

Die Web-App, Firestore und Authentication sind bereits in deinem Projekt
`photographic-7ba68` angelegt. Die Web-Konfiguration ist im Frontend hinterlegt
(und über `VITE_FIREBASE_*` überschreibbar).

## 8.2 Authentication aktivieren (E-Mail-Link)

1. Firebase Console → **Build → Authentication → Get started**.
2. Tab **Sign-in method** → Anbieter **„E-Mail-/Passwort“** aktivieren.
3. Dort zusätzlich **„E-Mail-Link (passwortlose Anmeldung)“** einschalten.
4. Tab **Settings → Authorized domains** → folgende Domains hinzufügen:
   - `photographic.alae.app` (eigene App-Domain)
   - `creartphotographic.netlify.app` (rohe Netlify-URL)
   - `localhost` (nur fürs lokale Testen)

   > Fehlt eine dieser Domains, schlägt der Anmeldelink mit
   > `auth/unauthorized-continue-uri` fehl. Der Anmeldelink wird immer auf die
   > Domain ausgestellt, von der aus die Eltern die App geöffnet haben
   > (`window.location.origin`), daher müssen beide App-Domains eingetragen sein.

So bekommen Eltern beim Login eine E-Mail mit einem sicheren Anmeldelink. Nach
dem Klick wird im Frontend die Anmeldung abgeschlossen, ein Firebase-ID-Token
erzeugt und gegen eine Backend-Session getauscht (`/api/parent/firebase-session`).

> Du kannst die Firebase-Anmeldung abschalten und stattdessen die eigene,
> deutsche Mail der App verschicken (Code + Ein-Klick-Link). Wie das geht,
> steht in **[8.2a](#82a-eltern-login-eigene-mail-statt-firebase-mail-empfohlen)**.

## 8.2a Eltern-Login: eigene Mail statt Firebase-Mail (empfohlen)

Die von Firebase versendete Anmelde-Mail kommt von
`noreply@…firebaseapp.com`, ist standardmässig **englisch** und landet oft im
**Spam**. Du kannst die App stattdessen ihre **eigene** Mail verschicken lassen:
deutsch, mit deinem Absender (z. B. `Foto-Galerie <no-reply@alae.app>`),
hübschem Layout und einem **6-stelligen Code _und_ Ein-Klick-Link**. Bei
korrekt eingerichteter Absenderdomain (SPF/DKIM/DMARC) landet sie zuverlässig im
Posteingang.

Wichtig zu wissen: Die `VITE_FIREBASE_*`-Werte werden weiterhin für den
**Firestore-Datenbankzugriff** gebraucht – sie einfach zu löschen schaltet den
Login also **nicht** ab. Dafür gibt es zwei aufeinander abgestimmte Schalter:

- **Backend:** `FIREBASE_PARENT_AUTH=false`
- **Frontend:** `VITE_FIREBASE_PARENT_AUTH=false`

### Schritt für Schritt

1. **SMTP einrichten** (falls noch nicht geschehen). Ohne SMTP werden Mails nur
   ins Server-Log geschrieben. Anleitung inkl. SPF/DKIM:
   [docs/04-email-smtp.md](04-email-smtp.md). In der Backend-`.env`:

   ```ini
   SMTP_HOST=smtp.deinanbieter.de
   SMTP_PORT=587
   SMTP_SECURE=false
   SMTP_USER=dein-smtp-benutzer
   SMTP_PASS=dein-smtp-passwort
   MAIL_FROM=Foto-Galerie <no-reply@alae.app>
   SUPPORT_EMAIL=support@alae.app
   ```

2. **Backend umstellen:** in der `.env` (bzw. Root-`.env` für docker-compose)
   `FIREBASE_PARENT_AUTH=false` setzen und Backend neu starten:

   ```bash
   docker compose up -d backend
   ```

   Beim Start zeigt das Log dann `parent auth : code only`.

3. **Frontend umstellen:** in der Netlify-Umgebung (oder lokal in
   `frontend/.env`) `VITE_FIREBASE_PARENT_AUTH=false` setzen und das Frontend
   **neu deployen/bauen** (Vite-Variablen werden zur Build-Zeit eingebacken).
   In Netlify: **Site settings → Environment variables → Add**, danach
   **Deploys → Trigger deploy → Clear cache and deploy site**.

4. **Absenderdomain absichern** (entscheidend gegen Spam): für die Domain in
   `MAIL_FROM` (z. B. `alae.app`) **SPF**, **DKIM** und **DMARC** als
   DNS-Einträge setzen. Die genauen Werte liefert dein SMTP-/Mail-Anbieter.

5. **Testen:** in der Eltern-App eine im Admin **angelegte** Adresse eingeben.
   Es kommt nun deine eigene deutsche Mail mit Code + „E-Mail bestätigen“-Button.
   Der Login-Bildschirm spricht jetzt von „Zugangscode“ statt „Anmeldelink“.

> Zurückschalten? Beide Flags wieder auf `true` setzen (und Frontend neu
> deployen). Bereits eingeloggte Eltern bleiben in beiden Fällen angemeldet –
> die Session verwaltet das Backend per Cookie, unabhängig vom gewählten Flow.

## 8.3 Service-Account für das Backend erstellen

Das Backend braucht einen **Service-Account** (NICHT die öffentliche Web-Config):

1. Firebase Console → **Projekteinstellungen (Zahnrad) → Dienstkonten**.
2. **„Neuen privaten Schlüssel generieren“** → eine JSON-Datei wird heruntergeladen.
3. Diese Datei auf dem QNAP als `firebase-service-account.json` **neben** die
   `.env` legen (die `docker-compose.yml` hängt sie read-only in den Container
   unter `/run/secrets/firebase-service-account.json` ein).
4. In `.env`: `FIREBASE_SERVICE_ACCOUNT_PATH=/run/secrets/firebase-service-account.json`.

Alternativen:
- `FIREBASE_SERVICE_ACCOUNT` = kompletter JSON-Inhalt als String (z. B. in
  Container-Umgebungen ohne Dateizugriff).
- `GOOGLE_APPLICATION_CREDENTIALS` = Standard-ADC-Pfad.

> **Sicherheit:** Den Service-Account niemals ins Git committen. Die `.gitignore`
> ignoriert `firebase-service-account*.json` bereits.

## 8.4 Firestore-Sicherheitsregeln deployen

Die Regeln liegen in [`../firestore.rules`](../firestore.rules) und sperren jeden
direkten Client-Zugriff. Deployen entweder per CLI …

```bash
npx firebase-tools deploy --only firestore:rules --project photographic-7ba68
```

… oder per Copy & Paste in der Firebase Console unter **Firestore Database →
Rules → Publish**.

## 8.5 Lokal entwickeln mit der Firebase Emulator Suite

Für lokale Entwicklung/Tests brauchst du keinen echten Service-Account – nutze
die Emulatoren (Java 11+ erforderlich):

```bash
# Terminal 1: Emulatoren starten (Firestore + Auth)
npx firebase-tools emulators:start --only firestore,auth --project photographic-7ba68

# Terminal 2: Backend gegen die Emulatoren starten
cd backend
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
FIREBASE_PROJECT_ID=photographic-7ba68 \
ADMIN_PASSWORD=test1234 npm run dev
```

Im Emulator-Modus werden keine echten E-Mails versendet und keine echten Daten
geschrieben – ideal zum Ausprobieren.

## 8.6 Datensicherung (Backup) & Export

Firestore-Daten sicherst du über die Google Cloud Tools:

```bash
gcloud firestore export gs://<dein-bucket>/backups/$(date +%F) \
  --project photographic-7ba68
```

Oder richte in der Google Cloud Console geplante Firestore-Backups ein. Die
Foto-Dateien sicherst du wie gehabt über das QNAP-Volume (siehe
[docs/01-qnap.md](01-qnap.md), Abschnitt Backups).

## 8.7 Datenmodell (Firestore-Collections)

| Collection | Inhalt |
|---|---|
| `admin_users` | Admin-Logins (Dokument-ID = Benutzername, bcrypt-Hash) |
| `events` | Foto-Sets / Shootings inkl. Status & Ablaufdatum |
| `children` | Kinder (interne Namen, nie für Eltern sichtbar) |
| `parent_emails` | Eltern-E-Mail-Adressen = zentrale Identität |
| `email_children` | n:m-Verknüpfung E-Mail ↔ Kind |
| `photos` | Foto-Metadaten (Original/Varianten liegen als Datei im Volume) |
| `photo_emails` | Direkte Zuordnung Foto ↔ E-Mail (Klassenfotos) |
| `verification_tokens` | Codes/Magic-Links für den SMTP-Fallback-Login |
| `parent_sessions` | Aktive Eltern-Sitzungen (httpOnly-Cookie) |
| `products` | Produkte/Preise (digital/Print) |
| `orders` / `order_items` | Warenkörbe & Bestellungen |
| `download_grants` | Download-Berechtigungen nach Kauf |
| `reports` | Meldungen aus dem Eltern-Formular |
| `audit_log` | Admin-Aktionen |

➡️ Weiter mit **[1. QNAP einrichten](01-qnap.md)**.
