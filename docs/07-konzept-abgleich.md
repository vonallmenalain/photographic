# 7. Konzept-Abgleich (Analyse & Umsetzung im Detail)

Dieses Dokument geht das gelieferte Konzept Punkt für Punkt durch: **Was wurde
umgesetzt**, **wie**, und **was musst du selbst einrichten**.

## Grundidee & zwei Umgebungen (Konzept 1 & 3)
- **Elternbereich** und **Adminbereich** sind klar getrennt. Der Adminbereich
  liegt unter `/admin`, ist über den normalen Elternfluss nicht verlinkt und
  durch Login geschützt. Eltern sehen ihn nicht.
- Neubau ohne Übernahme bestehenden Codes ✔.

## Priorität 1 – Sicherheit & Vertrauen (Konzept 2, 10)
- Fotos erst **nach E-Mail-Verifizierung** sichtbar (Server erzwingt verifizierte
  Session auf allen Galerie-/Kauf-Endpunkten).
- **Keine offenen Galerien / keine erratbaren Links:** Bildzugriff nur über
  kurzlebige, signierte Tokens (Preview) bzw. Download-Grants (Original).
- **Originale niemals frei zugänglich:** kein Endpunkt liefert Originale vor dem
  Kauf; Download nur mit gültigem Grant **und** passender Eltern-Session.
- **Previews mit Wasserzeichen**, reduzierter Auflösung/Qualität (nicht
  drucktauglich), serverseitig erzeugt.
- **Keine technischen Fehlertexte / keine internen IDs / keine fremden Namen**
  in Eltern-Antworten; neutrale, freundliche Meldungen.
- **Ruhiges, vertrauenswürdiges UI** mit erklärenden Hinweisen, warum bestätigt
  werden muss.

## Priorität 2 – Einfache Bedienung (Konzept 5, 16.5)
- Ablauf: E-Mail eingeben → Code/Link → Fotos sehen → auswählen → kaufen.
- **Kein Passwortzwang**, kein klassisches Konto. Der Browser **merkt sich** die
  Bestätigung (httpOnly-Session-Cookie, Standard 30 Tage), sodass am selben PC
  nicht erneut bestätigt werden muss.

## Priorität 3 – E-Mail als zentrale Identität (Konzept 3, 4, 8.3)
- Die E-Mail-Adresse ist das zentrale Objekt: Zugriff, Anzeige, Kauf, Bestellungen
  hängen daran.
- **n:m-Beziehungen:** Eine E-Mail ↔ mehrere Kinder; ein Kind ↔ mehrere E-Mails
  (Mutter+Vater). Verwaltung im Adminbereich.

## Foto-/Zugriffslogik (Konzept 4, 13)
- Sichtbar nur, wenn: Event `published` + nicht abgelaufen, Foto nicht
  deaktiviert, **und** Foto mit der E-Mail verknüpft (über Kind oder direkt).
- **Klassen-/Gruppenfotos** (ohne einzelnes Kind) werden in der Regel „für die
  ganze Klasse“ freigeschaltet: alle Familien des Events (jede E-Mail mit einem
  Kind in dieser Klasse) sehen sie automatisch. Alternativ lassen sie sich
  gezielt einzelnen E-Mails zuweisen → diese Familien sehen nur ihr zugewiesenes
  Foto.
- Workflow: hochladen → verarbeiten → zuordnen → Event veröffentlichen. Ein
  separates Veröffentlichen je Foto gibt es nicht mehr.

## E-Mail-Verifizierung (Konzept 5)
- Code **oder** Magic-Link. Code-Hash + Ablaufzeit + Versuchslimit.
- **Kein Informationsleck:** unbekannte Adressen erhalten dieselbe neutrale
  Antwort wie bekannte; nur bekannte erhalten tatsächlich eine E-Mail.
- **Kein Kauf ohne Verifizierung** (Warenkorb/Checkout erfordern Session).

## Vorschau-Logik & Bildvarianten (Konzept 6, 7)
- **Ein Original** wird hochgeladen; daraus entstehen automatisch:
  - **Original** (geschützt, nur nach Kauf),
  - **Admin-Thumbnail** (sauber, nur im Adminbereich),
  - **Eltern-Thumbnail** (klein, Wasserzeichen),
  - **Preview** (größer, Wasserzeichen, bewusst nicht drucktauglich).
