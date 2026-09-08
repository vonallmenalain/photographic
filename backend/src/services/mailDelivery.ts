import { COL, col, getById, runQuery, updateById, deleteById, nowIso } from '../db';
import { admin } from '../lib/firebase';
import { config } from '../config';
import { normalizeEmail } from '../lib/validation';
import {
  applyDeliveryEvent,
  clearParentDeliveryProblem,
  type DeliveryDoc,
  type DeliveryStatus,
} from '../lib/mailLog';
import { sendDeliveryProblemEmail } from '../lib/email';
import { getAppSettings, resendWebhookSecret } from './settings';

/**
 * Verarbeitung der Resend-Webhook-Ereignisse und alles, was der Adminbereich
 * zum Zustellprotokoll braucht (Liste, „Erledigt“, Statusübersicht,
 * Benachrichtigung der Admins bei Zustellproblemen).
 *
 * Resend meldet für jede E-Mail (auch für über SMTP verschickte) die Ereignisse
 * `email.sent`, `email.delivered`, `email.delivery_delayed`, `email.bounced`,
 * `email.complained` und `email.failed`. Öffnungen/Klicks werden bewusst nicht
 * ausgewertet.
 */

const STATUS_BY_EVENT: Record<string, DeliveryStatus> = {
  'email.sent': 'sent',
  'email.delivered': 'delivered',
  'email.delivery_delayed': 'delayed',
  'email.bounced': 'bounced',
  'email.complained': 'complained',
  'email.failed': 'failed',
};

/** Marker-Dokument mit dem Stand des Webhooks (für die Anzeige im Adminbereich). */
const WEBHOOK_STATE_ID = 'resend_webhook';

interface ResendEventData {
  email_id?: string;
  from?: string;
  to?: string[] | string;
  subject?: string;
  created_at?: string;
  bounce?: { message?: string; type?: string; subType?: string };
  failed?: { reason?: string };
}

interface ResendEvent {
  type?: string;
  created_at?: string;
  data?: ResendEventData;
}

function firstRecipient(to: string[] | string | undefined): string {
  if (Array.isArray(to)) return normalizeEmail(String(to[0] ?? ''));
  if (typeof to === 'string') return normalizeEmail(to.split(',')[0] ?? '');
  return '';
}

function isoOrNow(value: string | undefined): string {
  if (!value) return nowIso();
  const d = new Date(value);
  return isNaN(d.getTime()) ? nowIso() : d.toISOString();
}

/**
 * Nimmt ein (bereits signaturgeprüftes) Resend-Ereignis entgegen. Unbekannte
 * Ereignistypen werden ignoriert. Gibt zurück, ob das Ereignis verarbeitet wurde.
 */
export async function recordResendEvent(raw: unknown): Promise<{ handled: boolean; status?: DeliveryStatus }> {
  const event = (raw ?? {}) as ResendEvent;
  const type = String(event.type ?? '');
  await touchWebhookState(type);

  const status = STATUS_BY_EVENT[type];
  if (!status) return { handled: false };

  const data = event.data ?? {};
  const to = firstRecipient(data.to);
  const emailId = String(data.email_id ?? '').trim();
  if (!to || !emailId) return { handled: false };

  const reason =
    status === 'bounced'
      ? data.bounce?.message ?? null
      : status === 'failed'
        ? data.failed?.reason ?? null
        : status === 'complained'
          ? 'Der Empfänger hat die E-Mail als Spam gemeldet.'
          : status === 'delayed'
            ? 'Der Empfänger-Server nimmt die E-Mail vorerst nicht an – Resend versucht es weiter.'
            : null;
  const reasonType =
    status === 'bounced'
      ? [data.bounce?.type, data.bounce?.subType].filter(Boolean).join('/') || null
      : null;

  const result = await applyDeliveryEvent({
    // Doc-ID = Resend-E-Mail-ID (UUID), damit alle Ereignisse einer E-Mail im
    // selben Dokument landen.
    id: `res_${emailId.replace(/[^A-Za-z0-9_-]/g, '_')}`,
    provider: 'resend',
    providerEmailId: emailId,
    to,
    subject: String(data.subject ?? '').slice(0, 300),
    status,
    at: isoOrNow(event.created_at ?? data.created_at),
    eventType: type,
    reason: reason ? String(reason).slice(0, 500) : null,
    reasonType,
  });

  if (result.becameProblem) {
    await notifyDeliveryProblem(result.id, result.doc).catch((err) => {
      // eslint-disable-next-line no-console
      console.error('[mail] delivery problem notification failed', err);
    });
  }
  return { handled: true, status };
}

async function touchWebhookState(eventType: string): Promise<void> {
  try {
    await col(COL.settings)
      .doc(WEBHOOK_STATE_ID)
      .set(
        {
          last_event_at: nowIso(),
          last_event_type: eventType,
          events_total: admin.firestore.FieldValue.increment(1),
        },
        { merge: true },
      );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[mail] could not update webhook state', err);
  }
}

