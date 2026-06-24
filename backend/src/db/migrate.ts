import bcrypt from 'bcryptjs';
import { COL, col, getById, nowIso, setById, updateById } from './index';
import { config } from '../config';
import { newId } from '../lib/ids';

/**
 * Firestore needs no schema, but we still seed sensible defaults (a starter
 * product list + the admin user from the environment). Safe to run on every
 * container start.
 */
export async function migrate(): Promise<void> {
  await ensureDefaultProducts();
  await ensureAdminFromEnv();
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
      name: 'Abzug 13×18 cm',
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
  const { username, passwordHash, plainPassword } = config.admin;
  if (!passwordHash && !plainPassword) return; // nothing configured yet

  const hash = passwordHash || bcrypt.hashSync(plainPassword, 10);
  // Admin user documents are keyed by username for a stable, unique identity.
  const existing = await getById<{ username: string }>(COL.adminUsers, username);
  if (existing) {
    await updateById(COL.adminUsers, username, {
      password_hash: hash,
      updated_at: nowIso(),
    });
  } else {
    await setById(COL.adminUsers, username, {
      username,
      password_hash: hash,
      created_at: nowIso(),
      updated_at: nowIso(),
    });
  }
  // eslint-disable-next-line no-console
  console.log(`[migrate] admin user '${username}' ensured`);
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