- Wasserzeichen ist diagonal gekachelt, deutlich sichtbar, aber so dosiert, dass
  die **Kaufentscheidung** (Gesicht/Ausdruck/Ausschnitt) möglich bleibt.
- Parameter (Größe/Qualität/Text) über `.env` einstellbar (`IMG_*`).

## Admin-Workflow (Konzept 8, 16.4)
- Upload (Mehrfach), Fotoverwaltung (zuordnen, veröffentlichen/zurückziehen,
  neu verarbeiten, löschen), Kinderverwaltung, E-Mail-Verwaltung, Bestellungen,
  Meldungen, Produkte, Dashboard mit Kennzahlen.

## Kauf- & Bestelllogik (Konzept 9)
- Produktarten **digital** und **Print** (Standardprodukte vorangelegt). Warenkorb,
  Checkout (Stripe **oder** manueller Abschluss), Bestellstatus, **Download-Grants**
  für digitale Käufe, Bestätigungs-E-Mail.
- Architektur erlaubt spätere Erweiterungen (Größen, Pakete, Sets, Rabatte), ohne
  die Grundlogik zu ändern.

## Datenschutz & Aufbewahrung (Konzept 11, 16.1)
- Datensparsam: für Eltern reicht die E-Mail, kein Passwort.
- **Aufbewahrung Standard 30 Tage** je Event (`expires_at`), danach nicht mehr
  sichtbar; Löschung entfernt alle Varianten.
- Datenschutz-Seite im Frontend erklärt Speicherung, Zugriff, Aufbewahrung.

## Meldefunktion (Konzept 12, 16.3)
- Eltern-Formular (Hilfe-Seite) → landet im Adminbereich unter „Meldungen“.

## Statuswerte (Konzept 14)
- Vollständig abgebildet für Fotos, E-Mails, Bestellungen, Events (siehe
  `backend/src/db/schema.sql` und [Betrieb 6.2](06-betrieb.md)).

## Infrastruktur (Konzept 15)
- **Netlify** (Frontend), **QNAP** (Backend + Foto-Speicher + DB), **Cloudflare
  Tunnel** (sichere Verbindung). Nur ein Original wird hochgeladen, Varianten
  entstehen daraus.

## Nicht-Ziele (Konzept 18) – bewusst weggelassen
Kein Passwort-Kundenkonto, kein Social-Login, keine öffentlichen Galerien, keine
Bewertungen/Kommentare/Likes, keine KI-Sortierung/Gesichtserkennung, keine
komplexen Rabattmodelle, keine mehreren Admin-Rollen, kein vollautomatischer
Druckdienstleister, kein komplexes CRM. Fokus: **sicherer Fotozugang,
E-Mail-Verifizierung, Zuordnung, Preview, Kauf.**

---

## Was du selbst einrichten musst (nicht automatisierbar)

Diese Dinge erfordern **deine** Konten/Zugänge und sind in den Docs Schritt für
Schritt erklärt:

1. **QNAP/Docker**: Container bauen & starten, Volume-Pfad, Admin anlegen
   → [01-qnap.md](01-qnap.md)
2. **Cloudflare Tunnel**: Tunnel-Token, Public Hostname `api.alae.app`
   → [02-cloudflare-tunnel.md](02-cloudflare-tunnel.md)
3. **Netlify**: Repository verbinden, `VITE_API_BASE_URL` setzen, deployen
   → [03-netlify.md](03-netlify.md)
4. **SMTP**: Zugangsdaten + SPF/DKIM für seriöse Zustellung
   → [04-email-smtp.md](04-email-smtp.md)
5. **Stripe (optional)**: API-Key + Webhook
   → [05-stripe.md](05-stripe.md)
6. **Secrets**: `JWT_SECRET`, `FILE_TOKEN_SECRET`, Admin-Passwort-Hash setzen
   → [01-qnap.md](01-qnap.md)

## Mögliche spätere Ausbaustufen (optional)
- Automatischer Cron-Job zum Archivieren/Löschen abgelaufener Events.
- Weitere Produktarten/Preisstaffeln/Pakete im Admin-UI (Backend unterstützt es bereits).
- Eigene Domain für Frontend + API unter gemeinsamer Hauptdomain (bessere Cookies).
- Optionaler Cloudflare-Access-Schutz vor dem Admin-/API-Hostnamen.
