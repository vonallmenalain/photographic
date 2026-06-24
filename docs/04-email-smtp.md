# 4. E-Mail / SMTP (Codes, Magic-Links, Bestätigungen)

Die App verschickt:
- **Verifizierungscodes / Magic-Links** an Eltern,
- **Bestellbestätigungen** nach dem Kauf.

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
SMTP_HOST=smtp.deinanbieter.de
SMTP_PORT=587
SMTP_SECURE=false          # true nur bei Port 465 (SMTPS)
SMTP_USER=dein-smtp-benutzer
SMTP_PASS=dein-smtp-passwort
MAIL_FROM=Foto-Galerie <no-reply@alae.app>
SUPPORT_EMAIL=support@alae.app
```

- `SMTP_PORT=587` mit `SMTP_SECURE=false` (STARTTLS) ist der Normalfall.
- `SMTP_PORT=465` erfordert `SMTP_SECURE=true`.
- `MAIL_FROM` sollte zu deiner verifizierten Absenderdomain passen.

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

➡️ Weiter mit **[5. Stripe (optional)](05-stripe.md)**.
