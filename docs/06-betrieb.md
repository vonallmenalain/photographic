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
  „Warenkorb“ / „Kauf gestartet“ sind nur interne Zwischenzustände des Kaufflusses
  und erscheinen weder bei den Eltern noch im Adminbereich. Der Warenkorb bleibt
  während des ganzen Bezahlvorgangs bestehen: „Zur Zahlung“ legt eine Kopie als
  Bestellung an, und erst die erfolgreiche Zahlung räumt die gekauften Zeilen aus
  dem Warenkorb. Bricht jemand auf der Bezahlseite ab, bleibt sein Warenkorb also
  unverändert; der nie bezahlte „Kauf gestartet“ wird nach 7 Tagen automatisch
  entfernt. Der Status blendet eine Bestellung nie aus – auch „Storniert“ nicht.
  Soll eine Bestellung wirklich verschwinden (typisch: eine Testbestellung aus
  der Stripe-Sandbox), wird sie in der Übersicht gelöscht (6.2a).
- **Events:** Entwurf → in Bearbeitung → bereit → veröffentlicht → archiviert · (deaktiviert)

## 6.2a Bestellungen nach Auftrag (Schule/Klasse)

Der Menüpunkt **„Bestellungen“** fasst alle bestätigten Bestellungen zu **einer
Kachel je Auftrag** zusammen – also je Schule bzw. Klasse. Eine Bestellung trägt
selbst keinen Auftrag; er wird aus den bestellten Fotos abgeleitet.

- **Kopf der Kachel:** Auftragsname, Anzahl pendenter Bestellungen sowie
  Bestellungen gesamt, Bestellungen mit Druck, Umsatz (ohne stornierte) und das
  Datum der neuesten Bestellung. Ein Klick auf die Kachel klappt die
  Bestellungen des Auftrags auf bzw. zu; **„Alle Aufträge einklappen“** schliesst
  alle auf einmal und liefert so eine kompakte Übersicht.
- **Suchen:** Freitext über Auftrag/Schule, E-Mail-Adresse, Kind und Produkt.
  Mehrere Wörter werden einzeln gesucht („müller anna“ findet auch „Anna Müller“).
- **Nur einen Auftrag anzeigen:** über die Auswahlliste neben der Suche. Die
  Kachel des gewählten Auftrags klappt dabei automatisch auf.
- **Sortierung der Kacheln:** neueste Bestellung, Auftrag A–Z, meiste
  Bestellungen oder höchster Umsatz.
- **Statusfilter:** „Alle“, „Nur mit Druck“ und „Pendent“; die Zahlen beziehen
  sich immer auf die aktuelle Such-/Auftragsauswahl.
- Suche, Auftragsauswahl, Sortierung und eingeklappte Kacheln bleiben für die
  Dauer der Sitzung erhalten.
- Bestellungen, deren Fotos zu keinem Auftrag mehr gehören (z. B. nach dem
  Löschen eines Auftrags), sammelt die Kachel **„Ohne Auftrag“** am Schluss.
- **Bestellung löschen:** Rechts bei jeder Bestellung steht **„Löschen“**. Damit
  verschwindet sie endgültig – aus der Übersicht, aus dem Umsatz und aus den
  Auswertungen. Gedacht ist das vor allem für Testbestellungen, die nach dem
  Go-Live nicht stehen bleiben sollen; ein Status („Abgeschlossen“, „Storniert“)
  blendet eine Bestellung ja nicht aus. Mitgelöscht werden die Bestellpositionen
  und die Download-Freigaben: bereits gekaufte Digitalfotos kann die betroffene
  Adresse danach nicht mehr herunterladen. Fotos, Kinder und E-Mail-Adressen
  bleiben unverändert bestehen. Ein Popup fragt vorher nach – rückgängig machen
  lässt sich das Löschen nicht.
- Enthält eine Bestellung ausnahmsweise Fotos aus mehreren Aufträgen, steht sie
  beim Auftrag mit den meisten Positionen; die übrigen Aufträge sind in der
  Bestellung als Hinweis vermerkt.

## 6.3 Supportfälle

- **Falsche/alte E-Mail:** E-Mail-Detailseite → Adresse korrigieren oder Status
  auf „Support nötig“. Bei Bedarf neue Bestätigung auslösen.
