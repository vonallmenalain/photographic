# 6. Betrieb, Admin-Workflow, Aufbewahrung & Troubleshooting

## 6.1 Der typische Admin-Workflow

> **Schneller Weg (empfohlen):** Nutze den **Import** und die **automatische
> Foto-Zuordnung nach Dateiname** – siehe [6.1a](#61a-schnell-import--automatische-zuordnung).
> Du musst dann weder E-Mail-Adressen noch Kinder einzeln eintippen.

1. **Event / Foto-Set anlegen** (Adminbereich → „Events / Foto-Sets“).
   Ein Event hat ein Ablaufdatum (Standard 30 Tage), das du anpassen kannst.
2. **Originale hochladen** (im Event → „Fotos hochladen“). Pro Datei nur das
   Original; Thumbnail + Wasserzeichen-Preview entstehen automatisch.
3. **Kinder anlegen** und Fotos zuordnen:
   - Einzelfoto → Kind über das Dropdown zuordnen.
   - **Klassen-/Gruppenfoto** → Häkchen „Gruppen-/Klassenfoto“ setzen. Es ist
     dann automatisch **„Für die ganze Klasse sichtbar“** – alle Familien dieses
     Events (jede E-Mail mit einem Kind in der Klasse) sehen es, ohne dass du
     einzeln zuweisen musst. Für Sonderfälle kannst du das Häkchen entfernen und
     das Foto über „Einzelne E-Mails …“ gezielt einzelnen Adressen zuweisen.
4. **E-Mail-Adressen** anlegen – direkt **im Auftrag** in der Kachel
   „E-Mail-Adressen“ (unterhalb von „Kinder“) – und mit Kindern verknüpfen
   (n:m: Mutter+Vater, mehrere Kinder). Eine auftragsübergreifende Auswertung mit
   Umsatz, verifizierten Adressen und Verlaufsgrafik findest du unter
   **„Auswertung“**.
5. **Event-Status auf „published“** setzen. Erst dann sind die zugeordneten Fotos
   – nach E-Mail-Verifizierung – für Eltern sichtbar. (Foto sichtbar = Event
   published **und** Foto nicht gesperrt **und** Zuordnung vorhanden **und**
   E-Mail verifiziert.) Ein eigenes Veröffentlichen je Foto gibt es nicht mehr.
6. **Eltern benachrichtigen**, sobald alles bereit ist: in der Kachel
   „E-Mail-Adressen“ auf **„E-Mail an alle senden“** klicken. Das verschickt an
   **alle erfassten Adressen des Auftrags** eine E-Mail mit Link zur App
   (`photographic.alae.app`), einer Kurzanleitung zur Verifizierung sowie den Hinweisen
   zum Schutz der Fotos und zur Aufbewahrungsfrist (30 Tage). Voraussetzung ist
   ein konfigurierter SMTP-Versand (siehe [docs/04-email-smtp.md](04-email-smtp.md));
   ohne SMTP landen die E-Mails nur im Server-Log.

## 6.1a Schnell-Import & automatische Zuordnung

Damit du **nicht** jede E-Mail-Adresse und jedes Kind einzeln eintippen musst,
gibt es im Adminbereich den Menüpunkt **„Import“** sowie eine **automatische
Foto-Zuordnung nach Dateiname**.

### Schritt 1 – Eltern & Kinder per Tabelle importieren

Adminbereich → **Import**. Es gibt zwei Wege:

- **Kopieren & Einfügen:** Markiere in Excel/Numbers/Google Tabellen die Zeilen
  und füge sie in das Textfeld ein (das ist automatisch tab-getrennt).
- **Datei hochladen:** `.csv`, `.tsv`, `.txt` oder `.xlsx`/`.xls`.

Empfohlene Spalten (Reihenfolge **egal**, Schreibweise tolerant erkannt):

| Spalte | Bedeutung |
|---|---|
| `E-Mail` | Eltern-Adresse (zentrale Identität) – **mehrere Adressen erlaubt** (siehe unten) |
| `Kind` | **Vollständiger** Name des Kindes – mehrere Geschwister mit `,` `;` `/` `&` oder „und“ trennen |
| `Name Eltern` *(optional)* | Name der Eltern/Familie |
| `Auftrag` *(optional)* | Klasse/Gruppe; landet im passenden Auftrag |
| `Notiz` *(optional)* | interne Notiz zur E-Mail |

Beispiel (Kopiervorlage):

```
E-Mail                      E-Mail 2        Kind                    Name Eltern    Auftrag
anna@x.de, oma@x.de         papa@x.de       Lena Müller             Familie Müller Klasse 3b
paul@x.de                                   Tim Weber, Lisa Weber   Paul Weber     Klasse 3b
```

**Mehrere E-Mail-Adressen pro Kind:** Du kannst beliebig viele Eltern-Adressen
mit demselben Kind verknüpfen – auf zwei Wegen, die sich auch kombinieren lassen:

- **Mehrere Adressen in einer Spalte**, getrennt mit Komma, Semikolon, Schräg-/
  Senkrechtstrich oder Leerzeichen (z. B. `mama@x.de, papa@x.de`).
- **Mehrere E-Mail-Spalten**: eine zweite Spalte mit Titel `E-Mail 2` (oder einer
  weiteren Spalte, die ebenfalls `E-Mail` heißt). Alle Spalten mit „mail“ im Titel
  werden als E-Mail erkannt; in der Vorschau lässt sich die Zuordnung pro Spalte
  korrigieren.

Alle so erkannten (gültigen) Adressen einer Zeile werden mit jedem Kind der Zeile
verknüpft.

**Toleranz / Hinweise:**

- Spalten dürfen **vertauscht** sein und andere Bezeichnungen tragen. Die
  Erkennung läuft automatisch und lässt sich in der Vorschau **pro Spalte
  korrigieren**:
  - Spalten mit `Kind`, `Name` oder `Vorname` werden als **Kind** erkannt.
  - Spalten mit `Eltern` (z. B. `Name Eltern`) werden als **Name Eltern** erkannt.
  - Spalten mit `Auftrag`/`Klasse` werden als **Auftrag** erkannt.
- Ohne erkennbare Kopfzeile wird die E-Mail-Spalte am `@` erkannt.
- Die **`Kind`-Spalte** enthält den kompletten Namen des Kindes. Gibt es zusätzlich
  eine **`Name Eltern`-Spalte**, wird diese der E-Mail als Eltern-Name zugeordnet.
- Vor dem Import siehst du eine **Vorschau** mit Hinweisen (z. B. ungültige
  E-Mail). Bereits vorhandene Adressen/Kinder/Verknüpfungen werden **nicht
  doppelt** angelegt.
- Ziel-Event: bestehendes wählen **oder** neues anlegen. Zeilen mit eigener
  `Event`-Spalte können fehlende Events automatisch anlegen.

### Schritt 2 – Fotos hochladen mit automatischer Zuordnung

Beim Hochladen im Event wird jedes Foto automatisch dem Kind zugeordnet, dessen
Name **im Dateinamen** vorkommt (`Lena_Mueller_01.jpg` → Kind „Lena Müller“).
Es genügt bereits der **Vorname** plus laufender Nummer, wie ihn Fotografen
üblich vergeben: `Elin 1.jpg`, `Elin 2.jpg`, `Lielle 1.jpg` werden den Kindern
„Elin von Allmen“ bzw. „Lielle von Allmen“ zugeordnet (auch ohne Trennzeichen,
z. B. `Elin1.jpg`). Die Erkennung ist tolerant gegenüber Groß-/Kleinschreibung,
Umlauten (`ü`/`ue`), Trennzeichen und Zusatztext. Über das Kind hängt die
Zuordnung automatisch an der verknüpften E-Mail – die Familie sieht das Foto
also sofort.

- Mehrdeutige Treffer (z. B. ein Vorname, der auf **mehrere Kinder** passt, oder
  nur ein gemeinsamer Nachname) bleiben **bewusst unzugeordnet** und müssen
  manuell gesetzt werden.
- Wurden Kinder erst **nach** dem Upload importiert (oder der Dateiname enthielt
  zunächst nur den Vornamen): im Event den Button **„Vorhandene Fotos
  automatisch zuordnen (nach Dateiname)“** nutzen. Die Rückmeldung zeigt, wie
  viele Fotos zugeordnet, mehrdeutig oder ohne Treffer geblieben sind.

> Empfohlener Ablauf: Event anlegen → **Import** (E-Mails + Kinder) → Fotos mit
> sprechenden Dateinamen hochladen → kurz prüfen → Event veröffentlichen.

### Prüfschritt vor Veröffentlichung (empfohlen)
Bevor du ein Event auf „published“ setzt:
- Stimmt jede Zuordnung (Kind ↔ Foto, E-Mail ↔ Kind)?
- Sind nur die gewünschten Fotos im Event (nicht gewünschte löschen/deaktivieren)?
- Sind Previews korrekt mit Wasserzeichen erzeugt (Thumbnails im Admin sichtbar)?

## 6.2 Statuswerte (wie im Konzept)

- **Fotos:** hochgeladen → verarbeitet → zugeordnet · (deaktiviert)
- **E-Mails:** angelegt → nicht verifiziert → Verifizierung gesendet → verifiziert · (deaktiviert / Support)
- **Bestellungen (vereinfacht):** **Pendent** (Bestellung mit Druck, muss noch
  versendet werden – automatisch) · **Abgeschlossen** (digitale Bestellung bezahlt
  oder Druck manuell als erledigt markiert) · **Storniert** (nur manuell).
  „Warenkorb“ / „Kauf gestartet“ sind nur interne Zwischenzustände des Kaufflusses.
- **Events:** Entwurf → in Bearbeitung → bereit → veröffentlicht → archiviert · (deaktiviert)

## 6.3 Supportfälle

- **Falsche/alte E-Mail:** E-Mail-Detailseite → Adresse korrigieren oder Status
  auf „Support nötig“. Bei Bedarf neue Bestätigung auslösen.
- **Mehrere Eltern (Mutter+Vater):** beide Adressen anlegen, beide mit demselben
  Kind verknüpfen. Am schnellsten geht das auf der E-Mail-Detailseite („Verwalten“)
  über **„+ Weitere E-Mail-Adresse hinzufügen“** – die neue Adresse wird automatisch
  mit denselben Kindern verknüpft. Beim Import lassen sich mehrere Adressen direkt
  erfassen (Komma-getrennt in einer Spalte oder über eine zweite `E-Mail`-Spalte).
- **Mehrere Kinder:** eine Adresse mit mehreren Kindern verknüpfen.
- **Falsch zugeordnetes Foto:** Zuordnung ändern oder Foto deaktivieren/löschen.
- **Eltern finden keine Fotos:** prüfen, ob (a) Adresse exakt stimmt, (b) Kind
  verknüpft, (c) Foto nicht deaktiviert, (d) Event „published“.
- **Meldungen der Eltern:** Adminbereich → „Meldungen“ (Status pflegen).

## 6.4 Aufbewahrung (Standard 30 Tage)

- Jedes Event hat ein `expires_at` (Standard 30 Tage ab Anlage,
  über `GALLERY_RETENTION_DAYS` global steuerbar, pro Event editierbar).
- Nach Ablauf sind die Fotos für Eltern **nicht mehr sichtbar/kaufbar**
  (`expires_at` wird in der Zugriffslogik geprüft).
- Endgültiges Löschen (Datensparsamkeit): Event im Adminbereich löschen – das
  entfernt Fotos **inklusive aller Varianten** vom QNAP. Für ein automatisiertes
  Löschen kannst du einen QNAP-Cronjob anlegen, der alte Events per API entfernt
  (oder du löschst manuell nach Ablauf).

## 6.5 Backups

- Sichere den `data/`-Ordner (alle **Fotos**), z. B. mit QNAP **Hybrid Backup
  Sync**.
- Sichere die **Firestore-Datenbank** (Zuordnungen, E-Mails, Bestellungen,
  Meldungen) über die Firebase Console oder `gcloud firestore export gs://<bucket>`.
  Details in [docs/08-firebase.md](08-firebase.md).

## 6.6 Logs & Neustart

```bash
docker compose logs -f backend          # Live-Logs
docker compose restart backend          # Neustart
docker compose up -d --build backend    # Update + Neustart
docker compose ps                        # Status
```

## 6.7 Troubleshooting

| Symptom | Ursache / Lösung |
|---|---|
| Admin-Login: „Failed to fetch“ | `VITE_API_BASE_URL` falsch oder API nicht über HTTPS erreichbar. `curl https://api.alae.app/health` testen. |
| CORS-Fehler im Browser | `PUBLIC_APP_URL` muss exakt `https://photographic.alae.app` sein (inkl. https, ohne Slash am Ende); die rohe Netlify-URL gehört in `EXTRA_CORS_ORIGINS`. |
| Eltern bleiben nicht eingeloggt | Cookies blockiert. Mit API auf `api.alae.app`: `COOKIE_SECURE=true`, `COOKIE_SAMESITE=lax`, `COOKIE_DOMAIN=.alae.app`. Liegt die API auf anderer Domain: `COOKIE_SAMESITE=none`, `COOKIE_DOMAIN` leer. |
| Firebase-Login `auth/unauthorized-continue-uri` | App-Domain fehlt in Firebase → **Authentication → Settings → Authorized domains**: `photographic.alae.app` und `creartphotographic.netlify.app` eintragen. |
| Keine E-Mail kommt an | SMTP-Daten prüfen; im Log steht `mail: DEV LOG ONLY`, wenn `SMTP_HOST` fehlt. Spam-Ordner/SPF/DKIM prüfen. Unbekannte Adressen erhalten bewusst keine Mail. |
| Admin-Passwort gilt nach einem Neustart/Tag wieder nicht | War ein **früherer** Fehler: Beim Start wurde das Passwort des Admins aus `ADMIN_PASSWORD`/`ADMIN_PASSWORD_HASH` der `.env` **bei jedem** Container-Start überschrieben. Da Watchtower automatisch neu deployt, fiel ein per Reset gesetztes Passwort beim nächsten Neustart auf den `.env`-Wert zurück. **Behoben:** Die `.env`-Werte seeden den Admin jetzt nur noch beim **Erststart**; ein im Adminbereich (Konto → „Passwort ändern“) oder per „Passwort vergessen“ gesetztes Passwort bleibt dauerhaft erhalten. Du musst dafür nichts tun – nur das Backend einmal auf die neue Version aktualisieren. |
| Admin „Passwort vergessen“ funktioniert nicht | (1) `ADMIN_EMAIL` in `.env` setzen und Backend neu starten – die Adresse wird normalisiert am Admin-Konto hinterlegt (Login per E-Mail wird möglich). (2) Ohne SMTP wird die Reset-Mail nur ins Log geschrieben (`mail: DEV LOG ONLY`) → SMTP einrichten ([docs/04-email-smtp.md](04-email-smtp.md)). (3) **Bequem & ohne E-Mail:** Im Adminbereich anmelden → **Konto** → **„Passwort ändern“**. (4) **Sofort & ohne Login (CLI):** `docker compose exec backend npm run create-admin -- admin "NeuesPasswort" deine@mail.tld` setzt Passwort **und** Admin-E-Mail direkt. |
| Komplett ausgesperrt (Passwort vergessen, kein SMTP, kein Shell-Zugriff) | In der `.env` `ADMIN_PASSWORD=NeuesPasswort` (oder `ADMIN_PASSWORD_HASH=…`) und `ADMIN_PASSWORD_RESET_ON_BOOT=true` setzen, Backend einmal neu starten. Das erzwingt einmalig das `.env`-Passwort für `ADMIN_USERNAME`. **Danach `ADMIN_PASSWORD_RESET_ON_BOOT=false` zurücksetzen**, sonst wird dein Passwort bei jedem Neustart wieder überschrieben. |
| Admin-Benutzername ändern (weg von „admin“) | Im Adminbereich anmelden → **Konto** in der Seitenleiste öffnen → Benutzername (und optional E-Mail) ändern und speichern. Anschließend funktioniert die Anmeldung mit dem neuen Benutzernamen **oder** der E-Mail-Adresse. Die Umbenennung bleibt auch nach einem Neustart erhalten; `ADMIN_USERNAME` greift nur beim Erststart (solange noch kein Admin existiert). |
| Weiteren Admin anlegen | Im Adminbereich anmelden → **Konto** → **„Weitere Administratoren“** → **„Neuen Admin anlegen“** (Benutzername, optional E-Mail, Passwort). Der neue Admin meldet sich mit eigenem Login an und kann sein Passwort selbst ändern. Alternativ per CLI: `docker compose exec backend npm run create-admin -- BENUTZERNAME "Passwort" mail@example.com`. |
| Upload schlägt fehl (große Datei) | `MAX_UPLOAD_MB` erhöhen; Cloudflare-Free begrenzt ~100 MB/Anfrage. |
| Previews ohne Wasserzeichen | Im Backend-Image fehlten Schriftarten – das Wasserzeichen wird als Text gerendert und bleibt ohne Font unsichtbar. Im aktuellen Image sind `fontconfig`, `fonts-dejavu-core`/`fonts-liberation` **und die Website-Schrift Kalam** (aus `backend/assets/fonts`) enthalten. Beim Start zeigt das Log `watermark : OK (fonts available)`; steht dort `BROKEN`, Image neu bauen/ziehen. Bereits ohne Wasserzeichen erzeugte Fotos neu hochladen (oder im Admin neu verarbeiten). |
| Wasserzeichen-Schrift ändern | Das Wasserzeichen nutzt standardmäßig die Website-Schrift „Kalam“. Über `IMG_WATERMARK_FONT_FAMILY` lässt sich die Schrift anpassen; die Schriftdatei muss dazu in `backend/assets/fonts` liegen (wird beim Image-Bau installiert). Die Fallbacks am Ende des Werts (`Liberation Sans`, `DejaVu Sans`, …) sollten stehen bleiben, damit das Wasserzeichen nie unsichtbar wird. |
| Foto erscheint bei Eltern nicht | Checkliste 6.3 „Eltern finden keine Fotos“. |
| Stripe-Bestellung bleibt „Kauf gestartet“ | Webhook fehlt/falsch. Endpoint `…/webhook/stripe` und `STRIPE_WEBHOOK_SECRET` prüfen. |

## 6.8 Admin-Konten & Passwörter verwalten

**Wie wird das Admin-Passwort gespeichert?** Als bcrypt-Hash in Firestore in der
Sammlung `admin_users` (Dokument-ID = Benutzername, Feld `password_hash`). Das
ist die **alleinige Quelle der Wahrheit**. Die Variablen `ADMIN_PASSWORD` /
`ADMIN_PASSWORD_HASH` aus der `.env` werden **nur beim allerersten Start**
verwendet, um das Konto anzulegen (Seed). Ein später gesetztes Passwort wird
**nicht** mehr von der `.env` überschrieben und übersteht jeden Neustart/Deploy.

**Passwort ändern (empfohlen):** Im Adminbereich anmelden → **Konto** →
**„Passwort ändern“**. Sofort gültig, kein E-Mail-Versand nötig.

**Login per E-Mail:** Du kannst dich wahlweise mit dem Benutzernamen **oder** mit
der im Konto hinterlegten E-Mail-Adresse anmelden. Trage dazu unter **Konto**
deine E-Mail ein (z. B. `vonallmenalain@gmail.com`).

**Weiteren Admin anlegen:** Adminbereich → **Konto** → **„Weitere
Administratoren“** → **„Neuen Admin anlegen“** (Benutzername, optional E-Mail,
Passwort). Jeder Admin ist gleichberechtigt, meldet sich mit eigenem Login an und
kann sein Passwort selbst ändern. Das eigene und das letzte verbleibende Konto
lassen sich nicht löschen. Alternativ per CLI auf dem Server:

```bash
docker compose exec backend npm run create-admin -- BENUTZERNAME "Passwort" mail@example.com
```

**Notfall (ausgesperrt):** Siehe Troubleshooting – `ADMIN_PASSWORD` +
`ADMIN_PASSWORD_RESET_ON_BOOT=true` setzen, einmal neu starten, danach den
Schalter wieder auf `false`.

## 6.9 Sicherheits-Checkliste (vor Go-Live)

- [ ] Eigene, lange `JWT_SECRET` und `FILE_TOKEN_SECRET` gesetzt.
- [ ] Admin-Passwort gesetzt (Erst-Seed per `ADMIN_PASSWORD_HASH`, danach im
      Adminbereich änderbar). `ADMIN_PASSWORD_RESET_ON_BOOT=false`.
- [ ] HTTPS überall (Netlify + Cloudflare) – erfüllt.
- [ ] `PUBLIC_APP_URL` korrekt → CORS dicht.
- [ ] SMTP mit SPF/DKIM für zuverlässige, seriöse E-Mails.
- [ ] Backups des `data/`-Ordners eingerichtet.
- [ ] Testdurchlauf: anlegen → hochladen → zuordnen → veröffentlichen →
      verifizieren → kaufen → herunterladen.

➡️ Fachlicher Abgleich mit dem Konzept: **[7. Konzept-Abgleich](07-konzept-abgleich.md)**.
