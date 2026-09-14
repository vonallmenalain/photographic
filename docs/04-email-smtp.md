# 4. E-Mail / SMTP (Codes, Magic-Links, Bestätigungen)

Die App verschickt:
- **Verifizierungscodes / Magic-Links** an Eltern,
- **Einladungen und Erinnerungen** je Auftrag („Ihre Fotos sind bereit“),
- **Bestellbestätigungen** und **Versandbestätigungen** nach dem Kauf,
- **Benachrichtigungen an dich** (neue Meldung aus „Hilfe & Kontakt“,
  nicht zustellbare E-Mail – siehe 4.8).

Alle E-Mails an Eltern tragen als Antwortadresse (Reply-To) die im Adminbereich
hinterlegte **Kontakt-E-Mail-Adresse** und nennen sie in der Fusszeile (4.7).

Ohne SMTP-Konfiguration läuft die App im **Entwicklungsmodus**: E-Mails werden
nur in die Backend-Logs geschrieben (praktisch zum Testen, **nicht** für den
Produktivbetrieb).

## 4.1 Welchen Anbieter nehmen?

Du brauchst SMTP-Zugangsdaten. Möglichkeiten:

- **Eigener Mailprovider / eigene Domain** (z. B. der Postausgang deines
  bestehenden Postfachs).
- **Transaktions-E-Mail-Dienste** (zuverlässige Zustellung): z. B. Brevo
  (Sendinblue), Mailjet, Postmark, Amazon SES, Resend. Viele haben ein
  kostenloses Kontingent.

Wichtig für gute Zustellbarkeit: Absenderdomain mit **SPF** und **DKIM**
einrichten (beim jeweiligen Anbieter dokumentiert).

## 4.2 Konfiguration in `.env`

```ini
SMTP_HOST=smtp.resend.com          # bei Resend; sonst der Host deines Anbieters
SMTP_PORT=587
SMTP_SECURE=false          # true nur bei Port 465 (SMTPS)
SMTP_USER=resend           # bei Resend immer "resend"
SMTP_PASS=re_xxx           # bei Resend: ein API-Key
MAIL_FROM=Foto-Galerie <no-reply@alae.app>
CONTACT_EMAIL=photographic@alae.app   # Startwert; im Adminbereich änderbar (4.7)
```

- `SMTP_PORT=587` mit `SMTP_SECURE=false` (STARTTLS) ist der Normalfall.
- `SMTP_PORT=465` erfordert `SMTP_SECURE=true`.
- `MAIL_FROM` ist nur der **Startwert** des Absenders. Massgebend ist, was im
  Adminbereich unter **Einstellungen → Absender der E-Mails** steht (siehe 4.9).
- `CONTACT_EMAIL` ist nur der Startwert der Kontaktadresse. Massgebend ist,
  was im Adminbereich unter **Einstellungen** steht.

Danach Backend neu starten:

```bash
docker compose up -d backend
```

Beim Start zeigt das Log statt `mail: DEV LOG ONLY` jetzt deinen `SMTP_HOST` an.

## 4.3 Test

1. In der Eltern-App eine **angelegte** E-Mail-Adresse eingeben (im Admin unter
   „E-Mail-Adressen“ vorher anlegen!).
2. Es sollte eine E-Mail mit 6-stelligem Code + Bestätigungsbutton ankommen.

> Erinnerung an die Sicherheits-Logik: Gibt jemand eine **unbekannte** Adresse
> ein, kommt **keine** E-Mail – die App zeigt aber trotzdem die neutrale Meldung
> „Falls diese E-Mail-Adresse freigeschaltet ist …“. Das ist gewollt (kein
> Verraten existierender Adressen).

## 4.4 Inhalt/Anpassung der E-Mails

Die Texte/Designs liegen in `backend/src/lib/email.ts` (deutsch, schlicht,
vertrauenswürdig). Dort kannst du Wortlaut, Absenderzeile und Logo/HTML anpassen.
Nach Änderungen: `docker compose up -d --build backend`.

## 4.5 Gültigkeitsdauer & Versuche

In `.env` einstellbar:

```ini
VERIFICATION_CODE_TTL_MINUTES=20   # wie lange ein Code gültig ist
VERIFICATION_MAX_ATTEMPTS=6        # Falscheingaben pro Code
PARENT_SESSION_TTL_DAYS=30         # wie lange der Browser sich erinnert
```

## 4.6 Zustellprobleme sehen (Resend-Webhook)

