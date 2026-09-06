# 5. Stripe (optional – echte Bezahlung)

Die App funktioniert **auch ohne Stripe**: Dann gibt es einen manuellen
Bestellabschluss (Status „abgeschlossen“, Downloads werden freigeschaltet) – gut
für Tests oder wenn du Zahlungen anders abwickelst (z. B. Rechnung/Überweisung).

Mit Stripe wird beim Checkout eine sichere **Stripe-Checkout-Seite** geöffnet;
nach erfolgreicher Zahlung schaltet ein **Webhook** die Bestellung frei.

> **Du willst von der Sandbox/vom Testmodus auf echte Zahlungen umstellen?**
> Die vollständige Schritt-für-Schritt-Anleitung steht in
> [5.6 Von der Sandbox in den Produktivmodus wechseln](#56-von-der-sandbox-in-den-produktivmodus-wechseln-go-live).

## 5.1 Stripe-Konto & Schlüssel

1. Konto auf [stripe.com](https://stripe.com) anlegen.
2. **Developers → API keys**: den **Secret key** kopieren (`sk_live_...` bzw.
   im Testmodus `sk_test_...`).

In `.env`:

```ini
STRIPE_SECRET_KEY=sk_live_xxx
CURRENCY=chf
```

Backend neu starten:

```bash
docker compose up -d backend
```

Im Log erscheint eine Zeile wie
`[server] stripe      : LIVE (CHF) – real payments, webhook configured`.
Sie nennt die erkannte Umgebung (LIVE oder TEST/Sandbox), die Währung und ob
das Webhook-Secret gesetzt ist – siehe [5.6, Schritt 6](#schritt-6--kontrolle-im-log).

## 5.2 Webhook einrichten (wichtig!)

Damit Bestellungen nach der Zahlung automatisch als bezahlt markiert werden:

1. Stripe-Dashboard → **Developers → Webhooks → Add endpoint**.
2. **Endpoint URL**: `https://api.alae.app/webhook/stripe`
   (deine Cloudflare-Tunnel-Adresse + `/webhook/stripe`).
3. **Events to send**: mindestens `checkout.session.completed`.
4. Endpoint speichern → den **Signing secret** (`whsec_...`) kopieren.

In `.env`:

```ini
STRIPE_WEBHOOK_SECRET=whsec_xxx
```

Backend neu starten:

```bash
docker compose up -d backend
```

## 5.2a Zahlungsarten (Karte, TWINT, Apple Pay & Google Pay)

Welche Zahlungsarten auf der Stripe-Checkout-Seite erscheinen, steuert die App
**im Code** über `STRIPE_PAYMENT_METHODS` (Standard:
`card,twint,apple_pay,google_pay`). Diese feste Liste hat Vorrang vor den
„automatischen Zahlungsmethoden“ im Stripe-Dashboard – so ist garantiert
reproduzierbar, dass Eltern genau die vier vorgesehenen Methoden sehen.

```ini
# Standard: Karte, TWINT, Apple Pay und Google Pay
STRIPE_PAYMENT_METHODS=card,twint,apple_pay,google_pay
```

**Wie Apple Pay & Google Pay funktionieren (wichtig):** Apple Pay und Google Pay
sind keine eigenen Zahlungsarten, sondern **„Wallets“ der Methode „Karte“
(`card`)**. Stripe blendet sie auf der Checkout-Seite **automatisch** ein, sobald

- sie im **Dashboard aktiviert** sind (Settings → Payment methods → Apple Pay /
  Google Pay), und
- das **Gerät bzw. der Browser** sie unterstützt (z. B. Apple Pay in Safari auf
  iPhone/Mac, Google Pay in Chrome/Android) und eine Karte im Wallet hinterlegt
  ist.

Deshalb genügt es, dass `card` in der Liste steht. Damit du die vier Methoden
trotzdem **explizit** notieren kannst, akzeptiert die App auch
`apple_pay`/`google_pay` in `STRIPE_PAYMENT_METHODS` und bildet sie intern auf
`card` ab (würde man sie direkt an Stripe als eigenen `payment_method_type`
schicken, lehnt die API die Anfrage ab).

Wichtig dazu:

1. **Methoden müssen im Stripe-Dashboard aktiviert sein** (Settings → Payment
   methods → Karte, TWINT, Apple Pay, Google Pay aktivieren). Stripe zeigt eine
   Methode nur an, wenn sie für dein Konto freigeschaltet ist. Die Liste im Code
   *begrenzt* die Auswahl, sie kann eine im Dashboard deaktivierte Methode aber
   nicht erzwingen.
2. **TWINT funktioniert nur in CHF** – `CURRENCY=chf` muss gesetzt sein (Standard).
3. **Apple Pay** benötigt eine registrierte Domain; bei der von Stripe gehosteten
   Checkout-Seite übernimmt Stripe diese Registrierung automatisch – du musst
   dafür nichts tun.
4. Möchtest du die Auswahl doch über das Dashboard steuern, lass
   `STRIPE_PAYMENT_METHODS` **leer**; dann nutzt Stripe die dort aktivierten
   automatischen Zahlungsmethoden.

> **Cartes Bancaires deaktivieren?** Ja, deine Annahme stimmt: Da die App die
> Methoden **im Code** auf `card,twint,apple_pay,google_pay` begrenzt, erscheint
> **Cartes Bancaires nicht** auf der Checkout-Seite – auch wenn es sich im
> Dashboard nicht abschalten lässt. Nur was in `STRIPE_PAYMENT_METHODS` steht
> (bzw. als Wallet zu `card` gehört), wird angeboten.

## 5.3 Testmodus (Sandbox)

- Verwende zuerst die **Test-Schlüssel** (`sk_test_...`, `whsec_...` aus dem
  Test-Webhook) und Stripes Testkarten (z. B. `4242 4242 4242 4242`, beliebiges
  künftiges Datum, beliebiger CVC).
- Ablauf: Warenkorb → „Kauf abschließen“ → Stripe-Seite → Zahlung → Rückleitung
  zur Bestellseite. Über den Webhook wird die Bestellung auf „bezahlt/abgeschlossen“
  gesetzt und Download-Links erscheinen.

> Sandbox und Live sind bei Stripe **zwei getrennte Welten**: Schlüssel,
> Webhooks, aktivierte Zahlungsarten, Produkte und Zahlungen der Sandbox
> existieren im Live-Modus **nicht**. Der Wechsel ist deshalb kein Schalter,
> sondern der Austausch der beiden Werte in der `.env` – siehe
> [5.6](#56-von-der-sandbox-in-den-produktivmodus-wechseln-go-live).

## 5.4 Produkte & Preise

Die Standardprodukte („Digitaler Download“, „Abzug 13×18“) werden beim ersten
Start angelegt. Im **Adminbereich → (intern)** bzw. per API kannst du Produkte
ergänzen/ändern (`/api/admin/products`). Preise sind in **Cent** hinterlegt.

> Hinweis: Die Preisbildung erfolgt server-seitig pro Produkt; die App ist so
> gebaut, dass weitere Produktarten (Größen, Pakete, Sets, Rabatte) später
> ergänzt werden können, ohne die Grundlogik zu ändern.

## 5.5 Ohne Stripe weiterarbeiten

Lässt du `STRIPE_SECRET_KEY` leer, nutzt der Checkout den manuellen Modus:
„Kauf abschließen“ markiert die Bestellung direkt als abgeschlossen und schaltet
digitale Downloads frei. Du kannst Zahlungen dann außerhalb der App abwickeln und
den Bestellstatus im Adminbereich pflegen.

## 5.6 Von der Sandbox in den Produktivmodus wechseln (Go-Live)

Technisch besteht der Wechsel nur aus **zwei neuen Werten in der `.env`**
(`STRIPE_SECRET_KEY` und `STRIPE_WEBHOOK_SECRET`) plus einem Neustart des
Backends. Der Rest der Liste sorgt dafür, dass Stripe die Zahlungen im
Live-Modus auch wirklich annimmt und auf dein Konto auszahlt.

Am Code ist **nichts** zu ändern: Die App liest Schlüssel und Webhook-Secret
aus der Umgebung, und die Checkout-Seite wird von Stripe gehostet. Auch am
**Frontend/Netlify ändert sich nichts** – dort liegt kein Stripe-Schlüssel.

### Schritt 1 – Stripe-Konto vollständig aktivieren

Im Stripe-Dashboard oben links von der **Sandbox** in den **Live-Modus**
(„Produktivmodus“) wechseln. Steht dort noch ein Hinweis „Konto aktivieren“ /
„Aktivierung abschliessen“, zuerst die Angaben vervollständigen:

- Geschäftsangaben (Firma/Einzelunternehmen, Adresse, Zweck der Website),
- Identitätsnachweis der Inhaberin/des Inhabers,
- **Auszahlungskonto (IBAN)** – ✅ bei dir bereits hinterlegt,
- Kontaktangaben für Kundenbelege (erscheinen auf Quittungen).

Erst wenn das Konto aktiviert ist, akzeptiert Stripe echte Zahlungen. Prüfen
unter **Einstellungen → Geschäftsdaten** bzw. **Einstellungen → Auszahlungen**
(dort siehst du auch den Auszahlungsrhythmus; die **erste** Auszahlung dauert
erfahrungsgemäss rund 7–14 Tage, danach läuft es nach Zeitplan).

### Schritt 2 – Zahlungsarten im Live-Modus aktivieren

**Einstellungen → Zahlungsmethoden** – im **Live-Modus** (die Aktivierung aus
der Sandbox wird *nicht* übernommen):

- **Karte** (aktiviert Apple Pay und Google Pay gleich mit, siehe 5.2a),
- **TWINT** – braucht ein Schweizer Konto und **CHF**; Stripe schaltet TWINT
  teils erst nach einer kurzen Prüfung frei. Solange TWINT nicht freigegeben
  ist, lehnt Stripe den Checkout mit `payment_method_types: twint` ab – dann
  TWINT vorübergehend aus `STRIPE_PAYMENT_METHODS` nehmen,
- **Apple Pay / Google Pay** – im Live-Modus einmal aktivieren.

### Schritt 3 – Live-Schlüssel holen

**Entwickler → API-Schlüssel** (im Live-Modus): beim **Geheimschlüssel** auf
„Live-Schlüssel anzeigen“ und `sk_live_...` kopieren. Stripe zeigt ihn nur
einmal vollständig an – gleich sicher ablegen (Passwortmanager).

### Schritt 4 – Webhook im Live-Modus NEU anlegen

Webhook-Endpunkte gehören immer zu genau einer Umgebung. Der Endpunkt aus der
Sandbox feuert im Live-Modus **nicht** – ohne neuen Endpunkt bliebe jede
bezahlte Bestellung auf „Kauf gestartet“ stehen.

1. **Entwickler → Webhooks → Endpunkt hinzufügen** (im Live-Modus).
2. **Endpoint-URL**: `https://api.alae.app/webhook/stripe`
3. **Events**: mindestens `checkout.session.completed`.
4. Speichern → **Signing secret** (`whsec_...`) kopieren.

### Schritt 5 – `.env` auf dem QNAP anpassen

In der `.env` neben der `docker-compose.yml` die beiden Werte ersetzen:

```ini
STRIPE_SECRET_KEY=sk_live_xxx        # Live-Schlüssel aus Schritt 3
STRIPE_WEBHOOK_SECRET=whsec_xxx      # Signing Secret des LIVE-Webhooks (Schritt 4)
CURRENCY=chf
STRIPE_PAYMENT_METHODS=card,twint,apple_pay,google_pay
```

Ebenfalls prüfen (bestimmt die Rückleitung nach der Zahlung):

```ini
PUBLIC_APP_URL=https://photographic.alae.app
```

Die `.env` liegt nur auf dem QNAP und ist in `.gitignore` – der Live-Schlüssel
darf **nie** in Git, in eine E-Mail oder ins Frontend gelangen.

Backend neu starten:

```bash
docker compose up -d backend
```

### Schritt 6 – Kontrolle im Log

```bash
docker compose logs --tail=50 backend
```

Erwartete Zeile:

```
[server] stripe      : LIVE (CHF) – real payments, webhook configured
```

Steht dort etwas anderes, sagt das Log direkt, was fehlt:

| Logzeile | Bedeutung |
|---|---|
| `TEST/Sandbox (CHF) – no real payments, …` | Es ist noch der `sk_test_…`-Schlüssel aktiv (bei `NODE_ENV=production` zusätzlich als `WARNING` markiert). |
| `… WEBHOOK MISSING` | `STRIPE_WEBHOOK_SECRET` fehlt → Bestellungen blieben auf „Kauf gestartet“. |
| `unknown key type` | Der Wert ist kein Stripe-Geheimschlüssel (z. B. versehentlich der `pk_…`-Publishable-Key). |
| `WARNING: TWINT is enabled but CURRENCY=…` | TWINT braucht `CURRENCY=chf`. |
| `manual/test mode (no STRIPE_SECRET_KEY)` | Kein Schlüssel gesetzt – es läuft der manuelle Bestellabschluss (5.5). |

### Schritt 7 – Echttest mit einer richtigen Karte

Ein einziger echter Durchlauf ist die einzige verlässliche Probe:

1. Als Elternteil anmelden, ein Foto in den Warenkorb legen, „Kauf abschliessen“.
2. Auf der Stripe-Seite mit einer echten Karte (oder TWINT) bezahlen.
3. **Stripe → Zahlungen**: Die Zahlung erscheint als „Erfolgreich“.
4. **Stripe → Entwickler → Webhooks → dein Endpunkt**: Das Event
   `checkout.session.completed` steht mit **HTTP 200** in der Liste.
5. In der App: Bestellung steht auf **„Abgeschlossen“**, die Download-Links sind
   da, und die Bestätigungs-E-Mail ist angekommen.
6. Die Testzahlung im Stripe-Dashboard **zurückerstatten** („Rückerstattung“).
   Beachte: Die Stripe-Gebühr der ursprünglichen Zahlung wird dabei in der
   Regel **nicht** zurückerstattet – der Test kostet also die Gebühr.

### Schritt 8 – Nach dem Go-Live sinnvoll (optional)

- **Belege an Eltern**: Einstellungen → **Kunden-E-Mails** → „Erfolgreiche
  Zahlungen“ aktivieren, damit Stripe automatisch eine Quittung verschickt.
- **Branding**: Einstellungen → **Branding** – Logo und Farben erscheinen auf
  der Checkout-Seite.
- **Kontaktangaben & Rückgabebedingungen** hinterlegen (erscheinen im Checkout
  und reduzieren Rückfragen/Chargebacks).
- Sandbox nicht löschen: Sie bleibt für spätere Tests nützlich (5.3).

### Zurück in den Testmodus

Jederzeit möglich – wieder die `sk_test_…`/`whsec_…`-Werte der Sandbox in die
`.env` eintragen und `docker compose up -d backend`. Lässt du
`STRIPE_SECRET_KEY` leer, greift der manuelle Bestellabschluss (5.5).

### Kurz-Checkliste

- [ ] Stripe-Konto aktiviert (Geschäftsdaten, Identität, **IBAN** ✅)
- [ ] Karte, TWINT, Apple Pay, Google Pay **im Live-Modus** aktiviert
- [ ] `STRIPE_SECRET_KEY=sk_live_...` in der `.env`
- [ ] Live-Webhook auf `https://api.alae.app/webhook/stripe` mit
      `checkout.session.completed` angelegt
- [ ] `STRIPE_WEBHOOK_SECRET=whsec_...` (aus dem **Live**-Webhook) in der `.env`
- [ ] `CURRENCY=chf`, `PUBLIC_APP_URL=https://photographic.alae.app`
- [ ] `docker compose up -d backend` → Log zeigt `stripe : LIVE (CHF) – real payments, webhook configured`
- [ ] Echttest bezahlt, Webhook 200, Bestellung abgeschlossen, danach zurückerstattet

➡️ Weiter mit **[6. Betrieb & Admin](06-betrieb.md)**.
