# PhotoGuard

Mobile-first MVP für eine sichere Foto-Bestellplattform für Kindergarten- und Schulfotos.

## Stack

- Vite, React, TypeScript, React Router
- Firebase Auth im Frontend
- Firestore für erlaubte Reads und Admin-Metadaten
- Netlify Functions mit Firebase Admin SDK
- Cloudflare R2 als privater Bucket über presigned S3 URLs
- Zod für Function-Input-Validation

## Setup

1. Installiere Abhängigkeiten:

```bash
npm install
```

2. Kopiere `.env.example` nach `.env` und fülle alle Werte aus. Keine echten Secrets committen.

3. Firebase:

- Erstelle ein Firebase-Projekt.
- Aktiviere Authentication mit E-Mail/Passwort und optional E-Mail-Link.
- Erstelle eine Firestore-Datenbank.
- Deploye `firestore.rules`.
- Lege mindestens einen Admin-User an. Danach setze `SEED_ADMIN_UID` auf dessen UID und führe den Seed aus.

```bash
npm run seed:mock
```

4. Cloudflare R2:

- Erstelle einen privaten Bucket.
- Erstelle R2 API Tokens mit Zugriff auf diesen Bucket.
- Trage `R2_ACCOUNT_ID`, `R2_BUCKET_NAME`, `R2_ACCESS_KEY_ID` und `R2_SECRET_ACCESS_KEY` in Netlify ein.
- Setze CORS am Bucket so, dass Browser-Uploads von deiner Netlify-Domain erlaubt sind:

```json
[
  {
    "AllowedOrigins": ["https://your-site.netlify.app", "http://localhost:8888"],
    "AllowedMethods": ["GET", "PUT"],
    "AllowedHeaders": ["Content-Type", "Authorization"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 300
  }
]
```

5. Lokal starten:

```bash
npm run dev
```

Für Netlify Functions lokal:

```bash
npx netlify dev
```

6. Build prüfen:

```bash
npm run build
```

## Wichtige Umgebungsvariablen

- `VITE_FIREBASE_*`: öffentliche Firebase-Web-App-Konfiguration.
- `FIREBASE_SERVICE_ACCOUNT_BASE64` oder `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`: Firebase Admin SDK.
- `ACCESS_CODE_PEPPER`: Secret für SHA-256 Hashes der Zugangscodes.
- `ACCESS_CODE_ONE_TIME`: `true` markiert Codes nach Einlösung als eingelöst.
- `ACCESS_CODE_EXPIRES_DAYS`: Ablaufdauer neuer Codes.
- `R2_*`: Cloudflare R2 Zugriff. Nur Netlify Functions dürfen diese Werte sehen.
- `ALLOW_ORIGINAL_UPLOADS`: optionaler Schalter für Original-Uploads.

## Datenmodell

Die Firestore Collections entsprechen dem MVP-Modell:

- `users`
- `organizations`
- `jobs`
- `classes`
- `children`
- `accessCodes`
- `guardianAccess`
- `photos`
- `orders`
- `auditLogs`

`guardianAccess` nutzt deterministische Dokument-IDs, damit Firestore Rules einzelne Berechtigungen prüfen können:

- `{uid}_{jobId}_{childId}`
- `{uid}_{jobId}_class_{classId}`
- `{uid}_{jobId}_job`

## Admin-Workflow

1. Admin meldet sich an.
2. Organisation, Job, Klassen und Pseudonyme erstellen.
3. Access Codes pro Pseudonym generieren.
4. Thumbnail, Preview und Original hochladen. Das Frontend erhält nur presigned PUT URLs.
5. Foto-Metadaten werden in Firestore gespeichert.
6. Job veröffentlichen.

## Eltern-Workflow

1. Zugangscode eingeben oder QR-Code öffnen.
2. Mit E-Mail anmelden.
3. Code einlösen.
4. Galerie öffnen. Bild-URLs werden nur über `create-preview-url` erstellt.

## Sicherheit

- R2 bleibt privat.
- R2 Credentials sind ausschließlich in Netlify Functions.
- Es gibt keine öffentlichen Foto-URLs.
- Originale werden im Frontend nicht direkt angezeigt.
- Access Codes werden nur gehasht gespeichert.
- Firestore Rules sind default deny.
- Admin-Aktionen laufen nur für `role: admin`.
- Sensible Function-Aktionen schreiben `auditLogs`.
- R2 Object Keys enthalten keine Kindernamen.

## MVP-Limitierungen

- Kein echtes Payment und kein Stripe.
- Warenkorb und Orders sind vorbereitet, aber nur Mock-UI.
- Keine serverseitige Bildverarbeitung.
- Admin lädt Thumbnail, Preview und Original selbst hoch.
- Keine Gesichtserkennung.
- Download-URLs liefern absichtlich `501 Not Implemented`.
- Firestore Composite Indexes können je nach Query beim ersten Lauf von Firebase vorgeschlagen werden.
- Für Tests keine echten Kinderfotos und keine echten Namen verwenden.