Ein SMTP-Server nimmt eine E-Mail entgegen und meldet erst **später**, ob sie
zugestellt werden konnte – die App erfährt davon nichts. Bei einer falsch
erfassten Adresse steht in Resend dann statt „Delivered“ ein **„Bounced“**.
Damit du dafür nicht regelmässig bei Resend nachschauen musst, kann Resend
jedes Zustellereignis per **Webhook** an die App melden. Die App

- zeigt nicht zustellbare E-Mails im Adminbereich unter **Einstellungen → Nicht
  zustellbare E-Mails** (Empfänger, Betreff, Zeitpunkt, Begründung),
- zählt sie neben dem Menüpunkt „Einstellungen“ mit,
- markiert die betroffene Eltern-Adresse überall rot mit **„Nicht zustellbar“**
  (im Auftrag unter „Bearbeiten“, in den Versand-Popups, auf der E-Mail-Seite),
- schickt dir auf Wunsch sofort eine **E-Mail** (4.8).

Ohne Webhook erfasst die App nur Fehler, die der Mailserver **schon beim
Versand** meldet (z. B. eine syntaktisch unmögliche Adresse). Einrichtung:

1. Resend-Dashboard → **Webhooks → Add Webhook**.
2. **Endpoint URL**: `https://api.alae.app/webhook/resend`
   (deine Cloudflare-Tunnel-Adresse + `/webhook/resend`).
3. **Events**: `email.sent`, `email.delivered`, `email.delivery_delayed`,
   `email.bounced`, `email.complained`, `email.failed`
   (Öffnungen/Klicks werden nicht ausgewertet).
4. Webhook speichern → das **Signing Secret** (`whsec_...`) kopieren.
5. Das Secret in der App hinterlegen – **nicht im Adminbereich**, sondern wie
   im nächsten Abschnitt beschrieben.

Ob der Webhook läuft, steht im Adminbereich unter **Einstellungen → Nicht
zustellbare E-Mails**: dort werden der Status und der Zeitpunkt des letzten
Ereignisses angezeigt. Nach der nächsten verschickten E-Mail muss ein Eintrag
erscheinen (auch erfolgreiche Zustellungen werden protokolliert; die Ansicht
„Alle protokollierten E-Mails“ zeigt sie). Im Server-Log erscheint beim Start
`mail status : Resend webhook configured (/webhook/resend)`.

### Signing Secret hinterlegen, ersetzen oder entfernen (Entwicklung)

**Warum das nicht im Adminbereich steht:** Der Webhook wird genau einmal
eingerichtet und danach nie wieder angefasst. Eine Bedienung dafür im
Adminbereich hätte nur einen Effekt: Irgendwann klickt jemand „Secret
entfernen“ – und ab dann meldet Resend keine Zustellprobleme mehr, ohne dass es
jemandem auffällt. Die Kachel „Resend-Webhook einrichten“ wurde deshalb aus dem
Adminbereich entfernt. Sichtbar bleibt dort nur noch der **Status** („Webhook
ist eingerichtet“ bzw. „nicht eingerichtet“), damit ein Ausfall auffällt.

Gespeichert wird das Secret weiterhin in den App-Einstellungen (Firestore,
Dokument `settings/app`, Feld `resend_webhook_secret`). Es gilt **sofort**, ein
Neustart des Containers ist nicht nötig. Zurückgeliefert wird es nie – die API
sagt nur, *ob* eines hinterlegt ist und woher (`settings` = App-Einstellungen,
`env` = `.env`, `none` = keines).

#### Weg A: über die Admin-API (empfohlen, kein Server-Zugriff nötig)

Der Endpunkt `PUT /api/admin/settings` nimmt das Secret weiterhin entgegen.
Nötig sind nur Benutzername und Passwort eines Admin-Kontos:

```bash
# 1. Admin-Token holen (gilt 12 Stunden)
curl -s -X POST https://api.alae.app/api/admin/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"DEIN-ADMIN-PASSWORT"}'
# -> {"token":"eyJhbGciOi...","username":"admin"}

# 2. Signing Secret setzen oder ersetzen
curl -s -X PUT https://api.alae.app/api/admin/settings \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer eyJhbGciOi...' \
  -d '{"resend_webhook_secret":"whsec_XXXXXXXXXXXX"}'

# 3. Kontrolle: was ist jetzt hinterlegt?
curl -s https://api.alae.app/api/admin/settings \
  -H 'Authorization: Bearer eyJhbGciOi...'
# -> "resend_webhook_secret_set": true, "resend_webhook_secret_source": "settings"
```

