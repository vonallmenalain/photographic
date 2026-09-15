# 10. Klassenerfassung & Einverständniserklärung

Die Klassenerfassung ist die **Vorstufe eines Auftrags**: Die Klassenliste
entsteht vor dem Fototermin online, die Eltern bestätigen ihre E-Mail-Adresse
selbst und geben dabei ihr Einverständnis zur Fotografie ab. Der Fotograf
entscheidet beim Anlegen, welche Wege offenstehen; die Übernahme in den
Auftrag ist danach ein einziger Klick.

## 10.1 Ablauf in Kürze

| Schritt | Wer | Was passiert |
|---|---|---|
| 1 | Fotograf | Adminbereich → **Aufträge erfassen** → **Klasse erfassen lassen**: Schule, Fototermin, Rückmeldefrist, Klassen mit Lehrpersonen, Optionen (siehe 10.2). Jede Klasse wird ein Auftrag im Status **„Erfassung“**. Die Lehrperson erhält ihren persönlichen Link per E-Mail. |
| 2 | Lehrperson | Klick auf den Link → **Klassenseite** (`/klasse/<Auftrag>`). Kindernamen eintragen (Vor- und Nachname, ein Name pro Zeile). |
| 3 | Lehrperson | Eltern erreichen: **Klassenlink/QR-Code** weitergeben (Elternbrief, Klassen-App) und/oder **E-Mail-Adressen erfassen** (Kind; E-Mail), worauf die App die Eltern einlädt. |
| 4 | Eltern | Über den Klassenlink (`/k/<Token>`): E-Mail-Adresse, Kind, Häkchen „erziehungsberechtigt“ → Bestätigungs-Mail → **Einverständnis-Formular** (`/einverstaendnis`). Über die Einladung: ein Klick, das Kind ist vorausgewählt. Bestätigungs-Mail mit der Antwort. |
| 5 | Lehrperson / Fotograf | Stand je Kind: erteilt, nur Klassenfoto, nur Einzelfotos, nein, eingeladen ohne Antwort, ohne E-Mail-Adresse. Erinnerung an alle Ausstehenden mit einem Klick (Lehrperson höchstens einmal je 24 Stunden). Lehrperson meldet „vollständig“. |
| 6 | Fotograf | **In Auftrag übernehmen** → Klassenlink und Formular schliessen, Status „In Bearbeitung“, weiter im Assistenten bei „Fotos hochladen“. Liste für den Fototermin als CSV oder Druck. |

Die vier Antworten der Eltern (in Anlehnung an das Papierformular der Schulen):

| Antwort | Bedeutung für den Fototermin |
|---|---|
| Ja, alles | Klassenfoto und Einzelfotos |
| Nur Klassenfoto | keine Einzelfotos |
| Nur Einzelfotos | nicht aufs Klassenfoto |
| Nein | gar nicht fotografieren |

Antworten beide Elternteile unterschiedlich, gilt die **vorsichtigere** Antwort
(Klassenfoto nur, wenn beide es erlauben; Einzelfotos nur, wenn beide sie
erlauben). Das Kind erscheint zusätzlich mit dem Hinweis „Widerspruch“.

## 10.2 Optionen beim Anlegen

| Option | Wirkung |
|---|---|
| **Klassenlink mit QR-Code** | Eltern tragen sich selbst ein. Die Lehrperson sieht **keine** E-Mail-Adressen (maskiert), Erinnerungen verschickt die App. |
| **Lehrperson erfasst die E-Mail-Adressen** | Die Lehrperson trägt Kind + E-Mail-Adresse ein, die App lädt die Eltern ein. Die Lehrperson sieht dadurch die E-Mail-Adressen ihrer Klasse. |
| **Einverständnis über die App** | Aus, wenn die Schule das Einverständnis auf Papier einholt; dann dient die Erfassung nur der Klassenliste. |
| **Automatische Erinnerung** | Standardmässig aus. Wenn an: einmalig X Tage vor der Rückmeldefrist an alle Eltern, deren Kind noch keine Antwort hat. |
| **Lehrperson** | Optional. Ohne Lehrperson erfasst der Fotograf die Klasse selbst (Kinder eintragen, QR-Zettel drucken). Alles, was die Lehrperson kann, kann der Fotograf in der Erfassungsansicht ebenfalls. |

Mehrere Klassen einer Schule lassen sich in einem Schritt anlegen (eine Zeile
je Klasse: `Klasse; E-Mail Lehrperson; Name Lehrperson`).

## 10.3 Was wer sieht (Sicherheit)

- **Alles läuft über das Backend.** Keine neuen Firestore-Zugriffe aus dem
  Browser; die Firestore-Regeln bleiben gesperrt.
- **Eine Identität, abgeleitete Rollen.** Lehrperson und Eltern melden sich wie
  bisher mit bestätigter E-Mail-Adresse an (kein Passwort). „Lehrperson“ ist
  kein Konto, sondern die am Auftrag eingetragene E-Mail-Adresse: nur sie sieht
  die Klassenseite. Trägt der Fotograf eine andere E-Mail-Adresse ein, ist der
  Zugriff sofort
  weg und der alte Link ungültig.
