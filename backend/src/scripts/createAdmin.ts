import bcrypt from 'bcryptjs';
import { getDb, runSchema } from '../db';
import { newId } from '../lib/ids';

/**
 * Usage: node dist/scripts/createAdmin.js <username> <password>
 * Creates or updates an admin user with a bcrypt-hashed password.
 */
function main() {
  const [, , username, password] = process.argv;
  if (!username || !password) {
    console.error('Usage: npm run create-admin -- <username> <password>');
    process.exit(1);
  }
  runSchema();
  const db = getDb();
  const hash = bcrypt.hashSync(password, 10);
  const existing = db.prepare('SELECT id FROM admin_users WHERE username = ?').get(username) as
    | { id: string }
    | undefined;
  if (existing) {
    db.prepare("UPDATE admin_users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?").run(
      hash,
      existing.id,
    );
    console.log(`Updated admin '${username}'.`);
  } else {
    db.prepare('INSERT INTO admin_users (id, username, password_hash) VALUES (?, ?, ?)').run(
      newId('adm'),
      username,
      hash,
    );
    console.log(`Created admin '${username}'.`);
  }
  console.log('\nBcrypt hash (for ADMIN_PASSWORD_HASH env on Netlify/QNAP):');
  console.log(hash);
}

main();
