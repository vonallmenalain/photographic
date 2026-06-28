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
  await ensurePrintProduct16x21();
  await ensureProductsCurrency();
  await ensureAdminFromEnv();
  await ensureAdminEmail();
  await dedupeAdminAccounts();
  await normalizeOrderStatuses();
  // eslint-disable-next-line no-console
  console.log(`[migrate] Firestore ready (project=${config.firebase.projectId})`);
}

/**
 * Selbstheilend: bringt bestehende Bestellungen auf den vereinfachten
 * Status-Lebenszyklus (pending / completed / cancelled). Frühere Stati wie
 * `paid`, `fulfilled`, `failed` oder `refunded` werden einmalig umgeschrieben.
 *
 *  - `fulfilled`            → `completed`
 *  - `paid`                 → `pending`, falls die Bestellung ein Druckprodukt
 *                             enthält, sonst `completed`
 *  - `failed` / `refunded`  → `cancelled`
 *
 * `cart` und `checkout_started` bleiben als interne Zustände des Kaufflusses
 * unangetastet, ebenso bereits vereinfachte Bestellungen.
 */
async function normalizeOrderStatuses(): Promise<void> {
  const orders = await runQuery<{ status: string }>(col(COL.orders));
  const legacy = orders.filter((o) =>
    ['paid', 'fulfilled', 'failed', 'refunded'].includes(o.status),
  );
  if (legacy.length === 0) return;

  const products = await runQuery<{ id: string; type: string }>(col(COL.products));
  const productType = new Map(products.map((p) => [p.id, p.type]));

  let updated = 0;
  for (const order of legacy) {
    let next: string;
    if (order.status === 'fulfilled') {
      next = 'completed';
    } else if (order.status === 'failed' || order.status === 'refunded') {
      next = 'cancelled';
    } else {
      // paid – depends on whether a print product is part of the order.
      const items = await runQuery<{ product_id: string }>(
        col(COL.orderItems).where('order_id', '==', order.id),
      );
      const hasPrint = items.some((it) => productType.get(it.product_id) === 'print');
      next = hasPrint ? 'pending' : 'completed';
    }
    await updateById(COL.orders, order.id, { status: next, updated_at: nowIso() });
    updated += 1;
  }
  // eslint-disable-next-line no-console
  console.log(`[migrate] normalised ${updated} legacy order status(es)`);
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
    {
      name: 'Druck 16×21 cm',
      description: 'Gedrucktes Foto auf Fotopapier, Format 16×21 cm.',
      type: 'print',
      price_cents: 1000,
      sort_order: 2,
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
 * Selbstheilend: stellt sicher, dass das Druckprodukt „16×21 cm" (10.-) auch in
 * bereits bestehenden Datenbanken verfügbar ist. `ensureDefaultProducts` legt
 * Produkte nur beim allerersten Start an (leere Collection); ältere Bestände
 * kennen daher nur „13×18 cm". Diese Migration ergänzt das neue Format genau
 * einmal und ist über den Produktnamen idempotent.
 */
async function ensurePrintProduct16x21(): Promise<void> {
  const name = 'Druck 16×21 cm';
  const products = await runQuery<{ name?: string }>(col(COL.products));
  if (products.length === 0) return; // Erststart: ensureDefaultProducts übernimmt
  if (products.some((p) => (p.name ?? '').trim() === name)) return;

  const id = newId('prod');
  await setById(COL.products, id, {
    name,
    description: 'Gedrucktes Foto auf Fotopapier, Format 16×21 cm.',
    type: 'print',
    price_cents: 1000,
    currency: config.stripe.currency,
    active: 1,
    sort_order: 2,
    created_at: nowIso(),
  });
  // eslint-disable-next-line no-console
  console.log('[migrate] seeded print product 16×21');
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

/**
 * Seedet den Admin-Zugang aus der Umgebung – aber NUR beim Erststart (solange
 * noch kein Admin existiert). Ein bereits in Firestore hinterlegtes Passwort ist
 * danach die alleinige Quelle der Wahrheit und wird hier bewusst NICHT mehr
 * überschrieben. So überlebt ein im Adminbereich oder per „Passwort vergessen"
 * gesetztes Passwort jeden Neustart/Deploy (Watchtower & Co.).
 *
 * Für den Notfall (Aussperrung) gibt es den ausdrücklichen, einmaligen Schalter
 * ADMIN_PASSWORD_RESET_ON_BOOT=true: nur dann wird das Passwort des
 * konfigurierten Admins aus der Umgebung erzwungen. Danach sollte der Schalter
 * wieder auf false stehen (und ADMIN_PASSWORD/ADMIN_PASSWORD_HASH idealerweise
 * geleert werden), damit das nächste selbst gesetzte Passwort wieder bestehen
 * bleibt.
 */
async function ensureAdminFromEnv(): Promise<void> {
  const { username, passwordHash, plainPassword, email, passwordResetOnBoot } = config.admin;
  // E-Mail immer normalisieren (trim + lowercase), damit Login & "Passwort
  // vergessen" sie zuverlässig wiederfinden (Suche läuft ebenfalls normalisiert).
  const normalizedEmail = email ? normalizeEmail(email) : '';
  const emailUpdate = normalizedEmail ? { email: normalizedEmail } : {};

  // Admin-Dokumente sind über ihre ID (= Benutzername) adressiert.
  const existing = await getById<{ username: string }>(COL.adminUsers, username);
  if (existing) {
    // Wiederherstellungs-Pfad: NUR wenn ausdrücklich gewünscht überschreiben wir
    // das Passwort eines bestehenden Kontos aus der Umgebung. Das ist der einzige
    // Fall, in dem die .env ein im Adminbereich/per Reset gesetztes Passwort
    // ersetzt – gedacht für eine Aussperrung.
    if (passwordResetOnBoot && (passwordHash || plainPassword)) {
      const hash = passwordHash || bcrypt.hashSync(plainPassword, 10);
      await updateById(COL.adminUsers, username, {
        password_hash: hash,
        ...emailUpdate,
        updated_at: nowIso(),
      });
      // eslint-disable-next-line no-console
      console.warn(
        `[migrate] ADMIN_PASSWORD_RESET_ON_BOOT=true: Passwort von Admin '${username}' wurde aus der ` +
          `Umgebung zurückgesetzt. Setze ADMIN_PASSWORD_RESET_ON_BOOT wieder auf false (und leere ` +
          `idealerweise ADMIN_PASSWORD/ADMIN_PASSWORD_HASH), damit ein selbst gesetztes Passwort ` +
          `künftige Neustarts übersteht.`,
      );
      return;
    }
    // Standardfall: das in Firestore gespeicherte Passwort bleibt unangetastet.
    return;
  }

  // Kein Dokument unter dem konfigurierten Benutzernamen.
  if (!passwordHash && !plainPassword) return; // nichts zum Seeden vorhanden

  // Wenn bereits ein anderer Admin existiert (z.B. weil der Benutzername im
  // Adminbereich umbenannt wurde), NICHT erneut "admin" anlegen – sonst würde
  // eine In-App-Umbenennung beim nächsten Start dupliziert.
  const anyAdmin = await firstOf<{ username?: string }>(col(COL.adminUsers).limit(1));
  if (anyAdmin) {
    // eslint-disable-next-line no-console
    console.log(
      `[migrate] admin already exists ('${anyAdmin.username ?? anyAdmin.id}'); ` +
        `skip creating '${username}'.`,
    );
    return;
  }

  // Erststart: Admin-Konto aus der Umgebung anlegen.
  const hash = passwordHash || bcrypt.hashSync(plainPassword, 10);
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
