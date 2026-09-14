import { COL, col, runQuery, getManyById, setById, updateById, nowIso } from '../db';
import { config } from '../config';
import { newId } from '../lib/ids';
import { audit } from '../lib/audit';
import { sendGalleryReadyEmail } from '../lib/email';
import { eventEmailIds, orderedEmailIdsForEvent, daysLeftUntil } from './reminders';
import { remindPendingConsents, registrationOpen, type RegistrationEvent } from './registration';

/**
 * Automatische Erinnerungen – je Auftrag einschaltbar, standardmässig aus:
 *
 *  1. Einverständnis (Klassenerfassung): X Tage vor der Rückmeldefrist an alle
 *     Eltern, deren Kind noch keine Antwort hat (`registration.auto_consent_reminder`).
 *  2. Bestellungen: X Tage vor Ablauf der Bestellfrist an alle Eltern des
 *     Auftrags, die noch nichts bestellt haben (`auto_order_reminder`).
 *
 * Beide gehen genau einmal raus (Marker `…_sent_at`). Der Lauf ist idempotent
 * und wird beim Start sowie alle paar Stunden angestossen (siehe index.ts).
 */

const DAY_MS = 24 * 60 * 60 * 1000;

interface AutoEvent extends RegistrationEvent {
  auto_order_reminder?: boolean;
  auto_order_reminder_days?: number;
  auto_order_reminder_sent_at?: string | null;
}

/** Heutiges Datum in der Schweiz als „YYYY-MM-DD“. */
function todayZurich(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Zurich' });
}

/** „YYYY-MM-DD“ um `days` Tage verschoben (negativ = zurück). */
function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function runAutoReminders(): Promise<{ consent: number; orders: number }> {
  const events = await runQuery<AutoEvent>(col(COL.events));
  const today = todayZurich();
  let consent = 0;
  let orders = 0;

  for (const ev of events) {
    const reg = ev.registration;
    if (
      reg &&
      reg.auto_consent_reminder &&
      reg.consent_required &&
      reg.deadline &&
      !reg.auto_consent_reminder_sent_at &&
      registrationOpen(ev)
    ) {
      const dueFrom = shiftDate(reg.deadline, -Math.max(1, Number(reg.auto_consent_reminder_days) || 3));
      if (today >= dueFrom) {
        try {
          const r = await remindPendingConsents(ev, { actor: 'system', auto: true });
          consent += r.sent;
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error('[auto-reminder] consent reminder failed', ev.id, err);
        }
      }
    }

    if (ev.status === 'published' && ev.auto_order_reminder && ev.expires_at && !ev.auto_order_reminder_sent_at) {
      const days = Math.max(1, Number(ev.auto_order_reminder_days) || 7);
      const end = new Date(ev.expires_at).getTime();
      if (!isNaN(end) && Date.now() >= end - days * DAY_MS && Date.now() < end) {
        try {
          orders += await sendOrderReminder(ev);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error('[auto-reminder] order reminder failed', ev.id, err);
        }
      }
    }
  }
  if (consent > 0 || orders > 0) {
    // eslint-disable-next-line no-console
    console.log(`[auto-reminder] sent ${consent} consent and ${orders} order reminder(s)`);
  }
  return { consent, orders };
}

/** „Ihre Fotos sind noch X Tage verfügbar“ an alle Adressen des Auftrags ohne Bestellung. */
async function sendOrderReminder(ev: AutoEvent): Promise<number> {
  const [ids, ordered] = await Promise.all([eventEmailIds(ev.id), orderedEmailIdsForEvent(ev.id)]);
  const emails = await getManyById<{ email: string; status: string }>(
    COL.parentEmails,
    [...ids].filter((id) => !ordered.has(id)),
  );
  const recipients = [...emails.values()].filter((e) => e.status !== 'disabled' && e.email);
  const daysLeft = daysLeftUntil(ev.expires_at ?? null);
  const results = await Promise.allSettled(
    recipients.map((r) =>
      sendGalleryReadyEmail(r.email, config.publicAppUrl, {
        retentionDays: config.retentionDaysDefault,
        reminder: true,
        daysLeft,
      }),
    ),
  );
  const sent = results.filter((r) => r.status === 'fulfilled').length;
  // Auch ohne Empfänger als erledigt markieren, sonst prüft der Lauf ewig nach.
  await updateById(COL.events, ev.id, { auto_order_reminder_sent_at: nowIso(), updated_at: nowIso() });
  if (sent > 0) {
    await setById(COL.reminders, newId('rem'), {
      event_id: ev.id,
      sent_at: nowIso(),
      note: `Automatische Erinnerung an ${sent} Adresse(n) ohne Bestellung`,
      created_at: nowIso(),
    });
  }
  await audit('event.reminder.auto', `${ev.id}: ${sent} sent, ${results.length - sent} failed`, 'system');
  return sent;
}
