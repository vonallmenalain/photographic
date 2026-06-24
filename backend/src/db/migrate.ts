import { runSchema, getDb } from './index';
import { config } from '../config';
import { newId } from '../lib/ids';
import bcrypt from 'bcryptjs';

/**
 * Applies the schema (idempotent) and ensures a default product + admin exist.
 * Safe to run on every container start.
 */
export function migrate(): void {
  runSchema();
  ensureDefaultProduct();
  ensureAdminFromEnv();
  // eslint-disable-next-line no-console
  console.log('[migrate] schema ready at', config.dbPath);
}

function ensureDefaultProduct(): void {
  const db = getDb();
  const count = db.prepare('SELECT COUNT(*) AS c FROM products').get() as { c: number };
  if (count.c > 0) return;
  db.prepare(
    `INSERT INTO products (id, name, description, type, price_cents, currency, active, sort_order)
     VALUES (@id, @name, @description, @type, @price_cents, @currency, 1, @sort_order)`,
  ).run({
    id: newId('prod'),
    name: 'Digitaler Download (hohe Auflösung)',
    description: 'Originalfoto in voller Auflösung, ohne Wasserzeichen, als Download.',
    type: 'digital',
    price_cents: 1500,
    currency: config.stripe.currency,
    sort_order: 0,
  });
  db.prepare(
    `INSERT INTO products (id, name, description, type, price_cents, currency, active, sort_order)
     VALUES (@id, @name, @description, @type, @price_cents, @currency, 1, @sort_order)`,
  ).run({
    id: newId('prod'),
    name: 'Abzug 13×18 cm',
    description: 'Gedrucktes Foto auf Fotopapier, Format 13×18 cm.',
    type: 'print',
    price_cents: 600,
    currency: config.stripe.currency,
    sort_order: 1,
  });
  // eslint-disable-next-line no-console
  console.log('[migrate] seeded default products');
}

function ensureAdminFromEnv(): void {
  const db = getDb();
  const { username, passwordHash, plainPassword } = config.admin;
  if (!passwordHash && !plainPassword) return; // nothing configured yet

  const hash = passwordHash || bcrypt.hashSync(plainPassword, 10);
  const existing = db.prepare('SELECT id FROM admin_users WHERE username = ?').get(username) as
    | { id: string }
    | undefined;

  if (existing) {
    db.prepare('UPDATE admin_users SET password_hash = ?, updated_at = datetime(\'now\') WHERE id = ?').run(
      hash,
      existing.id,
    );
  } else {
    db.prepare(
      'INSERT INTO admin_users (id, username, password_hash) VALUES (?, ?, ?)',
    ).run(newId('adm'), username, hash);
  }
  // eslint-disable-next-line no-console
  console.log(`[migrate] admin user '${username}' ensured`);
}

if (require.main === module) {
  migrate();
}