- **Eltern sehen nur sich.** Das Einverständnis-Formular liefert ausschliesslich
  die eigenen Kinder und die eigene Antwort. Die Klassenliste, Statusangaben oder
  fremde E-Mail-Adressen sind für Eltern nie erreichbar. Der Klassenlink zeigt keine
  Namen: Die Eltern **tippen** den Namen ihres Kindes; der Server gleicht ihn mit
  der Liste der Lehrperson ab (gleicher Name, alle getippten Namensteile passen
  auf genau ein Kind, oder umgekehrt). Ohne eindeutigen Treffer entsteht ein
  Eintrag „von Eltern ergänzt“, den die Lehrperson bestätigt oder mit dem
  richtigen Kind zusammenführt.
- **Lehrpersonen sehen keine E-Mail-Adressen**, ausser sie erfassen sie selbst (Option
  oben). Keine Fotos, keine Bestellungen, keine anderen Klassen, keine Exporte.
- **Links sind Geheimnisse.** Lehrpersonen-Link, Einladungslinks und
  Bestätigungslinks sind zufällige, **einmalig** einlösbare Token mit Ablaufdatum
  (Lehrperson 30 Tage, Einladung 60 Tage, Selbstregistrierung 48 Stunden). Der
  Klassenlink ist ein zufälliger Token, der jederzeit neu erzeugt werden kann,
  falls er ausserhalb der Klasse landet. Nach dem einmaligen Klick genügt die
  normale Anmeldung mit der E-Mail-Adresse; die App leitet automatisch zur
  Klassenseite bzw. zum Einverständnis.
- **Keine Rückschlüsse für Aussenstehende.** Die Klassenlink-Seite antwortet
  immer gleich, egal ob eine E-Mail-Adresse schon bekannt ist. Registrierung, Formular
  und Klassenseite sind mit Rate-Limits geschützt; eine Klasse fasst höchstens
  80 Kinder.
- **Nachweisbares Einverständnis.** Jede Antwort wird als eigener,
  unveränderlicher Datensatz gespeichert (Kind, E-Mail-Adresse, Antwort, Zeitpunkt,
  Version des Textes, Browser). Eine neue Antwort ersetzt die alte, der Verlauf
  bleibt sichtbar (Adminbereich → Erfassung → „Verlauf der Antworten“).
- **Datensparsamkeit und Löschung.** Gespeichert werden nur Name des Kindes,
  E-Mail-Adresse der Eltern (optional deren Name) und die Antwort. Einverständnisse
  hängen am Auftrag und werden mit ihm gelöscht.

## 10.4 Einverständnis-Text

Der Wortlaut steht unter **Einstellungen → Einverständniserklärung** und lässt
sich anpassen (Platzhalter `{Klasse}`, `{Schule}`, `{Datum}`, `{Tage}`).
Jede Antwort speichert die Version (Hash) des Textes, dem zugestimmt wurde; der
Wortlaut je Version liegt in der Sammlung `consent_texts`. Den Text mit der
Schule abstimmen oder prüfen lassen, bevor die erste Klasse angelegt wird.

## 10.5 Nach der Übernahme

- Der Auftrag steht auf „In Bearbeitung“ und öffnet sich im Assistenten bei
  Schritt 2 (Fotos). Kinder, E-Mail-Adressen und Verknüpfungen sind bereits da.
- Die Erfassungsansicht bleibt über „Einverständnisse“ in der Aufträge-Liste
  erreichbar (Liste, Verlauf, CSV, Druck). „Erfassung wieder öffnen“ lässt
  Nachzügler zu, solange der Auftrag nicht veröffentlicht ist.
- Kinder ohne Einverständnis bzw. mit „Nein“ bleiben in der Liste, damit am
  Fototermin klar ist, wer nicht fotografiert wird.

## 10.6 Automatische Erinnerungen

Beide sind je Auftrag einschaltbar und standardmässig **aus**:

- **Einverständnis:** X Tage vor der Rückmeldefrist an alle Eltern, deren Kind
  noch keine Antwort hat (Einstellung der Erfassung).
- **Bestellungen:** X Tage vor Ablauf der Bestellfrist an alle Eltern des
  Auftrags, die noch nichts bestellt haben (Aufträge → Auftrag aufklappen →
  „Einladungen & Erinnerungen“). Erneutes Einschalten setzt den Marker zurück,
  etwa nach einer verlängerten Bestellfrist.

Beide gehen genau einmal raus und werden als Erinnerung im Verlauf des Auftrags
protokolliert. Der Lauf startet beim Start des Backends und danach alle drei
Stunden.

## 10.7 Technik

- Status `collecting` („Erfassung“) vor `draft`; während der Erfassung gibt es
  keine Bestellfrist (`expires_at` bleibt leer, die Archivierung ignoriert den
  Status). Die Einstellungen liegen im Feld `registration` des Auftrags.
- Kinder tragen `source` (admin/teacher/parent), `needs_review` und die
  Zusammenfassung `consent_status`/`consent_conflict`.
- Sammlung `consents` (Entscheidungen) und `consent_texts` (Textversionen).
- Links sind `verification_tokens` mit `purpose` (`teacher`, `invite`,
  `register`), Zielseite `next` und optionalen Registrierungsangaben. Die normale
  Anmeldung macht nur Anmelde-Token ungültig, nicht diese Links.
- Routen: Eltern `/api/parent/registration/:token`, `/api/parent/consents…`;
  Lehrperson `/api/teacher/classes…`; Admin `/api/admin/registrations`,
  `/api/admin/events/:id/registration…`.
- Der QR-Code wird im Backend erzeugt (`qrcode`) und als SVG mitgeliefert.
