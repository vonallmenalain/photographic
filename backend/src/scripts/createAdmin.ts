import bcrypt from 'bcryptjs';
import { COL, getById, setById, updateById, nowIso } from '../db';

/**
 * Usage: node dist/scripts/createAdmin.js <username> <password>
 * Creates or updates an admin user (stored in Firestore) with a bcrypt hash.
 */
async function main() {
  const [, , username, password] = process.argv;
  if (!username || !password) {
    console.error('Usage: npm run create-admin -- <username> <password>');
    process.exit(1);
  }
  const hash = bcrypt.hashSync(password, 10);
  const existing = await getById<{ username: string }>(COL.adminUsers, username);
  if (existing) {
    await updateById(COL.adminUsers, username, { password_hash: hash, updated_at: nowIso() });
    console.log(`Updated admin '${username}'.`);
  } else {
    await setById(COL.adminUsers, username, {
      username,
      password_hash: hash,
      created_at: nowIso(),
      updated_at: nowIso(),
    });
    console.log(`Created admin '${username}'.`);
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