Zum **Entfernen** in Schritt 2 einen Leerstring senden:
`-d '{"resend_webhook_secret":""}'`. Danach weist die App eingehende Webhooks
mit `400 Resend webhook not configured` ab.

Hinweise:

- Das Secret muss mit `whsec_` beginnen; sonst antwortet die API mit
  `400` und einer Erklärung (Schutz gegen den verwechselten API-Key `re_…`).
- Andere Einstellungen bleiben unverändert – der Endpunkt schreibt nur die
  mitgeschickten Felder.
- Im Audit-Log steht nur `<gesetzt>` bzw. `<entfernt>`, nie das Secret selbst.
- Lokal statt `https://api.alae.app` einfach `http://localhost:4000` verwenden.

#### Weg B: über die Firebase-Konsole

Firestore → Sammlung `settings` → Dokument `app` → Feld
`resend_webhook_secret` (String) setzen oder leeren. Wirkt spätestens nach
30 Sekunden (so lange hält das Backend die Einstellungen im Cache).

#### Weg C: über die `.env` (nur beim Erstaufbau)

`RESEND_WEBHOOK_SECRET=whsec_xxx` in der `.env` setzen und den Container neu
**erstellen** – ein blosser Neustart liest die `.env` nicht neu.

> **Stolperstein:** Die App-Einstellungen haben Vorrang vor der `.env`, und zwar
> auch dann, wenn dort ausdrücklich ein **leerer** Wert steht (so wirkte früher
> das inzwischen entfernte „Secret entfernen“). Ein leeres
> `resend_webhook_secret` im Dokument `settings/app` bedeutet „entfernt“ und
> übersteuert die `.env`. Nur ein **fehlendes** Feld lässt den Startwert aus der
> Umgebung greifen. Wer also auf die `.env` zurückfallen will, muss das Feld in
> der Firebase-Konsole löschen (Weg B) – Leeren genügt nicht.

### Der Webhook funktioniert nicht – so findest du den Fehler

**Zuerst: Die Adresse im Browser aufzurufen ist kein Test.** Der Endpunkt nimmt
ausschliesslich `POST`-Anfragen entgegen, ein Browser schickt aber `GET`. Ein
Aufruf von `https://api.alae.app/webhook/resend` im Browser liefert deshalb
**immer** `{"error":"Nicht gefunden."}` – auch wenn der Webhook einwandfrei
läuft. Das ist kein Fehler und kein brauchbarer Test.

Geh stattdessen der Reihe nach vor:

1. **Läuft der aktuelle Stand auf dem QNAP?** Rufe
   `https://api.alae.app/api/parent/site` im Browser auf. Erscheint JSON mit
   `contactEmail` und `shippingFeeCents`, ist der Code aktuell. Erscheint
   `{"error":"Nicht gefunden."}`, läuft noch eine ältere Version – dann zuerst
   das Image aktualisieren (siehe [docs/09-auto-deploy.md](09-auto-deploy.md)).
2. **Ist ein Secret hinterlegt?** Adminbereich → **Einstellungen → Nicht
   zustellbare E-Mails**. Steht dort „Der Resend-Webhook ist nicht
   eingerichtet“, fehlt das Secret – neu setzen nach Weg A oben.
3. **Ist es das richtige Secret?** Gebraucht wird das **Signing Secret des
   Webhooks** (beginnt mit `whsec_`), **nicht** der API-Key für den Versand
   (beginnt mit `re_`). Beide stehen an verschiedenen Stellen im
   Resend-Dashboard; sie zu verwechseln ist der häufigste Fehler.
4. **Was sagt Resend?** Im Resend-Dashboard unter **Webhooks** den Endpunkt
   öffnen. Dort stehen die letzten Zustellversuche mit HTTP-Status:

   | Status | Bedeutung |
   |---|---|
   | `200` | Alles in Ordnung, das Ereignis ist angekommen. |
   | `400 Invalid signature` | Das hinterlegte Secret passt nicht zu diesem Webhook. Secret in Resend neu kopieren und nach Weg A oben ersetzen. |
   | `400 Resend webhook not configured` | Es ist (noch) kein Secret gespeichert – siehe Weg A oben. |
   | `404` | Falsche Adresse, oder auf dem QNAP läuft noch eine alte Version. Adresse muss exakt `https://api.alae.app/webhook/resend` lauten. |
   | Zeitüberschreitung | Die API ist von aussen nicht erreichbar. `https://api.alae.app/health` im Browser prüfen. |

5. **Ereignisse ausgewählt?** Der Webhook muss mindestens `email.bounced`,
   `email.complained` und `email.failed` senden. Ohne diese Ereignisse meldet
   Resend zwar erfolgreich zugestellte E-Mails, aber keine Probleme.
