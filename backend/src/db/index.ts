import { db, admin } from '../lib/firebase';

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
  const snap = await col(name).doc(id).get();
  if (!snap.exists) return null;
  return snapToDoc<T>(snap);
}

export async function exists(name: string, id: string): Promise<boolean> {
  if (!id) return false;
  const snap = await col(name).doc(id).get();
  return snap.exists;
}

/** Inserts (or overwrites) a document with the given id. */
export async function setById<T extends Record<string, unknown>>(
  name: string,
  id: string,
  data: T,
): Promise<void> {
  await col(name).doc(id).set(data);
}

export async function updateById(
  name: string,
  id: string,
  data: Record<string, unknown>,
): Promise<void> {
  await col(name).doc(id).update(data);
}

export async function deleteById(name: string, id: string): Promise<void> {
  await col(name).doc(id).delete();
}

/** Materialises a query into typed documents. */
export async function runQuery<T>(
  query: admin.firestore.Query,
): Promise<Doc<T>[]> {
  const snap = await query.get();
  return snap.docs.map((d) => snapToDoc<T>(d));
}

export async function firstOf<T>(query: admin.firestore.Query): Promise<Doc<T> | null> {
  const snap = await query.limit(1).get();
  if (snap.empty) return null;
  return snapToDoc<T>(snap.docs[0]);
}

/** Deletes every document matched by a query, in batches. */
export async function deleteWhere(query: admin.firestore.Query): Promise<number> {
  const snap = await query.get();
  if (snap.empty) return 0;
  let deleted = 0;
  // Firestore batches are limited to 500 writes.
  for (let i = 0; i < snap.docs.length; i += 450) {
    const batch = db().batch();
    for (const d of snap.docs.slice(i, i + 450)) batch.delete(d.ref);
    await batch.commit();
    deleted += Math.min(450, snap.docs.length - i);
  }
  return deleted;
}

/** Composite id for many-to-many link documents. */
export function linkId(a: string, b: string): string {
  return `${a}__${b}`;
}

/** Counts documents matched by a query using server-side aggregation. */
export async function countQuery(query: admin.firestore.Query): Promise<number> {
  const snap = await query.count().get();
  return snap.data().count;
}

export { db };
