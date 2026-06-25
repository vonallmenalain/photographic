# AGENTS.md

## Cursor Cloud specific instructions

This repo is a German children's photo gallery: a React/Vite **frontend** (`frontend/`)
and a Node/Express/TypeScript **backend** (`backend/`). All data lives in Cloud
Firestore (Firebase) — there is no SQL/SQLite. For local development the backend
talks to the **Firebase Emulator Suite** (Firestore + Auth) instead of a real
Firebase project, so no service account or cloud credentials are needed.

The standard commands and the full local flow are documented in `README.md`
(section "3. Schnellstart"). Notes below are only the non-obvious bits for running
in this environment.

### Local dev requires three long-running processes

Start them in separate terminals (e.g. tmux). None of these belong in the update script.

1. Firebase emulators (run from the repo root, needs Java — already installed):
   `firebase emulators:start --only firestore,auth --project photographic-7ba68`
   - Emulator UI: http://127.0.0.1:4001 (Firestore 8080, Auth 9099).
   - `firebase` comes from a user-local global install (`~/.npm-global/bin`, already
     on `PATH` via `~/.bashrc`); `npx firebase-tools ...` also works.
2. Backend: `cd backend && npm run dev` → API on http://localhost:4000 (`tsx watch`, hot reload).
3. Frontend: `cd frontend && npm run dev` → app on http://localhost:5173 (Vite).

### Local `.env` files (gitignored) are required and must be dev-tuned

`backend/.env` and `frontend/.env` are git-ignored and NOT created by the update
script — create them once per fresh VM. Do NOT just `cp .env.example .env`: the
example files target production (`NODE_ENV=production`, `COOKIE_SECURE=true`,
`COOKIE_DOMAIN=.alae.app`), which breaks login cookies over `http://localhost`.

Use these dev values instead:

- `backend/.env`: `NODE_ENV=development`, `PORT=4000`,
  `PUBLIC_APP_URL=http://localhost:5173`, `FIREBASE_PROJECT_ID=photographic-7ba68`,
  `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080`, `FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099`,
  `FIREBASE_PARENT_AUTH=false`, `ADMIN_USERNAME=admin`, `ADMIN_PASSWORD=test1234`,
  `COOKIE_SECURE=false`, `COOKIE_SAMESITE=lax`, `COOKIE_DOMAIN=` (empty).
- `frontend/.env`: `VITE_API_BASE_URL=http://localhost:4000`, `VITE_FIREBASE_PARENT_AUTH=false`.

### Auth / verification gotchas

- Admin login: `admin` / `test1234` at http://localhost:5173/admin (the admin user
  is auto-seeded on backend startup from `ADMIN_PASSWORD`).
- Parent login with `FIREBASE_PARENT_AUTH=false` is "code only": the 6-digit
  verification code is printed to the **backend console**, not emailed (no SMTP in dev).
- Keep `FIREBASE_PARENT_AUTH` and `VITE_FIREBASE_PARENT_AUTH` in sync (both `false`
  for the self-contained local flow). Setting them `true` makes the parent flow use
  real Firebase Auth email-links (the frontend does not point at the Auth emulator).

### Lint / test / build

- There is no ESLint config and no automated test suite. The closest "lint" is the
  TypeScript check: `npm run typecheck` in both `backend/` and `frontend/`.
- Builds: `npm run build` in `backend/` (tsc → `dist/`) and `frontend/` (tsc + vite).

### Misc

- A harmless `nvm`/npm-prefix warning ("globalconfig and/or a prefix setting ...
  incompatible with nvm") prints on login shells because the npm global prefix is
  set to `~/.npm-global`. It does not affect any commands.
- Emulator data is in-memory and resets when the emulator process stops.
