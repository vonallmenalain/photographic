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
import {
  PRODUCT_CATALOG,
  PRODUCT_CATALOG_VERSION,
  RETIRED_PRODUCT_NAMES,
  type ProductDoc,
} from '../services/products';

/**
 * Firestore needs no schema, but we still seed sensible defaults (a starter
 * product list + the admin user from the environment). Safe to run on every
 * container start.
 */
export async function migrate(): Promise<void> {
  await ensureProductCatalog();
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

const PRODUCT_CATALOG_SETTINGS_ID = 'product_catalog';

/**
 * Spielt den aktuellen Produktkatalog (Sortiment + Preise, siehe
 * services/products.ts) genau EINMAL pro Katalog-Version ein – auch in bereits
 * bestehenden Datenbanken. Die eingespielte Version wird im Dokument
 * `settings/product_catalog` gemerkt; solange sie aktuell ist, bleiben die
 * Produkte unangetastet (nachträgliche Anpassungen per Admin-API überleben
 * also jeden Neustart).
 *
 *  - Erststart (leere Sammlung): alle Katalog-Produkte werden angelegt.
 *  - Bestehende Datenbank: vorhandene Produkte werden über ihren `code` bzw.
 *    ihren bisherigen Namen wiedererkannt und aktualisiert (Name, Preis,
 *    Zusatzpreis, Art, „digital inbegriffen“, Verfügbarkeit); fehlende werden
 *    ergänzt. Nicht mehr angebotene Produkte (z. B. „Druck 16×21 cm“) werden
 *    deaktiviert, bleiben aber für alte Bestellungen erhalten.
 */
async function ensureProductCatalog(): Promise<void> {
  const marker = await getById<{ version?: number }>(COL.settings, PRODUCT_CATALOG_SETTINGS_ID);
  if ((marker?.version ?? 0) >= PRODUCT_CATALOG_VERSION) return;

  const existing = await runQuery<ProductDoc>(col(COL.products));
  const byCode = new Map<string, (typeof existing)[number]>();
  const byName = new Map<string, (typeof existing)[number]>();
  for (const p of existing) {
    if (p.code) byCode.set(p.code, p);
    const name = (p.name ?? '').trim();
    if (name && !byName.has(name)) byName.set(name, p);
  }

  const claimed = new Set<string>();
  let created = 0;
  let updated = 0;
  for (const entry of PRODUCT_CATALOG) {
    const fields = {
      code: entry.code,
      name: entry.name,
      description: entry.description,
      type: entry.type,
      kind: entry.kind,
      price_cents: entry.price_cents,
      additional_price_cents: entry.additional_price_cents,
      includes_digital: entry.includes_digital ? 1 : 0,
      scope: entry.scope,
      currency: config.stripe.currency,
      active: 1,
      sort_order: entry.sort_order,
      updated_at: nowIso(),
    };
    const match =
      byCode.get(entry.code) ??
      [entry.name, ...entry.legacy_names]
        .map((n) => byName.get(n))
        .find((p) => p && !claimed.has(p.id));
    if (match) {
      claimed.add(match.id);
      await updateById(COL.products, match.id, fields);
      updated += 1;
    } else {
      const id = newId('prod');
      await setById(COL.products, id, { ...fields, created_at: nowIso() });
      claimed.add(id);
      created += 1;
    }
  }

  // Produkte aus früheren Versionen, die nicht mehr angeboten werden.
  let retired = 0;
  for (const p of existing) {
    if (claimed.has(p.id)) continue;
    if (!RETIRED_PRODUCT_NAMES.includes((p.name ?? '').trim())) continue;
    if (Number(p.active) === 1) {
      await updateById(COL.products, p.id, { active: 0, updated_at: nowIso() });
      retired += 1;
    }
  }

  await setById(COL.settings, PRODUCT_CATALOG_SETTINGS_ID, {
    version: PRODUCT_CATALOG_VERSION,
    updated_at: nowIso(),
  });
  // eslint-disable-next-line no-console
  console.log(
    `[migrate] product catalogue v${PRODUCT_CATALOG_VERSION} applied: ${created} created, ${updated} updated, ${retired} retired`,
  );
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
