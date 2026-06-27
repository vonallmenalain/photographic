# 5. Stripe (optional – echte Bezahlung)

Die App funktioniert **auch ohne Stripe**: Dann gibt es einen manuellen
Bestellabschluss (Status „abgeschlossen“, Downloads werden freigeschaltet) – gut
für Tests oder wenn du Zahlungen anders abwickelst (z. B. Rechnung/Überweisung).

Mit Stripe wird beim Checkout eine sichere **Stripe-Checkout-Seite** geöffnet;
nach erfolgreicher Zahlung schaltet ein **Webhook** die Bestellung frei.

## 5.1 Stripe-Konto & Schlüssel

1. Konto auf [stripe.com](https://stripe.com) anlegen.
2. **Developers → API keys**: den **Secret key** kopieren (`sk_live_...` bzw.
   im Testmodus `sk_test_...`).

In `.env`:

```ini
STRIPE_SECRET_KEY=sk_live_xxx
CURRENCY=eur
```

Backend neu starten:

```bash
docker compose up -d backend
```

Im Log erscheint `stripe: enabled`.

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

## 5.3 Testmodus

- Verwende zuerst die **Test-Schlüssel** (`sk_test_...`, `whsec_...` aus dem
  Test-Webhook) und Stripes Testkarten (z. B. `4242 4242 4242 4242`, beliebiges
  künftiges Datum, beliebiger CVC).
- Ablauf: Warenkorb → „Kauf abschließen“ → Stripe-Seite → Zahlung → Rückleitung
  zur Bestellseite. Über den Webhook wird die Bestellung auf „bezahlt/abgeschlossen“
  gesetzt und Download-Links erscheinen.

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

➡️ Weiter mit **[6. Betrieb & Admin](06-betrieb.md)**.
