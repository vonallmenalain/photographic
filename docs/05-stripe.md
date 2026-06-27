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

## 5.2a Zahlungsarten (nur Karte & TWINT)

Welche Zahlungsarten auf der Stripe-Checkout-Seite erscheinen, steuert die App
**im Code** über `STRIPE_PAYMENT_METHODS` (Standard: `card,twint`). Diese feste
Liste hat Vorrang vor den „automatischen Zahlungsmethoden“ im Stripe-Dashboard –
so ist garantiert reproduzierbar, dass Eltern **nur mit Karte und TWINT** zahlen.

```ini
# Standard: nur Karte und TWINT
STRIPE_PAYMENT_METHODS=card,twint
```

Wichtig dazu:

1. **TWINT muss im Stripe-Dashboard aktiviert sein** (Settings → Payment methods →
   TWINT aktivieren). Stripe zeigt eine Methode nur an, wenn sie für dein Konto
   freigeschaltet ist. Die Liste im Code *begrenzt* die Auswahl, sie kann eine
   im Dashboard deaktivierte Methode aber nicht erzwingen.
2. **TWINT funktioniert nur in CHF** – `CURRENCY=chf` muss gesetzt sein (Standard).
3. Möchtest du die Auswahl doch über das Dashboard steuern, lass
   `STRIPE_PAYMENT_METHODS` **leer**; dann nutzt Stripe die dort aktivierten
   automatischen Zahlungsmethoden.

> Antwort auf „Code oder Dashboard?“: Die **Begrenzung auf Karte + TWINT ist im
> Code** gesetzt (`STRIPE_PAYMENT_METHODS`). Du musst im **Dashboard nur einmal
> sicherstellen, dass TWINT (und Karte) aktiviert** ist.

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
