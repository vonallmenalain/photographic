import { COL, col, getById, firstOf, setById, updateById, nowIso } from '../db';
import { newId } from './ids';
import { normalizeEmail } from './validation';

/**
 * Zustellprotokoll der ausgehenden E-Mails (Sammlung `email_deliveries`).
 * Sichtbar im Adminbereich unter „Einstellungen → Nicht zustellbare E-Mails“.
 *
 * Ein SMTP-Server nimmt eine E-Mail entgegen und meldet Zustellprobleme erst
 * später – die App selbst erfährt davon nichts. Deshalb gibt es zwei Quellen:
 *
 *  1. Der Resend-Webhook (services/mailDelivery.ts) meldet `sent`, `delivered`,
 *     `delivery_delayed`, `bounced`, `complained` und `failed` für jede über
 *     Resend verschickte E-Mail.
 *  2. Lehnt der SMTP-Server eine E-Mail schon beim Versand ab (falsche Adresse,
 *     Verbindungsfehler), hält `recordSendFailure` das direkt fest.
 *
 * Je E-Mail gibt es genau ein Dokument mit dem letzten bekannten Status.
 * Zustellprobleme (`problem = 1`) bleiben offen (`open_problem = 1`), bis der
 * Admin sie unter „Meldungen“ als erledigt markiert. Gehört die Adresse zu einer
 * erfassten Eltern-Adresse, wird dort zusätzlich `delivery_problem` gesetzt,
 * damit die Adresse überall im Adminbereich rot markiert erscheint.
 *
 * Dieses Modul kennt bewusst keinen E-Mail-Versand (kein Import von lib/email),
 * damit lib/email die Fehler protokollieren kann, ohne einen Import-Kreis zu
 * erzeugen. Die Benachrichtigung der Admins übernimmt services/mailDelivery.ts.
 */
export type DeliveryStatus = 'sent' | 'delivered' | 'delayed' | 'bounced' | 'complained' | 'failed';

export const PROBLEM_STATUSES: readonly DeliveryStatus[] = ['bounced', 'complained', 'failed'];

/** Reihenfolge, in der Status einander ablösen (Webhook-Ereignisse kommen nicht immer der Reihe nach). */
const STATUS_RANK: Record<DeliveryStatus, number> = {
  sent: 1,
  delayed: 2,
  delivered: 3,
  bounced: 4,
  complained: 4,
  failed: 4,
};

export function isProblemStatus(status: string): boolean {
  return (PROBLEM_STATUSES as readonly string[]).includes(status);
}

export interface DeliveryDoc {
  provider: 'resend' | 'smtp';
  provider_email_id: string | null;
  /** Empfängeradresse (normalisiert). */
  to: string;
  subject: string;
  status: DeliveryStatus;
  status_at: string;
  /** Begründung des Anbieters (Bounce-Meldung, Fehlertext). */
  reason: string | null;
  /** Art des Problems, z. B. "Permanent/General" oder ein SMTP-Fehlercode. */
  reason_type: string | null;
  /** Zugehörige Eltern-Adresse (parent_emails), falls bekannt. */
  parent_email_id: string | null;
  problem: 0 | 1;
  /** Problem, das noch nicht als erledigt markiert wurde. */
  open_problem: 0 | 1;
  acknowledged_at: string | null;
  notified_at: string | null;
  events: { type: string; at: string }[];
  created_at: string;
  updated_at: string;
}

/** Marker an einer Eltern-Adresse (parent_emails.delivery_problem). */
export interface DeliveryProblemMarker {
  delivery_id: string;
  status: DeliveryStatus;
  subject: string;
  reason: string | null;
  at: string;
}

const MAX_EVENTS = 20;

export async function findParentEmailIdByAddress(address: string): Promise<string | null> {
  const email = normalizeEmail(address);
  if (!email) return null;
  const row = await firstOf(col(COL.parentEmails).where('email', '==', email));
  return row?.id ?? null;
}

export async function markParentDeliveryProblem(
  parentEmailId: string,
  marker: DeliveryProblemMarker,
): Promise<void> {
  await updateById(COL.parentEmails, parentEmailId, {
    delivery_problem: marker,
    updated_at: nowIso(),
  });
}

/**
 * Entfernt den Marker – ohne `deliveryId` immer, mit `deliveryId` nur, wenn der
 * Marker von genau diesem Zustellproblem stammt.
 */
export async function clearParentDeliveryProblem(
  parentEmailId: string,
  deliveryId?: string,
): Promise<void> {
  const parent = await getById<{ delivery_problem?: DeliveryProblemMarker | null }>(
    COL.parentEmails,
    parentEmailId,
  );
  if (!parent || !parent.delivery_problem) return;
  if (deliveryId && parent.delivery_problem.delivery_id !== deliveryId) return;
  await updateById(COL.parentEmails, parentEmailId, {
    delivery_problem: null,
    updated_at: nowIso(),
  });
}

export interface ApplyDeliveryInput {
  id: string;
  provider: 'resend' | 'smtp';
  providerEmailId: string | null;
  to: string;
  subject: string;
  status: DeliveryStatus;
  at: string;
  eventType: string;
  reason?: string | null;
  reasonType?: string | null;
  /**
   * Ob die Eltern-Adresse bei einem Problem markiert werden soll. Bei einem
   * Verbindungs- oder Anmeldefehler des SMTP-Servers ist die Adresse nicht
   * schuld – dann wird nur das Protokoll geschrieben.
   */
  markParent?: boolean;
}

