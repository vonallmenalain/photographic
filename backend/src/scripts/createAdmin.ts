import bcrypt from 'bcryptjs';
import { COL, getById, setById, updateById, nowIso } from '../db';
import { normalizeEmail } from '../lib/validation';

/**
 * Usage: node dist/scripts/createAdmin.js <username> <password> [email]
 *
 * Creates or updates an admin user (stored in Firestore) with a bcrypt hash.
 * Optionally sets the admin e-mail address used for the "Passwort vergessen"
 * (password reset) flow and for logging in by e-mail. The e-mail is normalised
 * (trimmed + lowercased) so login and reset always find it again.
 *
 * This is the SMTP-independent recovery path: run it directly on the server to
 * set a fresh password and register your admin e-mail, even when no mail server
 * is configured yet.
 */
async function main() {
  const [, , username, password, emailArg] = process.argv;
  if (!username || !password) {
    console.error('Usage: npm run create-admin -- <username> <password> [email]');
    process.exit(1);
  }
  const hash = bcrypt.hashSync(password, 10);
  const email = emailArg ? normalizeEmail(emailArg) : '';
  const emailUpdate = email ? { email } : {};
  const existing = await getById<{ username: string }>(COL.adminUsers, username);
  if (existing) {
    await updateById(COL.adminUsers, username, {
      password_hash: hash,
      ...emailUpdate,
      updated_at: nowIso(),
    });
    console.log(`Updated admin '${username}'.`);
  } else {
    await setById(COL.adminUsers, username, {
      username,
      password_hash: hash,
      ...emailUpdate,
      created_at: nowIso(),
      updated_at: nowIso(),
    });
    console.log(`Created admin '${username}'.`);
  }
  if (email) {
    console.log(`Admin e-mail set to '${email}' (usable for login and password reset).`);
  } else {
    console.log('No e-mail provided – pass one as the 3rd argument to enable e-mail login/reset.');
  }
  console.log('\nBcrypt hash (for ADMIN_PASSWORD_HASH env on Netlify/QNAP):');
  console.log(hash);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
