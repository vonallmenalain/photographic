# Arbeitsweise in diesem Repository

## Änderungen ausliefern (ausdrücklicher Wunsch des Auftraggebers)

- Fertige Änderungen **immer direkt als Pull Request eröffnen und mergen** –
  ohne vorher nachzufragen.
- Das ist gefahrlos möglich, weil Netlify für diese App mit **gesperrtem
  Auto-Publish** („Locked publishing“) konfiguriert ist: Ein Merge nach `main`
  löst zwar den Build aus, veröffentlicht aber nichts automatisch. Die
  Freigabe erfolgt von Hand in Netlify.
- Vor dem Merge abwarten, bis die GitHub-Action **„Build & Push Backend Image“**
  grün ist (läuft bei Änderungen unter `backend/`).
- Lokal prüfen mit `npm run typecheck` in `backend/` und `frontend/`.

## Aufbau

- `backend/` – Express-API in TypeScript. Sämtliche Daten liegen in Cloud
  Firestore; `backend/src/db/index.ts` ist die zentrale Datenschicht
  (Firestore kennt keine Fremdschlüssel – Kaskaden werden in
  `backend/src/routes/admin.ts` von Hand nachgebildet).
- `frontend/` – React + Vite. Adminbereich unter `src/pages/admin/`,
  Elternbereich unter `src/pages/parent/`, gemeinsames CSS in `src/index.css`.
- `docs/` – ausführliche Betriebs- und Einrichtungsdokumentation (QNAP,
  Cloudflare, Netlify, SMTP, Stripe, Betrieb, Firebase, Auto-Deploy). Neue
  Funktionen des Adminbereichs gehören dort nachgeführt, in der Regel in
  `docs/06-betrieb.md`.

## Sprache

- Oberfläche, Dokumentation, Code-Kommentare, Commit-Nachrichten und PR-Texte
  auf **Deutsch**.