6. **Test auslösen:** Am einfachsten eine Einladung an eine bewusst falsche
   Adresse auf einer echten Domain schicken (z. B.
   `gibtesnicht@gmail.com`). Kurz darauf muss der Bounce in der Liste stehen.

> Wichtig: Resend meldet die Ereignisse auch für E-Mails, die die App über
> **SMTP** verschickt. Ein separater API-Key ist nicht nötig; die Signatur des
> Webhooks (Svix) wird im Backend geprüft.

**Vorgehen bei einer nicht zustellbaren E-Mail:** Adresse im Auftrag unter
**Aufträge → „Bearbeiten“** beim Kind mit ✎ korrigieren (die Bestätigung wird
dabei zurückgesetzt), anschliessend die Einladung über „Einladung per E-Mail
senden“ gezielt an diese Adresse schicken. Stimmt die Adresse (z. B. Postfach
war nur vorübergehend voll), das Problem unter „Einstellungen“ mit
**„Erledigt“** schliessen – die rote Markierung verschwindet damit. Kommt später eine E-Mail
an dieselbe Adresse an, wird die Markierung automatisch entfernt.

Einträge älter als 90 Tage räumt die App selbst auf; offene Probleme bleiben
stehen.

## 4.7 Kontakt-E-Mail-Adresse (Impressum) und Weiterleitung

Die App zeigt im Impressum und auf der Hilfe-Seite eine **E-Mail-Adresse**
(statt einer Telefonnummer), z. B. `photographic@alae.app`. Sie wird im
Adminbereich unter **Einstellungen → Kontakt-E-Mail-Adresse** gepflegt und ist
zugleich die **Antwortadresse (Reply-To)** aller E-Mails, welche die App an
Eltern verschickt: Wer auf eine Einladung oder Bestellbestätigung antwortet,
schreibt automatisch an diese Adresse – und nicht an den `no-reply`-Absender.

**Die App empfängt keine E-Mails.** Damit E-Mails an `photographic@alae.app`
in einem Postfach ankommen, braucht es eine **Weiterleitung** auf der Domain.
Da `alae.app` bei Cloudflare liegt, ist **Cloudflare Email Routing** (kostenlos)
der einfachste Weg. Wichtig: In der aktuellen Cloudflare-Oberfläche liegt Email
Routing **nicht** im Menü der Domain (dort zeigt „Email“ nur *DMARC Management*
und *Email Security*), sondern **kontoweit** unter *Compute → Email Service*.

1. Cloudflare-Dashboard → über **Back to Domains** zur Kontoübersicht → in der
   linken Leiste **Compute → Email Service → Email Routing**. Direktlink:
   <https://dash.cloudflare.com/?to=/:account/email-service/routing>
   (Cloudflare setzt das Konto selbst ein).
2. **Onboard Domain** → `alae.app` auswählen. Cloudflare legt die nötigen
   DNS-Einträge selbst an: MX-Einträge (Empfang über Cloudflare), einen
   SPF-TXT-Eintrag und einen DKIM-TXT-Eintrag für die weitergeleiteten Mails.
   > Voraussetzung: Für `alae.app` gibt es noch keine anderen MX-Einträge
   > (kein anderes Postfach auf der Hauptdomain). Resend braucht für den
   > **Versand** keine MX-Einträge – der Versand über `no-reply@alae.app`
   > läuft davon unberührt weiter. Bestehende SPF-Einträge (z. B. der von
   > Resend) werden von Cloudflare erkannt und ergänzt, nicht ersetzt.
3. Reiter **Destination Addresses**: das Postfach eintragen, das die E-Mails
   erhalten soll (z. B. die E-Mail-Adresse deines Admin-Kontos). Cloudflare
   schickt dorthin eine Bestätigungs-E-Mail – **Verify email address**
   anklicken. Zieladressen gelten kontoweit und lassen sich für jede Domain
   des Kontos verwenden.
4. Reiter **Routing Rules** → **Create routing rule**: bei *Email pattern*
   `photographic` eintragen und `alae.app` wählen, *Action* **Send to an
   email**, *Destination* = die bestätigte Zieladresse → **Save**. Optional:
   im selben Reiter die **Catch-all rule** aktivieren, damit auch
   Tippfehler-Adressen (`fotographic@…`) ankommen.
5. Testen: Eine E-Mail an `photographic@alae.app` schicken – sie muss im
   Zielpostfach ankommen. Das Ziel lässt sich dort jederzeit ändern, z. B. auf
   ein anderes Admin-Konto.
