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
- `MAIL_FROM` sollte zu deiner verifizierten Absenderdomain passen.
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

- zeigt nicht zustellbare E-Mails im Adminbereich unter **Meldungen → Nicht
  zustellbare E-Mails** (Empfänger, Betreff, Zeitpunkt, Begründung),
- zählt sie neben dem Menüpunkt „Meldungen“ mit,
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

In `.env`:

```ini
RESEND_WEBHOOK_SECRET=whsec_xxx
```

Backend neu starten (`docker compose up -d backend`). Das Log zeigt danach
`mail status : Resend webhook configured (/webhook/resend)`. Im Adminbereich
steht unter „Meldungen → Nicht zustellbare E-Mails“, wann das letzte Ereignis
empfangen wurde – nach der nächsten verschickten E-Mail muss dort ein Eintrag
erscheinen (auch erfolgreiche Zustellungen werden protokolliert; die Ansicht
„Alle protokollierten E-Mails“ zeigt sie).

> Wichtig: Resend meldet die Ereignisse auch für E-Mails, die die App über
> **SMTP** verschickt. Ein separater API-Key ist nicht nötig; die Signatur des
> Webhooks (Svix) wird im Backend geprüft.

**Vorgehen bei einer nicht zustellbaren E-Mail:** Adresse im Auftrag unter
**Aufträge → „Bearbeiten“** beim Kind mit ✎ korrigieren (die Bestätigung wird
dabei zurückgesetzt), anschliessend die Einladung über „Einladung per E-Mail
senden“ gezielt an diese Adresse schicken. Stimmt die Adresse (z. B. Postfach
war nur vorübergehend voll), das Problem unter „Meldungen“ mit **„Erledigt“**
schliessen – die rote Markierung verschwindet damit. Kommt später eine E-Mail
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
der einfachste Weg:

1. Cloudflare-Dashboard → Domain `alae.app` → **E-Mail → E-Mail-Routing** →
   **Erste Schritte** / **E-Mail-Routing aktivieren**. Cloudflare legt die
   nötigen DNS-Einträge (MX, SPF-TXT) selbst an; bestehende Einträge werden
   angezeigt und müssen ggf. bestätigt werden.
   > Voraussetzung: Für `alae.app` gibt es noch keine anderen MX-Einträge
   > (kein anderes Postfach auf der Hauptdomain). Resend braucht für den
   > **Versand** keine MX-Einträge – der Versand über `no-reply@alae.app`
   > läuft davon unberührt weiter.
2. **Zieladressen**: das Postfach eintragen, das die E-Mails erhalten soll
   (z. B. die E-Mail-Adresse deines Admin-Kontos). Cloudflare schickt dorthin
   eine Bestätigungs-E-Mail – Link anklicken.
3. **Routing-Regeln → Adresse erstellen**: benutzerdefinierte Adresse
   `photographic`, Aktion **An E-Mail senden**, Ziel = die bestätigte
   Zieladresse → Speichern. Optional: eine **Catch-all**-Regel, damit auch
   Tippfehler-Adressen (`fotographic@…`) ankommen.
4. Testen: Eine E-Mail an `photographic@alae.app` schicken – sie muss im
   Zielpostfach ankommen. Das Ziel lässt sich dort jederzeit ändern, z. B. auf
   ein anderes Admin-Konto.
5. Im Adminbereich unter **Einstellungen** dieselbe Adresse als
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

Zwei Benachrichtigungen lassen sich im Adminbereich unter **Meldungen**
ein- und ausschalten (jeweils mit eigener Empfängerliste; bleibt sie leer,
gehen die E-Mails an alle Admin-Konten mit hinterlegter E-Mail-Adresse):

- **Neue Meldung**: Sobald Eltern unter „Hilfe & Kontakt“ etwas erfassen,
  erhältst du eine E-Mail mit Anliegen, Nachricht und Absenderadresse. Die
  Antwortadresse dieser E-Mail ist die Adresse der Eltern – „Antworten“ im
  Postfach schreibt also direkt an sie.
- **Zustellproblem**: Sobald der Resend-Webhook (4.6) eine nicht zustellbare
  E-Mail meldet, erhältst du eine E-Mail mit Empfänger, Betreff, Zeitpunkt und
  Begründung – genau eine je betroffener E-Mail.

➡️ Weiter mit **[5. Stripe (optional)](05-stripe.md)**.
