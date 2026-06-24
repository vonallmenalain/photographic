# 6. Betrieb, Admin-Workflow, Aufbewahrung & Troubleshooting

## 6.1 Der typische Admin-Workflow

1. **Event / Foto-Set anlegen** (Adminbereich → „Events / Foto-Sets“).
   Ein Event hat ein Ablaufdatum (Standard 30 Tage), das du anpassen kannst.
2. **Originale hochladen** (im Event → „Fotos hochladen“). Pro Datei nur das
   Original; Thumbnail + Wasserzeichen-Preview entstehen automatisch.
3. **Kinder anlegen** und Fotos zuordnen:
   - Einzelfoto → Kind über das Dropdown zuordnen.
   - **Klassen-/Gruppenfoto** → Häkchen „Gruppen-/Klassenfoto“ setzen und über
     „E-Mail-Zuordnung verwalten“ den berechtigten Familien direkt zuweisen.
4. **Fotos veröffentlichen** (Button „Veröffentlichen“ je Foto). Erst dann sind
   sie – nach E-Mail-Verifizierung – für Eltern sichtbar.
5. **E-Mail-Adressen** anlegen (Adminbereich → „E-Mail-Adressen“) und mit Kindern
   verknüpfen (n:m: Mutter+Vater, mehrere Kinder).
6. **Event-Status auf „published“** setzen. (Foto sichtbar = Event published
   **und** Foto published **und** Zuordnung vorhanden **und** E-Mail verifiziert.)

### Prüfschritt vor Veröffentlichung (empfohlen)
Bevor du ein Event auf „published“ setzt:
- Stimmt jede Zuordnung (Kind ↔ Foto, E-Mail ↔ Kind)?
- Sind nur die gewünschten Fotos „veröffentlicht“?
- Sind Previews korrekt mit Wasserzeichen erzeugt (Thumbnails im Admin sichtbar)?

## 6.2 Statuswerte (wie im Konzept)

- **Fotos:** hochgeladen → verarbeitet → zugeordnet · (deaktiviert)
- **E-Mails:** angelegt → nicht verifiziert → Verifizierung gesendet → verifiziert · (deaktiviert / Support)
- **Bestellungen:** Warenkorb → Kauf gestartet → bezahlt → abgeschlossen → bereitgestellt · (fehlgeschlagen / storniert / rückerstattet)
- **Events:** Entwurf → in Bearbeitung → bereit → veröffentlicht → archiviert · (deaktiviert)

## 6.3 Supportfälle

- **Falsche/alte E-Mail:** E-Mail-Detailseite → Adresse korrigieren oder Status
  auf „Support nötig“. Bei Bedarf neue Bestätigung auslösen.
- **Mehrere Eltern (Mutter+Vater):** beide Adressen anlegen, beide mit demselben
  Kind verknüpfen.
- **Mehrere Kinder:** eine Adresse mit mehreren Kindern verknüpfen.
- **Falsch zugeordnetes Foto:** Foto „Zurückziehen“ (Veröffentlichung aufheben),
  Zuordnung ändern oder Foto deaktivieren/löschen.
- **Eltern finden keine Fotos:** prüfen, ob (a) Adresse exakt stimmt, (b) Kind
  verknüpft, (c) Foto veröffentlicht, (d) Event „published“.
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
| CORS-Fehler im Browser | `PUBLIC_APP_URL` muss exakt `https://fotos.alae.app` sein (inkl. https, ohne Slash am Ende); die rohe Netlify-URL gehört in `EXTRA_CORS_ORIGINS`. |
| Eltern bleiben nicht eingeloggt | Cookies blockiert. Mit API auf `api.alae.app`: `COOKIE_SECURE=true`, `COOKIE_SAMESITE=lax`, `COOKIE_DOMAIN=.alae.app`. Liegt die API auf anderer Domain: `COOKIE_SAMESITE=none`, `COOKIE_DOMAIN` leer. |
| Firebase-Login `auth/unauthorized-continue-uri` | App-Domain fehlt in Firebase → **Authentication → Settings → Authorized domains**: `fotos.alae.app` und `creartphotographic.netlify.app` eintragen. |
| Keine E-Mail kommt an | SMTP-Daten prüfen; im Log steht `mail: DEV LOG ONLY`, wenn `SMTP_HOST` fehlt. Spam-Ordner/SPF/DKIM prüfen. Unbekannte Adressen erhalten bewusst keine Mail. |
| Upload schlägt fehl (große Datei) | `MAX_UPLOAD_MB` erhöhen; Cloudflare-Free begrenzt ~100 MB/Anfrage. |
| Previews ohne Wasserzeichen | Im Backend-Image fehlten Schriftarten – das Wasserzeichen wird als Text gerendert und bleibt ohne Font unsichtbar. Im aktuellen Image sind `fontconfig` + `fonts-dejavu-core`/`fonts-liberation` enthalten. Beim Start zeigt das Log `watermark : OK (fonts available)`; steht dort `BROKEN`, Image neu bauen/ziehen. Bereits ohne Wasserzeichen erzeugte Fotos neu hochladen (oder im Admin neu verarbeiten). |
| Foto erscheint bei Eltern nicht | Checkliste 6.3 „Eltern finden keine Fotos“. |
| Stripe-Bestellung bleibt „Kauf gestartet“ | Webhook fehlt/falsch. Endpoint `…/webhook/stripe` und `STRIPE_WEBHOOK_SECRET` prüfen. |

## 6.8 Sicherheits-Checkliste (vor Go-Live)

- [ ] Eigene, lange `JWT_SECRET` und `FILE_TOKEN_SECRET` gesetzt.
- [ ] Admin-Passwort als bcrypt-Hash (`ADMIN_PASSWORD_HASH`), kein Klartext mehr.
- [ ] HTTPS überall (Netlify + Cloudflare) – erfüllt.
- [ ] `PUBLIC_APP_URL` korrekt → CORS dicht.
- [ ] SMTP mit SPF/DKIM für zuverlässige, seriöse E-Mails.
- [ ] Backups des `data/`-Ordners eingerichtet.
- [ ] Testdurchlauf: anlegen → hochladen → zuordnen → veröffentlichen →
      verifizieren → kaufen → herunterladen.

➡️ Fachlicher Abgleich mit dem Konzept: **[7. Konzept-Abgleich](07-konzept-abgleich.md)**.