- **Mehrere Eltern (Mutter+Vater):** beide Adressen anlegen, beide mit demselben
  Kind verknüpfen. Am schnellsten geht das auf der E-Mail-Detailseite („Verwalten“)
  über **„+ Weitere E-Mail-Adresse hinzufügen“** – die neue Adresse wird automatisch
  mit denselben Kindern verknüpft. Beim Import lassen sich mehrere Adressen direkt
  erfassen (Komma-getrennt in einer Spalte oder über eine zweite `E-Mail`-Spalte).
- **Mehrere Kinder:** eine Adresse mit mehreren Kindern verknüpfen.
- **Falsch zugeordnetes Foto:** Adminbereich → **Aufträge** → beim Auftrag auf **„Bearbeiten“** klicken. Im Popup lässt sich jedes Foto direkt in der Kachel einem anderen Kind zuordnen, als Gruppenfoto markieren, **deaktivieren** (für Eltern ausgeblendet, Datei und Bestellungen bleiben erhalten), wieder aktivieren oder endgültig löschen. Bereits bestellte Fotos sind mit „Bestellt ×n“ markiert und werden vor dem Deaktivieren/Löschen extra bestätigt.
- **Fotos nachträglich ergänzen:** ebenfalls über **Aufträge → „Bearbeiten“**: oben „Fotos hinzufügen“ (Zuordnung automatisch nach Dateiname, zu einem gewählten Kind oder als Gruppenfoto) oder direkt beim Kind über **„+ Fotos“**. Der Auftrag bleibt dabei veröffentlicht – die Änderungen sind für die Eltern sofort sichtbar.
- **E-Mail-Adresse nachträglich hinzufügen oder korrigieren (im Auftrag):** ebenfalls über **Aufträge → „Bearbeiten“**. Beim Kind steht neben „+ Fotos“ der Knopf **„+ E-Mail-Adresse“** – z. B. für einen zweiten Elternteil. Existiert die Adresse schon (etwa vom Geschwisterkind), wird sie übernommen und nur mit diesem Kind verknüpft; bei einem veröffentlichten Auftrag kann die Einladung sofort mitgeschickt werden. Neben jeder Adresse: **✎** korrigiert eine falsch geschriebene Adresse an Ort und Stelle (die Bestätigung wird dabei zurückgesetzt, die Eltern bestätigen die neue Adresse einmal neu – Einladung danach gezielt an diese Adresse senden), **×** entfernt die Verknüpfung mit diesem Kind (die Adresse selbst bleibt bestehen). Adressen, an die die letzte E-Mail nicht zugestellt werden konnte, sind rot mit **„Nicht zustellbar“** markiert (siehe 6.11).
- **Eltern finden keine Fotos:** prüfen, ob (a) Adresse exakt stimmt, (b) Kind
  verknüpft, (c) Foto nicht deaktiviert, (d) Event „published“.