6. Im Adminbereich unter **Einstellungen** dieselbe Adresse als
   Kontakt-E-Mail-Adresse eintragen und speichern. Sie erscheint sofort im
   Impressum, auf der Hilfe-Seite und als Antwortadresse.

**Antworten mit der Absenderadresse `photographic@alae.app`** (statt mit der
privaten Gmail-Adresse): In Gmail unter *Einstellungen → Konten und Import →
„Senden als“* die Adresse hinzufügen; als SMTP-Server die Resend-Zugangsdaten
(`smtp.resend.com`, Port 587, Benutzer `resend`, Passwort = API-Key) eintragen.
Das ist optional – die Weiterleitung funktioniert auch ohne.

Alternative statt Cloudflare: Resend **Receiving** (Reiter „Receiving“ im
Resend-Dashboard) kann E-Mails für eine Domain entgegennehmen. Das erfordert
jedoch MX-Einträge auf Resend und die Verarbeitung über einen weiteren Webhook;
für eine reine Weiterleitung in ein Postfach ist Cloudflare Email Routing
einfacher und ausreichend.

## 4.8 Benachrichtigungen an dich

Zwei Benachrichtigungen lassen sich im Adminbereich unter **Einstellungen**
ein- und ausschalten (jeweils mit eigener Empfängerliste; bleibt sie leer,
gehen die E-Mails an alle Admin-Konten mit hinterlegter E-Mail-Adresse):

- **Neue Meldung**: Sobald Eltern unter „Hilfe & Kontakt“ etwas erfassen,
  erhältst du eine E-Mail mit Anliegen, Nachricht und Absenderadresse. Die
  Antwortadresse dieser E-Mail ist die Adresse der Eltern – „Antworten“ im
  Postfach schreibt also direkt an sie.
- **Zustellproblem**: Sobald der Resend-Webhook (4.6) eine nicht zustellbare
  E-Mail meldet, erhältst du eine E-Mail mit Empfänger, Betreff, Zeitpunkt und
  Begründung – genau eine je betroffener E-Mail.

## 4.9 Absenderadresse („Von“)

Was die Eltern im „Von“-Feld sehen, steht im Adminbereich unter
**Einstellungen → Absender der E-Mails**: ein optionaler Anzeigename und die
Absenderadresse. Der Wert gilt sofort, ohne Neustart; `MAIL_FROM` in der `.env`
ist nur noch der Startwert.

**Empfehlung: dieselbe Adresse wie die Kontaktadresse**, also z. B.
`Photographic <photographic@alae.app>` statt `no-reply@alae.app`. Dann sehen die
Eltern eine echte, antwortbare Adresse, und eine Antwort geht über die
Cloudflare-Weiterleitung (4.7) direkt in dein Postfach. Ein separates Reply-To
setzt die App in diesem Fall nicht mehr, weil das „Von“-Feld schon stimmt.

Zwei Voraussetzungen:

- **Die Domain muss bei Resend als Absender-Domain verifiziert sein.** Bleibst du
  innerhalb der bereits verifizierten Domain (`alae.app`), ist nichts zu tun –
  du darfst jede beliebige Adresse dieser Domain als Absender verwenden. Eine
  neue Domain müsstest du in Resend unter **Domains** zuerst verifizieren.
- **Nur ein SPF-Eintrag pro Domain.** Beim Aktivieren von Cloudflare Email
  Routing (4.7) legt Cloudflare einen eigenen SPF-TXT-Eintrag an. Existiert
  daneben noch der SPF-Eintrag von Resend, hat die Domain zwei davon – das ist
  ungültig und kann die Zustellbarkeit verschlechtern. Prüfe in Cloudflare unter
  **DNS → Einträge**, wie viele TXT-Einträge mit `v=spf1` beginnen. Sind es zwei,
  fasse sie zu einem zusammen, z. B.:

  ```
  v=spf1 include:_spf.mx.cloudflare.net include:amazonses.com ~all
  ```

  Die genauen `include:`-Werte übernimmst du aus den beiden bestehenden
  Einträgen; danach den überzähligen Eintrag löschen. DKIM-Einträge sind davon
  nicht betroffen, davon darf es mehrere geben.

> **Empfang und Versand derselben Adresse gleichzeitig?** Ja. Der Versand läuft
> über Resend (SMTP, ausgehend), der Empfang über Cloudflare Email Routing
> (MX, eingehend). Die beiden stören einander nicht.

➡️ Weiter mit **[5. Stripe (optional)](05-stripe.md)**.
