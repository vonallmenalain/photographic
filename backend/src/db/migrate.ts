import bcrypt from 'bcryptjs';
import { COL, col, firstOf, getById, nowIso, setById, updateById } from './index';
import { config } from '../config';
import { newId } from '../lib/ids';
import { normalizeEmail } from '../lib/validation';

/**
 * Firestore needs no schema, but we still seed sensible defaults (a starter
 * product list + the admin user from the environment). Safe to run on every
 * container start.
 */
export async function migrate(): Promise<void> {
  await ensureDefaultProducts();
  await ensureAdminFromEnv();
  await ensureAdminEmail();
  // eslint-disable-next-line no-console
  console.log(`[migrate] Firestore ready (project=${config.firebase.projectId})`);
}

async function ensureDefaultProducts(): Promise<void> {
  const snap = await col(COL.products).limit(1).get();
  if (!snap.empty) return;

  const defaults = [
    {
      name: 'Digitaler Download (hohe Auflösung)',
      description: 'Originalfoto in voller Auflösung, ohne Wasserzeichen, als Download.',
      type: 'digital',
      price_cents: 1500,
      sort_order: 0,
    },
    {
      name: 'Druck 13×18 cm',
      description: 'Gedrucktes Foto auf Fotopapier, Format 13×18 cm.',
      type: 'print',
      price_cents: 600,
      sort_order: 1,
    },
  ];

  for (const d of defaults) {
    const id = newId('prod');
    await setById(COL.products, id, {
      name: d.name,
      description: d.description,
      type: d.type,
      price_cents: d.price_cents,
      currency: config.stripe.currency,
      active: 1,
      sort_order: d.sort_order,
      created_at: nowIso(),
    });
  }
  // eslint-disable-next-line no-console
  console.log('[migrate] seeded default products');
}

async function ensureAdminFromEnv(): Promise<void> {
  const { username, passwordHash, plainPassword, email } = config.admin;
  if (!passwordHash && !plainPassword) return; // nothing configured yet

  const hash = passwordHash || bcrypt.hashSync(plainPassword, 10);
  // E-Mail immer normalisieren (trim + lowercase), damit Login & "Passwort
  // vergessen" sie zuverlässig wiederfinden (Suche läuft ebenfalls normalisiert).
  const normalizedEmail = email ? normalizeEmail(email) : '';
  const emailUpdate = normalizedEmail ? { email: normalizedEmail } : {};
  // Admin user documents are keyed by username for a stable, unique identity.
  const existing = await getById<{ username: string }>(COL.adminUsers, username);
  if (existing) {
    await updateById(COL.adminUsers, username, {
      password_hash: hash,
      ...emailUpdate,
      updated_at: nowIso(),
    });
  } else {
    await setById(COL.adminUsers, username, {
      username,
      password_hash: hash,
      ...emailUpdate,
      created_at: nowIso(),
      updated_at: nowIso(),
    });
  }
  // eslint-disable-next-line no-console
  console.log(`[migrate] admin user '${username}' ensured`);
}

/**
 * Stellt sicher, dass die Admin-E-Mail-Adresse sauber (normalisiert) am
 * Admin-Dokument hinterlegt ist – unabhängig von den Passwort-Env-Variablen.
 *
 * Selbstheilend: trägt die Adresse nach, wenn sie fehlt, korrigiert eine
 * abweichende Schreibweise (Groß-/Kleinschreibung, Leerzeichen) und findet das
 * Admin-Dokument auch dann, wenn es bereits unter dieser E-Mail (statt unter dem
 * Benutzernamen) existiert. So lässt sich "Passwort vergessen" zuverlässig per
 * E-Mail auslösen und der Login per E-Mail funktioniert.
 */
async function ensureAdminEmail(): Promise<void> {
  const { username, email } = config.admin;
  if (!email) return;
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return;

  // Bevorzugt das Dokument unter dem konfigurierten Benutzernamen; fällt sonst
  // auf ein bereits vorhandenes Dokument mit dieser E-Mail zurück.
  const byUsername = await getById<{ username: string; email?: string }>(COL.adminUsers, username);
  const target =
    byUsername ??
    (await firstOf<{ username: string; email?: string }>(
      col(COL.adminUsers).where('email', '==', normalizedEmail),
    ));
  if (!target) return; // Kein Admin-Dokument vorhanden – nichts zu tun

  const current = typeof target.email === 'string' ? normalizeEmail(target.email) : '';
  if (target.email === normalizedEmail) return; // Bereits sauber gesetzt
  await updateById(COL.adminUsers, target.id, { email: normalizedEmail, updated_at: nowIso() });
  // eslint-disable-next-line no-console
  console.log(
    `[migrate] admin email ${current ? 'normalised' : 'set'} for '${target.username ?? target.id}'`,
  );
}

if (require.main === module) {
  migrate()
    .then(() => process.exit(0))
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error('[migrate] failed', err);
      process.exit(1);
    });
}