export interface ApplyDeliveryResult {
  id: string;
  doc: DeliveryDoc;
  /** True, wenn diese Meldung das Dokument erstmals zu einem Problem gemacht hat. */
  becameProblem: boolean;
}

/**
 * Schreibt ein Zustell-Ereignis in das Dokument der E-Mail (legt es bei Bedarf
 * an) und pflegt den Marker an der Eltern-Adresse. Idempotent: dasselbe
 * Ereignis (Typ + Zeitpunkt) wird nur einmal übernommen.
 */
export async function applyDeliveryEvent(input: ApplyDeliveryInput): Promise<ApplyDeliveryResult> {
  const now = nowIso();
  const to = normalizeEmail(input.to);
  const existing = await getById<DeliveryDoc>(COL.emailDeliveries, input.id);

  const events = [...(existing?.events ?? [])];
  const duplicate = events.some((e) => e.type === input.eventType && e.at === input.at);
  if (!duplicate) events.push({ type: input.eventType, at: input.at });
  while (events.length > MAX_EVENTS) events.shift();

  const prevStatus: DeliveryStatus | null = existing?.status ?? null;
  const takeNew = !prevStatus || STATUS_RANK[input.status] >= STATUS_RANK[prevStatus];
  const status = takeNew ? input.status : prevStatus;
  const statusAt = takeNew ? input.at : existing?.status_at ?? input.at;
  const reason = takeNew ? (input.reason ?? null) : existing?.reason ?? null;
  const reasonType = takeNew ? (input.reasonType ?? null) : existing?.reason_type ?? null;

  const problem = isProblemStatus(status);
  const wasProblem = !!existing && Number(existing.problem) === 1;
  const acknowledgedAt = existing?.acknowledged_at ?? null;
  // Ein neues Problem nach einer Erledigung öffnet den Eintrag wieder.
  const reopened = problem && !wasProblem && !!acknowledgedAt;

  const parentEmailId = existing?.parent_email_id ?? (await findParentEmailIdByAddress(to));

  const doc: DeliveryDoc = {
    provider: input.provider,
    provider_email_id: input.providerEmailId ?? existing?.provider_email_id ?? null,
    to,
    subject: input.subject || existing?.subject || '',
    status,
    status_at: statusAt,
    reason,
    reason_type: reasonType,
    parent_email_id: parentEmailId,
    problem: problem ? 1 : 0,
    open_problem: problem && (!acknowledgedAt || reopened) ? 1 : 0,
    acknowledged_at: reopened ? null : acknowledgedAt,
    notified_at: existing?.notified_at ?? null,
    events,
    created_at: existing?.created_at ?? now,
    updated_at: now,
  };
  await setById(COL.emailDeliveries, input.id, { ...doc });

  const becameProblem = problem && !wasProblem;
  if (parentEmailId) {
    if (becameProblem && input.markParent !== false) {
      await markParentDeliveryProblem(parentEmailId, {
        delivery_id: input.id,
        status,
        subject: doc.subject,
        reason,
        at: statusAt,
      });
    } else if (status === 'delivered') {
      // Eine spätere erfolgreiche Zustellung an dieselbe Adresse zeigt, dass
      // das Problem (z. B. volles Postfach) behoben ist.
      await clearParentDeliveryProblem(parentEmailId);
    }
  }

  return { id: input.id, doc, becameProblem };
}

/**
 * Hält fest, dass der SMTP-Server eine E-Mail schon beim Versand abgelehnt hat
 * (bzw. der Versand fehlgeschlagen ist). Wird von lib/email aufgerufen; darf
 * den eigentlichen Fehler nie verschlucken oder selbst werfen.
 */
export async function recordSendFailure(
  to: string | string[],
  subject: string,
  err: unknown,
): Promise<void> {
  const recipients = Array.isArray(to) ? to : [to];
  const e = err as { message?: string; code?: string; responseCode?: number; response?: string };
  const message = String(e?.response || e?.message || err || 'Unbekannter Fehler').slice(0, 500);
  // EENVELOPE = der Server hat die Empfängeradresse abgelehnt (typisch bei einer
  // falsch geschriebenen Adresse). Alle anderen Fehler (Verbindung, Login,
  // Zeitüberschreitung) betreffen den Versand an sich, nicht die Adresse.
  const recipientRejected = e?.code === 'EENVELOPE' || (e?.responseCode ?? 0) === 550;
  const reasonType = e?.code ? String(e.code) : e?.responseCode ? String(e.responseCode) : null;
  const now = nowIso();
  for (const recipient of recipients) {
    try {
      await applyDeliveryEvent({
        id: newId('dlv'),
        provider: 'smtp',
        providerEmailId: null,
        to: recipient,
        subject,
        status: 'failed',
        at: now,
        eventType: 'smtp.failed',
        reason: message,
        reasonType,
        markParent: recipientRejected,
      });
    } catch (logErr) {
      // eslint-disable-next-line no-console
      console.error('[mail] could not record send failure', logErr);
    }
  }
}
