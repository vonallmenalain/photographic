import { COL, col, runQuery, getManyById, setById, linkId, nowIso } from '../db';
import { newId } from '../lib/ids';

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
  /** Erster/letzter Versand irgendeiner Art (Einladung, Erinnerung, Einverständnis, Klassenerfassung). */
  first_sent_at: string;
  last_sent_at: string;
  count: number;
  /** Zuletzt versendete Aufforderung zur Einverständniserklärung (falls je eine). */
  consent_sent_at?: string | null;
  /** Galerie-Einladung „Ihre Fotos sind bereit“: erster und letzter Versand. */
  first_invited_at?: string | null;
  invited_at?: string | null;
  /** Galerie-Erinnerung „Ihre Fotos sind noch X Tage verfügbar“ (manuell oder automatisch). */
  reminded_at?: string | null;
  reminder_count?: number;
}

/**
 * Art eines Versands an eine Adresse:
 *  - `invitation`   Galerie-Einladung („Ihre Fotos sind bereit“)
 *  - `reminder`     Galerie-Erinnerung („… noch X Tage verfügbar“)
 *  - `consent`      Aufforderung zur Einverständniserklärung
 *  - `registration` Bestätigungs-Einladung der Klassenerfassung ohne Einverständnis
 */
export type InvitationKind = 'invitation' | 'reminder' | 'consent' | 'registration';

/**
 * Zeitpunkt der letzten Galerie-Einladung. Ältere Einträge kennen die Felder
 * `invited_at`/`first_invited_at` noch nicht – dort zählte jeder Versand als
 * Einladung, ausser er war die Aufforderung zur Einverständniserklärung.
 */
function legacyInvitation(r: EventInvitation): { first: string | null; last: string | null } {
  if (r.invited_at !== undefined || r.first_invited_at !== undefined) {
    return { first: r.first_invited_at ?? r.invited_at ?? null, last: r.invited_at ?? null };
  }
  if (r.consent_sent_at && r.consent_sent_at === r.last_sent_at) {
    // Der letzte Versand war die Einverständnis-Aufforderung; ein früherer
    // Versand (first_sent_at) kann noch eine Galerie-Einladung gewesen sein.
    const earlier = r.first_sent_at && r.first_sent_at !== r.consent_sent_at ? r.first_sent_at : null;
    return { first: earlier, last: earlier };
  }
  return { first: r.first_sent_at ?? r.last_sent_at ?? null, last: r.last_sent_at ?? null };
}

/**
 * Protokolliert je E-Mail-Adresse, dass eine E-Mail zu diesem Auftrag erfolgreich
 * versendet wurde. Deterministische Doc-Id (event__email) verhindert Duplikate;
 * beim erneuten Versand bleibt der erste Zeitpunkt erhalten und der Zähler steigt.
 * `kind` hält zusätzlich fest, ob es eine Galerie-Einladung, eine Erinnerung oder
 * eine Aufforderung zum Einverständnis war.
 */
export async function recordInvitationsSent(
  eventId: string,
  emailIds: string[],
  opts: { kind?: InvitationKind } = {},
): Promise<void> {
  const unique = [...new Set(emailIds.filter(Boolean))];
  if (unique.length === 0) return;
  const kind: InvitationKind = opts.kind ?? 'invitation';
  const now = nowIso();
  const existing = await getManyById<EventInvitation>(
    COL.eventInvitations,
    unique.map((id) => linkId(eventId, id)),
  );
  await Promise.all(
    unique.map((emailId) => {
      const docId = linkId(eventId, emailId);
      const prev = existing.get(docId);
      const legacy = prev ? legacyInvitation(prev) : { first: null, last: null };
      return setById(COL.eventInvitations, docId, {
        event_id: eventId,
        email_id: emailId,
        first_sent_at: prev?.first_sent_at ?? now,
        last_sent_at: now,
        count: (prev?.count ?? 0) + 1,
        consent_sent_at: kind === 'consent' ? now : prev?.consent_sent_at ?? null,
        first_invited_at: legacy.first ?? (kind === 'invitation' ? now : null),
        invited_at: kind === 'invitation' ? now : legacy.last,
        reminded_at: kind === 'reminder' ? now : prev?.reminded_at ?? null,
        reminder_count: (prev?.reminder_count ?? 0) + (kind === 'reminder' ? 1 : 0),
      });
    }),
  );
}

