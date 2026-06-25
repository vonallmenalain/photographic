import bcrypt from 'bcryptjs';
import {
  COL,
  col,
  deleteById,
  firstOf,
  getById,
  nowIso,
  runQuery,
  setById,
  updateById,
} from './index';
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
  await ensureProductsCurrency();
  await ensureAdminFromEnv();
  await ensureAdminEmail();
  await dedupeAdminAccounts();
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

/**
 * Selbstheilend: stellt sicher, dass alle Produkte die konfigurierte Währung
 * (standardmäßig CHF) tragen. Ältere Bestände wurden teils noch mit "eur"
 * angelegt, wodurch die Galerie Preise in Euro statt CHF anzeigte.
 */
async function ensureProductsCurrency(): Promise<void> {
  const target = config.stripe.currency.toLowerCase();
  const products = await runQuery<{ currency?: string }>(col(COL.products));
  let updated = 0;
  for (const p of products) {
    if ((p.currency ?? '').toLowerCase() !== target) {
      await updateById(COL.products, p.id, { currency: target });
      updated += 1;
    }
  }
  if (updated > 0) {
    // eslint-disable-next-line no-console
    console.log(`[migrate] currency normalised to '${target}' for ${updated} product(s)`);
  }
}

async function ensureAdminFromEnv(): Promise<void> {
  const { username, passwordHash, plainPassword, email } = config.admin;
  if (!passwordHash && !plainPassword) return; // nothing configured yet

  const hash = passwordHash || bcrypt.hashSync(plainPassword, 10);
  // E-Mail immer normalisieren (trim + lowercase), damit Login & "Passwort
  // vergessen" sie zuverlässig wiederfinden (Suche läuft ebenfalls normalisiert).
  const normalizedEmail = email ? normalizeEmail(email) : '';
  const emailUpdate = normalizedEmail ? { email: normalizedEmail } : {};

  // Admin-Dokumente sind über ihre ID (= Benutzername) verschlüsselt.
  const existing = await getById<{ username: string }>(COL.adminUsers, username);
  if (existing) {
    // Passwort/E-Mail des passenden Kontos aktualisieren (Env-Recovery-Pfad).
    await updateById(COL.adminUsers, username, {
      password_hash: hash,
      ...emailUpdate,
      updated_at: nowIso(),
    });
    // eslint-disable-next-line no-console
    console.log(`[migrate] admin user '${username}' ensured`);
    return;
  }

  // Kein Dokument unter dem konfigurierten Benutzernamen. Wenn bereits ein
  // anderer Admin existiert (z.B. weil der Benutzername im Adminbereich
  // umbenannt wurde), NICHT erneut "admin" anlegen – sonst würde eine
  // In-App-Umbenennung beim nächsten Start überschrieben.
  const anyAdmin = await firstOf<{ username?: string }>(col(COL.adminUsers).limit(1));
  if (anyAdmin) {
    // eslint-disable-next-line no-console
    console.log(
      `[migrate] admin already exists ('${anyAdmin.username ?? anyAdmin.id}'); ` +
        `skip creating '${username}'. Set ADMIN_USERNAME to that name to reset its password via env.`,
    );
    return;
  }

  // Erststart: Admin-Konto aus der Umgebung anlegen.
  await setById(COL.adminUsers, username, {
    username,
    password_hash: hash,
    ...emailUpdate,
    created_at: nowIso(),
    updated_at: nowIso(),
  });
  // eslint-disable-next-line no-console
  console.log(`[migrate] admin user '${username}' created`);
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

type AdminDoc = {
  id: string;
  username?: string;
  email?: string;
  updated_at?: string;
};

/**
 * Selbstheilend: entfernt doppelte Admin-Konten, die sich dieselbe E-Mail-Adresse
 * teilen. Solche Duplikate konnten entstehen, wenn der Admin im Adminbereich
 * umbenannt wurde (z. B. „admin" → „Alain") und ein älterer Container-Start das
 * Konto unter dem ADMIN_USERNAME aus der Umgebung erneut anlegte. Dadurch lag die
 * E-Mail an zwei Dokumenten an und das Speichern der eigenen Adresse im Konto
 * schlug mit „… wird bereits von einem anderen Konto verwendet" fehl.
 *
 * Pro E-Mail bleibt genau ein Konto bestehen. Bevorzugt wird das umbenannte Konto
 * (ID ≠ ADMIN_USERNAME) – also jenes, das der Nutzer tatsächlich verwendet –,
 * danach das zuletzt aktualisierte. Offene Passwort-Reset-Token werden auf das
 * verbleibende Konto umgehängt, damit „Passwort vergessen" weiter funktioniert.
 */
async function dedupeAdminAccounts(): Promise<void> {
  const all = await runQuery<AdminDoc>(col(COL.adminUsers));
  if (all.length < 2) return;

  // Konten nach normalisierter E-Mail gruppieren (nur solche MIT E-Mail – ohne
  // E-Mail gibt es keinen Konflikt und damit nichts zu bereinigen).
  const groups = new Map<string, AdminDoc[]>();
  for (const doc of all) {
    const email = typeof doc.email === 'string' ? normalizeEmail(doc.email) : '';
    if (!email) continue;
    const list = groups.get(email) ?? [];
    list.push(doc);
    groups.set(email, list);
  }

  const envUsername = config.admin.username;
  for (const [email, docs] of groups) {
    if (docs.length < 2) continue;

    // Authoritatives Konto wählen: das Env-Standardkonto („admin") ans Ende, da
    // es nach einer Umbenennung das ungewollte Duplikat ist; sonst das zuletzt
    // aktualisierte zuerst.
    const sorted = [...docs].sort((a, b) => {
      const aEnv = a.id === envUsername ? 1 : 0;
      const bEnv = b.id === envUsername ? 1 : 0;
      if (aEnv !== bEnv) return aEnv - bEnv;
      return String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? ''));
    });

    const [keep, ...duplicates] = sorted;
    for (const dup of duplicates) {
      // Offene Reset-Token auf das verbleibende Konto umhängen.
      const resets = await runQuery<{ username: string }>(
        col(COL.adminPasswordResets).where('username', '==', dup.id),
      );
      await Promise.all(
        resets.map((r) =>
          updateById(COL.adminPasswordResets, r.id, { username: keep.username ?? keep.id }),
        ),
      );
      await deleteById(COL.adminUsers, dup.id);
      // eslint-disable-next-line no-console
      console.log(
        `[migrate] removed duplicate admin '${dup.username ?? dup.id}' sharing e-mail ${email}; ` +
          `kept '${keep.username ?? keep.id}'`,
      );
    }
  }
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
