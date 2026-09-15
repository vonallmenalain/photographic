import { COL, col, runQuery, getManyById, setById, linkId, nowIso } from '../db';

/**
 * Gemeinsame Helfer für Einladungen und Erinnerungen an die Eltern eines
 * Auftrags – genutzt vom Adminbereich (manueller Versand) und von den
 * automatischen Erinnerungen (services/autoReminders.ts).
 */

/**
 * Collects the distinct parent e-mail ids connected to an Auftrag (event):
 * either through a child of that event or through a direct photo assignment.
 * Mirrors the filter logic of GET /emails?eventId=…
 */
export async function eventEmailIds(eventId: string): Promise<Set<string>> {
  const [children, photos, childLinks, photoLinks] = await Promise.all([
    runQuery<{ id: string }>(col(COL.children).where('event_id', '==', eventId)),
    runQuery<{ id: string }>(col(COL.photos).where('event_id', '==', eventId)),
    runQuery<{ email_id: string; child_id: string }>(col(COL.emailChildren)),
    runQuery<{ email_id: string; photo_id: string }>(col(COL.photoEmails)),
  ]);
  const childIds = new Set(children.map((c) => c.id));
  const photoIds = new Set(photos.map((p) => p.id));
  const ids = new Set<string>();
  for (const l of childLinks) if (childIds.has(l.child_id)) ids.add(l.email_id);
  for (const l of photoLinks) if (photoIds.has(l.photo_id)) ids.add(l.email_id);
  return ids;
}

/**
 * Email ids that have a confirmed (pending/completed) order within this event.
 * An order belongs to the event when at least one of its items references a
 * photo of that event.
 */
export async function orderedEmailIdsForEvent(eventId: string): Promise<Set<string>> {
  const [photos, orders, orderItems] = await Promise.all([
    runQuery<{ id: string }>(col(COL.photos).where('event_id', '==', eventId)),
    runQuery<{ id: string; email_id: string; status: string }>(col(COL.orders)),
    runQuery<{ order_id: string; photo_id: string }>(col(COL.orderItems)),
  ]);
  const photoIds = new Set(photos.map((p) => p.id));
  const orderById = new Map(orders.map((o) => [o.id, o]));
  const ordered = new Set<string>();
  for (const item of orderItems) {
    if (!photoIds.has(item.photo_id)) continue;
    const order = orderById.get(item.order_id);
    if (!order) continue;
    if (order.status === 'pending' || order.status === 'completed') {
      ordered.add(order.email_id);
    }
  }
  return ordered;
}

/** Remaining days until the gallery is archived (null when no/expired date). */
export function daysLeftUntil(expiresAt: string | null): number | null {
  if (!expiresAt) return null;
  const end = new Date(expiresAt).getTime();
  if (isNaN(end)) return null;
  const days = Math.ceil((end - Date.now()) / (24 * 60 * 60 * 1000));
  return days > 0 ? days : null;
}

interface EventInvitation {
  event_id: string;
  email_id: string;
  first_sent_at: string;
  last_sent_at: string;
  count: number;
}

/**
 * Protokolliert je E-Mail-Adresse, dass die Einladung zu diesem Auftrag erfolgreich
 * versendet wurde. Deterministische Doc-Id (event__email) verhindert Duplikate;
 * beim erneuten Versand bleibt der erste Zeitpunkt erhalten und der Zähler steigt.
 * Gilt für die Galerie-Einladung ebenso wie für die Einladung zum Einverständnis.
 */
export async function recordInvitationsSent(eventId: string, emailIds: string[]): Promise<void> {
  const unique = [...new Set(emailIds.filter(Boolean))];
  if (unique.length === 0) return;
  const now = nowIso();
  const existing = await getManyById<EventInvitation>(
    COL.eventInvitations,
    unique.map((id) => linkId(eventId, id)),
  );
  await Promise.all(
    unique.map((emailId) => {
      const docId = linkId(eventId, emailId);
      const prev = existing.get(docId);
      return setById(COL.eventInvitations, docId, {
        event_id: eventId,
        email_id: emailId,
        first_sent_at: prev?.first_sent_at ?? now,
        last_sent_at: now,
        count: (prev?.count ?? 0) + 1,
      });
    }),
  );
}

/** Map emailId -> last invitation send timestamp for an event. */
export async function invitationsSentForEvent(eventId: string): Promise<Map<string, string>> {
  const rows = await runQuery<EventInvitation>(
    col(COL.eventInvitations).where('event_id', '==', eventId),
  );
  const out = new Map<string, string>();
  for (const r of rows) out.set(r.email_id, r.last_sent_at);
  return out;
}