/** Alle Admin-Konten mit hinterlegter E-Mail-Adresse. */
export async function allAdminEmails(): Promise<string[]> {
  const admins = await runQuery<{ email?: string }>(col(COL.adminUsers));
  const out: string[] = [];
  for (const a of admins) {
    const email = a.email ? normalizeEmail(a.email) : '';
    if (email && !out.includes(email)) out.push(email);
  }
  if (out.length === 0 && config.admin.email) out.push(normalizeEmail(config.admin.email));
  return out;
}

/**
 * Empfänger einer Admin-Benachrichtigung: die in den Einstellungen hinterlegte
 * Liste, sonst alle Admin-Konten mit E-Mail-Adresse.
 */
export async function notificationRecipients(kind: 'report' | 'bounce'): Promise<string[]> {
  const settings = await getAppSettings();
  const enabled = kind === 'report' ? settings.report_notify_enabled : settings.bounce_notify_enabled;
  if (!enabled) return [];
  const explicit = kind === 'report' ? settings.report_notify_emails : settings.bounce_notify_emails;
  return explicit.length > 0 ? explicit : allAdminEmails();
}

/**
 * Meldet ein neues Zustellproblem per E-Mail an die Admins – genau einmal je
 * E-Mail. Geht die Benachrichtigung selbst an die betroffene Adresse (z. B.
 * weil die Admin-Adresse nicht erreichbar ist), wird nichts verschickt, damit
 * keine Endlosschleife entsteht.
 */
export async function notifyDeliveryProblem(id: string, doc: DeliveryDoc): Promise<void> {
  if (doc.notified_at) return;
  const recipients = (await notificationRecipients('bounce')).filter((r) => r !== doc.to);
  if (recipients.length === 0) return;

  let parent: { email: string; name?: string } | null = null;
  if (doc.parent_email_id) {
    parent = await getById<{ email: string; name?: string }>(COL.parentEmails, doc.parent_email_id);
  }
  await sendDeliveryProblemEmail(recipients, {
    recipient: doc.to,
    subject: doc.subject,
    status: doc.status,
    reason: doc.reason,
    at: doc.status_at,
    parentEmailId: doc.parent_email_id,
    parentName: parent?.name ?? '',
    adminLink: `${config.publicAppUrl}/admin/reports`,
  });
  await updateById(COL.emailDeliveries, id, { notified_at: nowIso(), updated_at: nowIso() });
}

export interface DeliveryView extends DeliveryDoc {
  id: string;
}

/** Zustellprotokoll für den Adminbereich – neueste zuerst. */
export async function listDeliveries(opts: { problemsOnly: boolean; limit?: number }): Promise<DeliveryView[]> {
  const query = opts.problemsOnly
    ? col(COL.emailDeliveries).where('open_problem', '==', 1)
    : col(COL.emailDeliveries);
  const rows = await runQuery<DeliveryDoc>(query);
  return rows
    .sort((a, b) => String(b.status_at).localeCompare(String(a.status_at)))
    .slice(0, opts.limit ?? 200);
}

/** Markiert ein Zustellproblem als erledigt und entfernt den Marker an der Eltern-Adresse. */
export async function acknowledgeDelivery(id: string): Promise<boolean> {
  const doc = await getById<DeliveryDoc>(COL.emailDeliveries, id);
  if (!doc) return false;
  await updateById(COL.emailDeliveries, id, {
    open_problem: 0,
    acknowledged_at: nowIso(),
    updated_at: nowIso(),
  });
  if (doc.parent_email_id) await clearParentDeliveryProblem(doc.parent_email_id, id);
  return true;
}

export interface DeliveryOverview {
  webhookConfigured: boolean;
  webhookPath: string;
  lastEventAt: string | null;
  lastEventType: string | null;
  eventsTotal: number;
  openProblems: number;
  devLogOnly: boolean;
}

export async function deliveryOverview(): Promise<DeliveryOverview> {
  const [state, openProblems] = await Promise.all([
    getById<{ last_event_at?: string; last_event_type?: string; events_total?: number }>(
      COL.settings,
      WEBHOOK_STATE_ID,
    ),
    countOpenProblems(),
  ]);
  return {
    webhookConfigured: !!(await resendWebhookSecret()),
    webhookPath: '/webhook/resend',
    lastEventAt: state?.last_event_at ?? null,
    lastEventType: state?.last_event_type ?? null,
    eventsTotal: Number(state?.events_total ?? 0),
    openProblems,
    devLogOnly: config.mail.devLogOnly,
  };
}

export async function countOpenProblems(): Promise<number> {
  const snap = await col(COL.emailDeliveries).where('open_problem', '==', 1).count().get();
  return snap.data().count;
}

/**
 * Räumt alte Protokolleinträge auf (Standard: älter als 90 Tage). Offene
 * Probleme bleiben stehen, bis sie erledigt sind.
 */
export async function pruneOldDeliveries(days = 90): Promise<number> {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const stale = await runQuery<DeliveryDoc>(col(COL.emailDeliveries).where('created_at', '<', cutoff));
  let removed = 0;
  for (const doc of stale) {
    if (Number(doc.open_problem) === 1) continue;
    await deleteById(COL.emailDeliveries, doc.id);
    removed += 1;
  }
  if (removed > 0) {
    // eslint-disable-next-line no-console
    console.log(`[mail] removed ${removed} delivery log entr${removed === 1 ? 'y' : 'ies'} older than ${days} days`);
  }
  return removed;
}