- **Meldungen der Eltern:** Adminbereich → „Meldungen“ (Status pflegen). Oben auf
  der Seite lässt sich einstellen, dass bei **jeder neuen Meldung sofort eine
  E-Mail** an dich geht (mit Anliegen, Nachricht und Absenderadresse; „Antworten“
  im Postfach schreibt direkt an die Eltern). Die Zahl neben dem Menüpunkt
  „Meldungen“ zählt offene Meldungen und offene Zustellprobleme.

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
| Previews ohne Wasserzeichen | Im Backend-Image fehlten Schriftarten – das Wasserzeichen wird als Text gerendert und bleibt ohne Font unsichtbar. Im aktuellen Image sind `fontconfig`, `fonts-dejavu-core`/`fonts-liberation` **und die Schrift Comic Neue** (freie Schwester von Comic Sans MS, aus `backend/assets/fonts`) enthalten. Beim Start zeigt das Log `watermark : OK (fonts available)`; steht dort `BROKEN`, Image neu bauen/ziehen. Bereits ohne Wasserzeichen erzeugte Fotos neu hochladen (oder im Admin neu verarbeiten). |
| Wasserzeichen-Schrift ändern | Die Website nutzt überall **Comic Sans MS**. Da diese Schrift proprietär ist und nicht mitgeliefert werden darf, rendert das Backend das Wasserzeichen mit der freien, sehr ähnlichen **Comic Neue** (`backend/assets/fonts`). Legst du eine lizenzierte `Comic Sans MS`-TTF in `backend/assets/fonts` und baust das Image neu, wird sie automatisch verwendet (sie steht in `IMG_WATERMARK_FONT_FAMILY` an erster Stelle). Die Fallbacks am Ende des Werts (`Liberation Sans`, `DejaVu Sans`, …) sollten stehen bleiben, damit das Wasserzeichen nie unsichtbar wird. |
| Foto erscheint bei Eltern nicht | Checkliste 6.3 „Eltern finden keine Fotos“. |
| E-Mail an eine Familie kommt nicht an (in Resend „Bounced“) | Adminbereich → **Meldungen → Nicht zustellbare E-Mails**: dort stehen Empfänger, Betreff und Begründung, die Adresse ist im Auftrag rot markiert. Adresse unter **Aufträge → „Bearbeiten“** beim Kind mit ✎ korrigieren und die Einladung erneut an diese Adresse senden. Voraussetzung ist der eingerichtete Resend-Webhook ([docs/04-email-smtp.md, 4.6](04-email-smtp.md)); ohne ihn steht nur in Resend, dass die E-Mail nicht ankam. |
| Antworten der Eltern auf Einladungen/Bestätigungen verschwinden | Antworten gehen an die **Kontakt-E-Mail-Adresse** aus **Einstellungen** (Reply-To). Ist dort nichts eingetragen, landen sie beim `no-reply`-Absender. Adresse eintragen und die Weiterleitung bei Cloudflare einrichten ([docs/04-email-smtp.md, 4.7](04-email-smtp.md)). |
| Stripe-Bestellung bleibt „Kauf gestartet“ | Webhook fehlt/falsch. Endpoint `…/webhook/stripe` und `STRIPE_WEBHOOK_SECRET` prüfen. Nach dem Wechsel Sandbox → Live muss der Webhook **im Live-Modus neu** angelegt werden (eigenes `whsec_…`) – siehe [docs/05-stripe.md, 5.6](05-stripe.md#56-von-der-sandbox-in-den-produktivmodus-wechseln-go-live). |
| Zahlungen kommen nie auf dem Konto an | Es läuft noch der Sandbox-Schlüssel. `docker compose logs backend` zeigt dann `[server] stripe : TEST/Sandbox …`; erwartet wird `LIVE (CHF) – real payments, webhook configured`. Umstellung: [docs/05-stripe.md, 5.6](05-stripe.md#56-von-der-sandbox-in-den-produktivmodus-wechseln-go-live). |

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

## 6.10 Produkte & Preise

Das Sortiment (Sammlung `products` in Firestore) wird beim Start des Backends
aus `backend/src/services/products.ts` eingespielt – **einmal pro Katalog-
Version** (Marker `settings/product_catalog`). Spätere Änderungen an einzelnen
Produkten über die Admin-API (`PATCH /api/admin/products/:id`) bleiben also
erhalten. Aktueller Katalog:

| Produkt | Preis | Jedes weitere (gleiches Foto) | Digitale Datei | Erhältlich für |
|---|---|---|---|---|
| Druck 13×18 cm | 15.- CHF | +4.- CHF | **inbegriffen** | Einzel- und Gruppenfotos |
| Druck 20×30 cm | 17.- CHF | +7.- CHF | **inbegriffen** | Einzel- und Gruppenfotos |
| Nur digital (Download) | 13.- CHF | – (nur 1× pro Foto) | – | Einzel- und Gruppenfotos |
| Sticker-Bogen (16 Stück, 3×4 cm) | 11.- CHF pro Bogen | 11.- CHF | nein | nur Einzelfotos |
| Magnete-Set (3 Stück, 5×5 cm) | 13.- CHF pro Set | 13.- CHF | nein | nur Einzelfotos |

Dazu kommt die **Versandpauschale** (Standard **3.50 CHF**, änderbar unter
**Einstellungen**): Sie fällt **einmal pro Bestellung** an, sobald mindestens
ein gedrucktes Produkt (Druck, Sticker, Magnete) enthalten ist – unabhängig von
der Anzahl. Rein digitale Bestellungen sind versandfrei. Die Pauschale wird
schon in der Galerie bei jedem gedruckten Produkt genannt („+ 3.50 Versand pro
Bestellung“), im Warenkorb als eigene Zeile (Zwischensumme / Versand per Post /
Gesamt) ausgewiesen, auf der Stripe-Bezahlseite als Position „Versand per Post“
aufgeführt und in der Bestellbestätigung, den Bestelldetails und im Impressum
genannt. Jede Bestellung speichert Zwischensumme, Versandpauschale und
Gesamtbetrag; Umsatzzahlen im Adminbereich enthalten das Porto (dem Auftrag mit
den meisten Positionen der Bestellung zugerechnet).

So funktioniert die Preislogik:

- **Staffelpreis pro Foto und Produkt:** Das erste Stück einer Position (z. B.
  „Druck 13×18 cm“ von Foto A) kostet den Grundpreis, jedes weitere Stück
  **derselben Position** den Zusatzpreis. 3× 13×18 von Foto A = 15 + 4 + 4 =
  23.- CHF. Ein weiteres Foto (Foto B) beginnt wieder beim Grundpreis, weil auch
  dessen digitale Datei inbegriffen ist.
- **Digitale Datei inbegriffen:** Bei jedem Druck (13×18 / 20×30) wird mit der
  Zahlung derselbe Download freigeschaltet wie bei „Nur digital“. Legt eine
  Familie einen Druck in den Warenkorb, wird ein bereits vorhandener separater
  Download desselben Fotos automatisch entfernt; umgekehrt lässt sich „Nur
  digital“ nicht mehr hinzufügen, wenn ein Druck des Fotos im Warenkorb liegt.
  In der Galerie ist diese Option dann ausgegraut. Sticker und Magnete enthalten
  **keine** digitale Datei.
- **Produkt-Vorschauen:** Wählen Eltern Sticker oder Magnete, zeigt die App
  eine Vorschau des fertigen Produkts mit dem eigenen Foto – rein im Browser aus
  dem **mit Wasserzeichen geschützten** Vorschaubild gebaut (es wird kein
  neues Bild erzeugt).
- Jede Bestellposition speichert Grundpreis, Zusatzpreis, Positionstotal und
  Produktart als Momentaufnahme; spätere Preisänderungen ändern alte
  Bestellungen nicht.

Preise oder Namen ändern: Werte in `backend/src/services/products.ts` anpassen
und `PRODUCT_CATALOG_VERSION` um 1 erhöhen – beim nächsten Start wird der
Katalog einmalig neu eingespielt. Alternativ einzelne Produkte per Admin-API
(`GET/POST/PATCH /api/admin/products`) pflegen (Felder: `name`, `price_cents`,
`additional_price_cents`, `kind`, `includes_digital`, `scope`, `active`).

## 6.11 Einstellungen, Kontaktadresse und Zustellprobleme

Der Menüpunkt **Einstellungen** bündelt, was früher nur in der `.env` stand:

- **Kontakt-E-Mail-Adresse** (z. B. `photographic@alae.app`): steht im
  Impressum und auf der Hilfe-Seite anstelle einer Telefonnummer und ist die
  Antwortadresse aller E-Mails an Eltern. Damit E-Mails an diese Adresse in
  einem Postfach ankommen, ist einmalig eine Weiterleitung bei Cloudflare nötig –
  die Schritte stehen direkt auf der Seite und in
  [docs/04-email-smtp.md, 4.7](04-email-smtp.md).
- **Versandpauschale** für gedruckte Produkte (siehe 6.10).

Die **Benachrichtigungen** (neue Meldung, Zustellproblem) werden unter
**Meldungen** eingestellt – jeweils mit Ein-/Ausschalter und Empfängerliste
(leer = alle Admin-Konten mit E-Mail-Adresse).

**Nicht zustellbare E-Mails** (unter „Meldungen“): Ist der Resend-Webhook
eingerichtet ([docs/04-email-smtp.md, 4.6](04-email-smtp.md)), meldet Resend
jede E-Mail, die nicht zugestellt werden konnte (Bounce, Spam-Beschwerde,
Fehlschlag). Die Liste zeigt Empfänger, Betreff, Zeitpunkt und Begründung; die
betroffene Eltern-Adresse ist überall rot mit **„Nicht zustellbar“** markiert.
Mit **„Erledigt“** wird ein Problem geschlossen (die Markierung verschwindet);
eine korrigierte Adresse oder eine spätere erfolgreiche Zustellung an dieselbe
Adresse hebt die Markierung ebenfalls auf. Ohne Webhook erfasst die App nur
Fehler, die der Mailserver schon beim Versand meldet. „Alle protokollierten
E-Mails“ zeigt auch die erfolgreich zugestellten; Einträge älter als 90 Tage
werden automatisch aufgeräumt.

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
- [ ] Falls mit Stripe bezahlt wird: Live-Schlüssel **und** Live-Webhook gesetzt,
      Log zeigt `stripe : LIVE (CHF) – real payments, webhook configured`
      ([docs/05-stripe.md, 5.6](05-stripe.md#56-von-der-sandbox-in-den-produktivmodus-wechseln-go-live)).

➡️ Fachlicher Abgleich mit dem Konzept: **[7. Konzept-Abgleich](07-konzept-abgleich.md)**.