/** Map emailId -> letzter Versand (irgendeiner Art) für die Klassenerfassung. */
export async function invitationsSentForEvent(eventId: string): Promise<Map<string, string>> {
  const rows = await runQuery<EventInvitation>(
    col(COL.eventInvitations).where('event_id', '==', eventId),
  );
  const out = new Map<string, string>();
  for (const r of rows) out.set(r.email_id, r.last_sent_at);
  return out;
}

/** Versandstand einer Adresse in einem Auftrag (Galerie-Einladung, Erinnerungen, Einverständnis). */
export interface InvitationStatus {
  firstInvitedAt: string | null;
  invitedAt: string | null;
  remindedAt: string | null;
  reminderCount: number;
  consentSentAt: string | null;
}

/** Map emailId -> Versandstand für alle Adressen eines Auftrags. */
export async function invitationStatusForEvent(eventId: string): Promise<Map<string, InvitationStatus>> {
  const rows = await runQuery<EventInvitation>(
    col(COL.eventInvitations).where('event_id', '==', eventId),
  );
  const out = new Map<string, InvitationStatus>();
  for (const r of rows) {
    const legacy = legacyInvitation(r);
    out.set(r.email_id, {
      firstInvitedAt: legacy.first,
      invitedAt: legacy.last,
      remindedAt: r.reminded_at ?? null,
      reminderCount: r.reminder_count ?? 0,
      consentSentAt: r.consent_sent_at ?? null,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Versand-Verlauf je Auftrag (Sammlung `reminders`)
// ---------------------------------------------------------------------------

/**
 * Art eines Eintrags im Versand-Verlauf eines Auftrags. `manual` sind von Hand
 * protokollierte Einträge aus früheren Versionen.
 */
export type DispatchKind =
  | 'invitation'
  | 'reminder'
  | 'auto_reminder'
  | 'consent'
  | 'consent_reminder'
  | 'manual';

const DISPATCH_KINDS: DispatchKind[] = [
  'invitation',
  'reminder',
  'auto_reminder',
  'consent',
  'consent_reminder',
  'manual',
];

/** Schreibt einen Eintrag in den Versand-Verlauf (erscheint im Verlauf und in der Umsatzgrafik). */
export async function logDispatch(
  eventId: string,
  kind: DispatchKind,
  count: number,
  note: string,
): Promise<void> {
  await setById(COL.reminders, newId('rem'), {
    event_id: eventId,
    kind,
    count,
    sent_at: nowIso(),
    note,
    created_at: nowIso(),
  });
}

/**
 * Art eines Verlaufseintrags. Ältere Einträge haben noch kein `kind`; sie werden
 * an ihrer (vom System erzeugten) Notiz erkannt.
 */
export function dispatchKindOf(r: { kind?: string; note?: string }): DispatchKind {
  if (r.kind && (DISPATCH_KINDS as string[]).includes(r.kind)) return r.kind as DispatchKind;
  const note = String(r.note ?? '').trim();
  if (/einverständnis/i.test(note)) return /erinnerung/i.test(note) ? 'consent_reminder' : 'consent';
  if (/^automatische erinnerung/i.test(note)) return 'auto_reminder';
  if (/^einladung per e-mail/i.test(note)) return 'invitation';
  if (/^erinnerung per e-mail/i.test(note)) return 'reminder';
  return 'manual';
}

/** Anzahl Empfänger eines Verlaufseintrags (bei älteren Einträgen aus der Notiz gelesen). */
export function dispatchCountOf(r: { count?: number; note?: string }): number | null {
  if (typeof r.count === 'number') return r.count;
  const m = /an (\d+) E-Mail-Adresse/.exec(String(r.note ?? ''));
  return m ? Number(m[1]) : null;
}
