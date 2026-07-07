import { db, admin } from '../lib/firebase';
import { timed } from '../lib/perf';

/** Best-effort label for a Firestore query (collection + filters) for logs. */
function queryLabel(query: admin.firestore.Query): string {
  const anyQuery = query as unknown as {
    _queryOptions?: { collectionId?: string; fieldFilters?: unknown[] };
  };
  const opts = anyQuery._queryOptions;
  const collection = opts?.collectionId ?? 'query';
  const filters = opts?.fieldFilters?.length ? `[${opts.fieldFilters.length} filter]` : '';
  return `${collection}.get${filters}`;
}

/**
 * Central data layer. The whole datastore lives in Cloud Firestore. Collections
 * mirror the previous SQLite tables 1:1 (same snake_case field names) so the API
 * responses stay byte-for-byte compatible with the frontend.
 *
 * Relationship tables (many-to-many) are kept as their own collections with a
 * deterministic composite document id, e.g. `email_children/{emailId}__{childId}`.
 */

export const COL = {
  adminUsers: 'admin_users',
  adminPasswordResets: 'admin_password_resets',
  events: 'events',
  children: 'children',
  parentEmails: 'parent_emails',
  emailChildren: 'email_children',
  photos: 'photos',
  photoEmails: 'photo_emails',
  verificationTokens: 'verification_tokens',
  parentSessions: 'parent_sessions',
  products: 'products',
  orders: 'orders',
  orderItems: 'order_items',
  downloadGrants: 'download_grants',
  reports: 'reports',
  reminders: 'reminders',
  // Pro (Auftrag, E-Mail-Adresse) protokollierter Einladungs-Versand, damit im
  // Versand-Popup sichtbar ist, an welche Adressen die Einladung bereits ging.
  eventInvitations: 'event_invitations',
  auditLog: 'audit_log',
} as const;

export type Doc<T> = T & { id: string };

export function col(name: string): admin.firestore.CollectionReference {
  return db().collection(name);
}

/** ISO timestamp string (lexicographically comparable, frontend-friendly). */
export function nowIso(): string {
  return new Date().toISOString();
}

export function snapToDoc<T>(snap: admin.firestore.DocumentSnapshot): Doc<T> {
  return { id: snap.id, ...(snap.data() as T) };
}

export async function getById<T>(name: string, id: string): Promise<Doc<T> | null> {
  if (!id) return null;
  const snap = await timed(
    `${name}.doc.get`,
    () => col(name).doc(id).get(),
    (s) => ({ docs: s.exists ? 1 : 0 }),
  );
  if (!snap.exists) return null;
  return snapToDoc<T>(snap);
}

export async function exists(name: string, id: string): Promise<boolean> {
  if (!id) return false;
  const snap = await timed(
    `${name}.doc.get`,
    () => col(name).doc(id).get(),
    (s) => ({ docs: s.exists ? 1 : 0 }),
  );
  return snap.exists;
}

/** Inserts (or overwrites) a document with the given id. */
export async function setById<T extends Record<string, unknown>>(
  name: string,
  id: string,
  data: T,
): Promise<void> {
  await timed(`${name}.doc.set`, () => col(name).doc(id).set(data), () => ({ writes: 1 }));
}

export async function updateById(
  name: string,
  id: string,
  data: Record<string, unknown>,
): Promise<void> {
  await timed(`${name}.doc.update`, () => col(name).doc(id).update(data), () => ({ writes: 1 }));
}

export async function deleteById(name: string, id: string): Promise<void> {
  await timed(`${name}.doc.delete`, () => col(name).doc(id).delete(), () => ({ writes: 1 }));
}

/** Materialises a query into typed documents. */
export async function runQuery<T>(
  query: admin.firestore.Query,
): Promise<Doc<T>[]> {
  const snap = await timed(queryLabel(query), () => query.get(), (s) => ({ docs: s.size }));
  return snap.docs.map((d) => snapToDoc<T>(d));
}

export async function firstOf<T>(query: admin.firestore.Query): Promise<Doc<T> | null> {
  const snap = await timed(
    `${queryLabel(query)}.limit(1)`,
    () => query.limit(1).get(),
    (s) => ({ docs: s.size }),
  );
  if (snap.empty) return null;
  return snapToDoc<T>(snap.docs[0]);
}

/** Deletes every document matched by a query, in batches. */
export async function deleteWhere(query: admin.firestore.Query): Promise<number> {
  const snap = await timed(
    `${queryLabel(query)} (deleteWhere)`,
    () => query.get(),
    (s) => ({ docs: s.size }),
  );
  if (snap.empty) return 0;
  let deleted = 0;
  // Firestore batches are limited to 500 writes.
  for (let i = 0; i < snap.docs.length; i += 450) {
    const slice = snap.docs.slice(i, i + 450);
    await timed(
      `${queryLabel(query)} (batch.delete)`,
      () => {
        const batch = db().batch();
        for (const d of slice) batch.delete(d.ref);
        return batch.commit();
      },
      () => ({ writes: slice.length }),
    );
    deleted += slice.length;
  }
  return deleted;
}

/** Composite id for many-to-many link documents. */
export function linkId(a: string, b: string): string {
  return `${a}__${b}`;
}

/** Counts documents matched by a query using server-side aggregation. */
export async function countQuery(query: admin.firestore.Query): Promise<number> {
  const snap = await timed(
    `${queryLabel(query)}.count`,
    () => query.count().get(),
    () => ({ docs: 1 }),
  );
  return snap.data().count;
}

/**
 * Fetches many documents by id in a single Firestore round-trip via getAll().
 * Far cheaper than scanning an entire collection when you only need a known,
 * bounded set of documents (e.g. the photos referenced by a few links).
 */
export async function getManyById<T>(name: string, ids: string[]): Promise<Map<string, Doc<T>>> {
  const out = new Map<string, Doc<T>>();
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return out;
  const refs = unique.map((id) => col(name).doc(id));
  const snaps = await timed(
    `${name}.getAll(${unique.length})`,
    () => db().getAll(...refs),
    (list) => ({ docs: list.filter((s) => s.exists).length }),
  );
  for (const snap of snaps) {
    if (snap.exists) out.set(snap.id, snapToDoc<T>(snap));
  }
  return out;
}

export { db };
