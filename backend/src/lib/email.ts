import nodemailer, { Transporter } from 'nodemailer';
import { config } from '../config';
import { getAppSettings } from '../services/settings';
import { recordSendFailure } from './mailLog';

let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  if (config.mail.devLogOnly) return null;
  if (transporter) return transporter;
  // Port 465 is implicit TLS (SMTPS): a plaintext connection there never
  // succeeds and just hangs until the socket times out. Guard against the very
  // common "SMTP_PORT=465 + SMTP_SECURE=false" misconfiguration by forcing TLS.
  const secure = config.mail.secure || config.mail.port === 465;
  if (secure !== config.mail.secure) {
    // eslint-disable-next-line no-console
    console.warn(
      `[mail] SMTP_PORT=${config.mail.port} requires TLS — overriding SMTP_SECURE to true. ` +
        'Set SMTP_SECURE=true (port 465) or use port 587 with SMTP_SECURE=false to silence this.',
    );
  }
  transporter = nodemailer.createTransport({
    host: config.mail.host,
    port: config.mail.port,
    secure,
    auth:
      config.mail.user || config.mail.pass
        ? { user: config.mail.user, pass: config.mail.pass }
        : undefined,
    // Fail fast on an unreachable/misconfigured SMTP server instead of letting
    // the parent's login request hang on the default (multi-minute) socket
    // timeout. Without these bounds a wrong host/port silently blocked the
    // /request-code call for ~10s+ before erroring out.
    connectionTimeout: config.mail.timeoutMs,
    greetingTimeout: config.mail.timeoutMs,
    socketTimeout: config.mail.timeoutMs,
  });
  return transporter;
}

interface SendArgs {
  to: string | string[];
  subject: string;
  html: string;
  text: string;
  /**
   * Antwortadresse. Ohne Angabe geht eine Antwort an die im Adminbereich
   * hinterlegte Kontaktadresse (Einstellungen → Kontakt-E-Mail-Adresse), damit
   * Antworten der Eltern nicht an den "no-reply"-Absender verpuffen.
   */
  replyTo?: string;
}

export async function sendMail({ to, subject, html, text, replyTo }: SendArgs): Promise<void> {
  const t = getTransporter();
  const recipients = Array.isArray(to) ? to : [to];
  const contact = await contactAddress();
  const effectiveReplyTo = replyTo || contact || undefined;
  if (!t) {
    // Dev mode: log so you can copy the code/link from the console.
    // eslint-disable-next-line no-console
    console.log('\n──────── E-MAIL (dev log only) ────────');
    console.log(`An:      ${recipients.join(', ')}`);
    if (effectiveReplyTo) console.log(`Antwort: ${effectiveReplyTo}`);
    console.log(`Betreff: ${subject}`);
    console.log(text);
    console.log('───────────────────────────────────────\n');
    return;
  }
  try {
    await t.sendMail({
      from: config.mail.from,
      to: recipients,
      subject,
      html,
      text,
      ...(effectiveReplyTo ? { replyTo: effectiveReplyTo } : {}),
    });
  } catch (err) {
    // Fehlgeschlagene Versände landen im Zustellprotokoll (Adminbereich →
    // Meldungen → Nicht zustellbare E-Mails). Der Fehler geht danach unverändert
    // an den Aufrufer, der wie bisher entscheidet, ob er kritisch ist.
    await recordSendFailure(recipients, subject, err);
    throw err;
  }
}

/** Die öffentliche Kontaktadresse; leer, wenn keine konfiguriert ist. */
async function contactAddress(): Promise<string> {
  try {
    return (await getAppSettings()).contact_email;
  } catch {
    return '';
  }
}

/**
 * Fusszeile für alle E-Mails an Eltern: Hinweis auf die Kontaktadresse, damit
 * Rückfragen einen klaren Weg haben. Ohne konfigurierte Adresse bleibt sie leer.
 */
async function contactFooter(): Promise<{ html: string; text: string }> {
  const contact = await contactAddress();
  if (!contact) return { html: '', text: '' };
  return {
    html: `<p style="font-size:12px;color:#7b8794;line-height:1.6;margin:24px 0 0;border-top:1px solid #e6e9ee;padding-top:14px;">Fragen zu Ihren Fotos oder Ihrer Bestellung? Schreiben Sie uns an <a href="mailto:${contact}" style="color:#2f6fed;">${contact}</a>.</p>`,
    text: `\n\nFragen zu Ihren Fotos oder Ihrer Bestellung? Schreiben Sie uns an ${contact}`,
  };
}

const wrap = (title: string, body: string, maxWidth = 520, footer = '') => `
<!doctype html><html lang="de"><body style="margin:0;background:#f4f5f7;font-family:'Comic Sans MS','Comic Sans','Comic Neue',Helvetica,Arial,sans-serif;color:#1f2933;">
  <div style="max-width:${maxWidth}px;margin:0 auto;padding:32px 20px;">
    <div style="background:#fff;border-radius:16px;padding:32px;box-shadow:0 1px 3px rgba(0,0,0,.08);">
      <h1 style="font-size:20px;margin:0 0 16px;color:#1f2933;">${title}</h1>
      ${body}
      ${footer}
    </div>
  </div>
</body></html>`;

/** Kleiner Helfer für Datum/Zeit in Admin-Benachrichtigungen. */
function formatWhen(value: string): string {
  const d = new Date(value);
  if (isNaN(d.getTime())) return value;
  return d.toLocaleString('de-CH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Zurich' });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function sendVerificationEmail(to: string, code: string, link: string) {
  const subject = 'Ihr Zugangscode für die Foto-Galerie';
  const footer = await contactFooter();
  const html = wrap(
    'Ihr Zugang zur Foto-Galerie',
    `<p style="font-size:15px;line-height:1.6;">Damit Ihre Kinderfotos geschützt bleiben, bestätigen Sie bitte Ihre E-Mail-Adresse.</p>
     <p style="font-size:15px;line-height:1.6;">Ihr Bestätigungscode lautet:</p>
     <p style="font-size:34px;letter-spacing:8px;font-weight:700;text-align:center;background:#f0f4f8;border-radius:12px;padding:18px 0;margin:18px 0;">${code}</p>
     <p style="font-size:15px;line-height:1.6;">Oder bestätigen Sie direkt mit einem Klick:</p>
     <p style="text-align:center;margin:20px 0;">
       <a href="${link}" style="display:inline-block;background:#2f6fed;color:#fff;text-decoration:none;padding:12px 26px;border-radius:10px;font-weight:600;">E-Mail bestätigen</a>
     </p>
     <p style="font-size:13px;color:#7b8794;line-height:1.6;">Der Code ist ${config.verification.codeTtlMinutes} Minuten gültig. Wenn Sie das nicht angefragt haben, können Sie diese E-Mail ignorieren.</p>`,
    520,
    footer.html,
  );
  const text = `Ihr Bestätigungscode: ${code}\n\nOder bestätigen Sie per Link: ${link}\n\nDer Code ist ${config.verification.codeTtlMinutes} Minuten gültig.${footer.text}`;
  await sendMail({ to, subject, html, text });
}

export async function sendPasswordResetEmail(to: string, username: string, link: string, ttlMinutes: number) {
  const subject = 'Passwort zurücksetzen – Adminbereich';
  const html = wrap(
    'Passwort zurücksetzen',
    `<p style="font-size:15px;line-height:1.6;">Hallo <strong>${username}</strong>,</p>
     <p style="font-size:15px;line-height:1.6;">du hast eine Anfrage zum Zurücksetzen deines Passworts gestellt. Klicke auf den folgenden Button, um ein neues Passwort zu vergeben:</p>
     <p style="text-align:center;margin:24px 0;">
       <a href="${link}" style="display:inline-block;background:#2f6fed;color:#fff;text-decoration:none;padding:13px 28px;border-radius:10px;font-weight:600;font-size:15px;">Passwort zurücksetzen</a>
     </p>
     <p style="font-size:13px;color:#7b8794;line-height:1.6;">Dieser Link ist <strong>${ttlMinutes} Minuten</strong> gültig. Wenn du keine Passwort-Rücksetzung beantragt hast, kannst du diese E-Mail ignorieren – dein Passwort bleibt unverändert.</p>`,
  );
  const text = `Hallo ${username},\n\ndu hast eine Anfrage zum Zurücksetzen deines Passworts gestellt.\n\nPasswort zurücksetzen: ${link}\n\nDieser Link ist ${ttlMinutes} Minuten gültig. Wenn du das nicht angefragt hast, kannst du diese E-Mail ignorieren.`;
  await sendMail({ to, subject, html, text });
}

/**
 * "Ihre Fotos sind bereit" – Sammel-E-Mail, die der Admin pro Auftrag an alle
 * erfassten Eltern-Adressen schicken kann, sobald die Galerie freigeschaltet
 * ist. Enthält den Link zur App sowie Informationen zu den Fotos (Bestätigung,
 * Kauf, Wasserzeichen, Speicherort und Aufbewahrungsfrist).
 *
 * Mit `reminder: true` wird dieselbe Nachricht als Erinnerung formuliert
 * ("Ihre Fotos sind noch X Tage verfügbar"), z. B. für Eltern, die noch keine
 * Bestellung erfasst haben. `daysLeft` ist die verbleibende Anzahl Tage bis zur
 * Archivierung; fehlt sie, wird auf die Standard-Aufbewahrungsdauer zurück-
 * gegriffen.
 */
export async function sendGalleryReadyEmail(
  to: string,
  link: string,
  opts: {
    retentionDays?: number;
    reminder?: boolean;
    daysLeft?: number | null;
    // Wenn gesetzt, weist die Erinnerung zusätzlich darauf hin, dass der
    // Bestellzeitraum bis zu diesem Datum verlängert wurde.
    extendedUntil?: string | null;
  } = {},
) {
  const retentionDays = opts.retentionDays ?? config.retentionDaysDefault;
  const reminder = opts.reminder ?? false;
  const footer = await contactFooter();
  const daysLeft =
    typeof opts.daysLeft === 'number' && opts.daysLeft > 0 ? opts.daysLeft : null;
  const extendedUntilDate = opts.extendedUntil ? new Date(opts.extendedUntil) : null;
  const extendedUntil =
    extendedUntilDate && !isNaN(extendedUntilDate.getTime())
      ? extendedUntilDate.toLocaleDateString('de-CH', { dateStyle: 'long' })
      : null;

  const subject = reminder
    ? daysLeft != null
      ? `Erinnerung: Ihre Fotos sind noch ${daysLeft} ${daysLeft === 1 ? 'Tag' : 'Tage'} verfügbar`
      : 'Erinnerung: Ihre Fotos sind noch verfügbar'
    : 'Ihre Fotos sind bereit';
  const heading = reminder ? 'Ihre Fotos sind noch verfügbar' : 'Ihre Fotos sind bereit';
  const intro = reminder
    ? daysLeft != null
      ? `Die Fotos sind weiterhin für Sie freigeschaltet – <strong>Ihre Fotos sind noch ${daysLeft} ${daysLeft === 1 ? 'Tag' : 'Tage'} verfügbar</strong>.`
      : 'Die Fotos sind weiterhin für Sie freigeschaltet.'
    : 'Die Fotos sind jetzt für Sie freigeschaltet.';
  const introText = reminder
    ? daysLeft != null
      ? `Die Fotos sind weiterhin für Sie freigeschaltet – Ihre Fotos sind noch ${daysLeft} ${daysLeft === 1 ? 'Tag' : 'Tage'} verfügbar.`
      : 'Die Fotos sind weiterhin für Sie freigeschaltet.'
    : 'Die Fotos sind jetzt für Sie freigeschaltet.';
  const availability =
    reminder && daysLeft != null
      ? `Ihre Fotos sind <strong>noch ${daysLeft} ${daysLeft === 1 ? 'Tag' : 'Tage'}</strong> verfügbar und werden danach automatisch archiviert.`
      : `Ihre Fotos stehen Ihnen während <strong>${retentionDays} Tagen</strong> zur Verfügung und werden danach automatisch archiviert.`;
  const availabilityText =
    reminder && daysLeft != null
      ? `Ihre Fotos sind noch ${daysLeft} ${daysLeft === 1 ? 'Tag' : 'Tage'} verfügbar und werden danach automatisch archiviert.`
      : `Ihre Fotos stehen Ihnen während ${retentionDays} Tagen zur Verfügung und werden danach automatisch archiviert.`;

  const extensionHtml = extendedUntil
    ? `<p style="font-size:15px;line-height:1.6;">
         Der Bestellzeitraum wurde verlängert – Sie können noch bis zum <strong>${extendedUntil}</strong> bestellen.
       </p>`
    : '';
  const extensionText = extendedUntil
    ? `\n\nDer Bestellzeitraum wurde verlängert – Sie können noch bis zum ${extendedUntil} bestellen.`
    : '';

  const html = wrap(
    heading,
    `<p style="font-size:15px;line-height:1.6;">Guten Tag</p>
     <p style="font-size:15px;line-height:1.6;">${intro}</p>
     ${extensionHtml}
     <p style="text-align:center;margin:24px 0;">
       <a href="${link}" style="display:inline-block;background:#2f6fed;color:#fff;text-decoration:none;padding:13px 28px;border-radius:10px;font-weight:600;font-size:15px;">Zu meinen Fotos</a>
     </p>
     <p style="font-size:13px;color:#7b8794;line-height:1.6;word-break:break-all;">Falls der Button nicht funktioniert: <br />${link}</p>
     <div style="background:#f0f4f8;border-radius:12px;padding:16px 18px;margin-top:18px;">
       <p style="font-size:14px;line-height:1.6;margin:0 0 8px;"><strong>Informationen zu den Fotos</strong></p>
       <ul style="font-size:14px;line-height:1.6;padding-left:20px;margin:0;">
         <li>Die Fotos werden erst sichtbar, nachdem Sie diese E-Mail-Adresse bestätigt haben.</li>
         <li>Der Kauf und Download der Fotos ist nur über diese E-Mail-Adresse möglich.</li>
         <li>${availability}</li>
         <li>Die Vorschaubilder sind mit einem Wasserzeichen versehen. Die Originaldateien erhalten Sie nach dem Kauf.</li>
         <li>Alle Fotos werden auf einem lokalen Server in der Schweiz gespeichert.</li>
       </ul>
     </div>`,
    // Doppelt so breite Kachel, damit die "Informationen zu den Fotos" auf
    // Laptop-Bildschirmen ohne Zeilenumbrüche in einer Zeile stehen. Durch
    // max-width bleibt die Kachel auf schmalen Displays trotzdem responsiv.
    1040,
    footer.html,
  );
  const text = `Guten Tag

${introText}${extensionText}

Zu meinen Fotos: ${link}

Falls der Button nicht funktioniert: ${link}

Informationen zu den Fotos:
- Die Fotos werden erst sichtbar, nachdem Sie diese E-Mail-Adresse bestätigt haben.
- Der Kauf und Download der Fotos ist nur über diese E-Mail-Adresse möglich.
- ${availabilityText}
- Die Vorschaubilder sind mit einem Wasserzeichen versehen. Die Originaldateien erhalten Sie nach dem Kauf.
- Alle Fotos werden auf einem lokalen Server in der Schweiz gespeichert.${footer.text}`;
  await sendMail({ to, subject, html, text });
}

export interface OrderConfirmationAddress {
  first_name: string;
  last_name: string;
  street: string;
  house_no: string;
  zip: string;
  city: string;
}

export async function sendOrderConfirmation(
  to: string,
  summary: string,
  link: string,
  opts: { hasPrint?: boolean; shippingAddress?: OrderConfirmationAddress | null } = {},
) {
  const { hasPrint = false, shippingAddress = null } = opts;
  const footer = await contactFooter();

  // Orders with a printed product get extra information about shipping time and,
  // when available, the delivery address the customer entered at checkout.
  const printHtml = hasPrint
    ? `<p style="font-size:15px;line-height:1.6;background:#fff7ed;border:1px solid #fed7aa;border-radius:12px;padding:14px 16px;">
         <strong>Hinweis zu Ihren ausgedruckten Fotos:</strong><br />
         Ihre bestellten Fotos zum Ausdrucken werden in ca. <strong>3–4 Wochen</strong> an die unten angegebene Adresse versandt.
       </p>${
         shippingAddress
           ? `<p style="font-size:14px;line-height:1.6;">
                <strong>Lieferadresse</strong><br />
                ${shippingAddress.first_name} ${shippingAddress.last_name}<br />
                ${shippingAddress.street} ${shippingAddress.house_no}<br />
                ${shippingAddress.zip} ${shippingAddress.city}
              </p>`
           : ''
       }`
    : '';

  const html = wrap(
    'Vielen Dank für Ihre Bestellung',
    `<p style="font-size:15px;line-height:1.6;">Wir haben Ihre Bestellung erhalten und bestätigt.</p>
     <pre style="font-size:14px;background:#f0f4f8;border-radius:12px;padding:16px;white-space:pre-wrap;">${summary}</pre>
     ${printHtml}
     <p style="text-align:center;margin:20px 0;">
       <a href="${link}" style="display:inline-block;background:#2f6fed;color:#fff;text-decoration:none;padding:12px 26px;border-radius:10px;font-weight:600;">Bestellung & Downloads ansehen</a>
     </p>`,
    520,
    footer.html,
  );

  const printText = hasPrint
    ? `\n\nHinweis: Ihre bestellten Fotos zum Ausdrucken werden in ca. 3–4 Wochen an die angegebene Adresse versandt.${
        shippingAddress
          ? `\n\nLieferadresse:\n${shippingAddress.first_name} ${shippingAddress.last_name}\n${shippingAddress.street} ${shippingAddress.house_no}\n${shippingAddress.zip} ${shippingAddress.city}`
          : ''
      }`
    : '';

  const subject = hasPrint
    ? 'Ihre Bestellung ist bestätigt – Druck folgt'
    : 'Ihre Bestellung ist bestätigt';
  const text = `Vielen Dank für Ihre Bestellung.\n\n${summary}${printText}\n\nBestellung & Downloads: ${link}${footer.text}`;
  await sendMail({ to, subject, html, text });
}

/**
 * Versandbestätigung für ausgedruckte Fotos: kurze, freundliche Nachricht an
 * Eltern, deren bestellte Fotos heute verschickt wurden. Bewusst schlicht
 * gehalten – keine technische Bestellnummer, nur die Bestätigung des Versands
 * und der Link zu den Bestellungen.
 */
export async function sendShippingConfirmationEmail(to: string, link: string) {
  const subject = 'Ihre Fotos sind unterwegs';
  const footer = await contactFooter();
  const html = wrap(
    'Ihre Fotos sind unterwegs',
    `<p style="font-size:15px;line-height:1.6;">Guten Tag</p>
     <p style="font-size:15px;line-height:1.6;">
       Wir haben Ihre bestellten Fotos <strong>heute verschickt</strong>.
       Sie sollten in den nächsten Tagen bei Ihnen eintreffen.
     </p>
     <p style="font-size:15px;line-height:1.6;">Vielen Dank für Ihre Bestellung und herzliche Grüsse.</p>
     <p style="text-align:center;margin:24px 0;">
       <a href="${link}" style="display:inline-block;background:#2f6fed;color:#fff;text-decoration:none;padding:12px 26px;border-radius:10px;font-weight:600;">Zu meinen Fotos</a>
     </p>`,
    520,
    footer.html,
  );
  const text = `Guten Tag

Wir haben Ihre bestellten Fotos heute verschickt. Sie sollten in den nächsten Tagen bei Ihnen eintreffen.

Vielen Dank für Ihre Bestellung und herzliche Grüsse.

Zu meinen Fotos: ${link}${footer.text}`;
  await sendMail({ to, subject, html, text });
}

// ---------------------------------------------------------------------------
// Benachrichtigungen an die Admins
// ---------------------------------------------------------------------------

export interface ReportNotificationInfo {
  typeLabel: string;
  message: string;
  fromEmail: string;
  createdAt: string;
  adminLink: string;
}

/**
 * Benachrichtigt die Admins über eine neue Meldung aus „Hilfe & Kontakt“.
 * Antworten gehen direkt an die Absenderadresse der Eltern (Reply-To), sofern
 * sie eine angegeben haben.
 */
export async function sendReportNotificationEmail(to: string[], info: ReportNotificationInfo) {
  const subject = `Neue Meldung: ${info.typeLabel}`;
  const from = info.fromEmail || 'keine Angabe';
  const html = wrap(
    'Neue Meldung aus „Hilfe & Kontakt“',
    `<p style="font-size:15px;line-height:1.6;">Soeben ist eine neue Meldung eingegangen.</p>
     <table style="font-size:14px;line-height:1.6;border-collapse:collapse;">
       <tr><td style="padding:2px 12px 2px 0;color:#7b8794;">Anliegen</td><td>${escapeHtml(info.typeLabel)}</td></tr>
       <tr><td style="padding:2px 12px 2px 0;color:#7b8794;">Von</td><td>${escapeHtml(from)}</td></tr>
       <tr><td style="padding:2px 12px 2px 0;color:#7b8794;">Zeitpunkt</td><td>${escapeHtml(formatWhen(info.createdAt))}</td></tr>
     </table>
     <pre style="font-size:14px;background:#f0f4f8;border-radius:12px;padding:16px;white-space:pre-wrap;font-family:inherit;margin:16px 0;">${escapeHtml(info.message)}</pre>
     <p style="text-align:center;margin:20px 0;">
       <a href="${info.adminLink}" style="display:inline-block;background:#2f6fed;color:#fff;text-decoration:none;padding:12px 26px;border-radius:10px;font-weight:600;">Meldung im Adminbereich öffnen</a>
     </p>
     ${
       info.fromEmail
         ? '<p style="font-size:13px;color:#7b8794;line-height:1.6;">Mit „Antworten“ schreibst du direkt an die Absenderadresse.</p>'
         : '<p style="font-size:13px;color:#7b8794;line-height:1.6;">Die Eltern haben keine E-Mail-Adresse für eine Antwort angegeben.</p>'
     }`,
  );
  const text = `Neue Meldung aus „Hilfe & Kontakt“

Anliegen:  ${info.typeLabel}
Von:       ${from}
Zeitpunkt: ${formatWhen(info.createdAt)}

${info.message}

Meldung im Adminbereich öffnen: ${info.adminLink}`;
  await sendMail({
    to,
    subject,
    html,
    text,
    ...(info.fromEmail ? { replyTo: info.fromEmail } : {}),
  });
}

export interface DeliveryProblemInfo {
  recipient: string;
  subject: string;
  status: string;
  reason: string | null;
  at: string;
  parentEmailId: string | null;
  parentName: string;
  adminLink: string;
}

const DELIVERY_STATUS_LABEL: Record<string, string> = {
  bounced: 'Unzustellbar (Bounce)',
  complained: 'Als Spam gemeldet',
  failed: 'Versand fehlgeschlagen',
  delayed: 'Zustellung verzögert',
};

/**
 * Meldet den Admins, dass eine E-Mail nicht zugestellt werden konnte – mit
 * Empfänger, Betreff, Zeitpunkt und der Begründung des Mail-Anbieters.
 */
export async function sendDeliveryProblemEmail(to: string[], info: DeliveryProblemInfo) {
  const statusLabel = DELIVERY_STATUS_LABEL[info.status] ?? info.status;
  const subject = `E-Mail nicht zustellbar: ${info.recipient}`;
  const parentLine = info.parentEmailId
    ? `Die Adresse ist als Eltern-Adresse erfasst${info.parentName ? ` (${escapeHtml(info.parentName)})` : ''} und im Adminbereich rot markiert. Prüfe die Schreibweise und korrigiere sie im Auftrag („Bearbeiten“ → Adresse beim Kind anpassen).`
    : 'Die Adresse ist keiner erfassten Eltern-Adresse zugeordnet.';
  const html = wrap(
    'E-Mail konnte nicht zugestellt werden',
    `<table style="font-size:14px;line-height:1.6;border-collapse:collapse;">
       <tr><td style="padding:2px 12px 2px 0;color:#7b8794;">Empfänger</td><td><strong>${escapeHtml(info.recipient)}</strong></td></tr>
       <tr><td style="padding:2px 12px 2px 0;color:#7b8794;">Betreff</td><td>${escapeHtml(info.subject || '—')}</td></tr>
       <tr><td style="padding:2px 12px 2px 0;color:#7b8794;">Status</td><td>${escapeHtml(statusLabel)}</td></tr>
       <tr><td style="padding:2px 12px 2px 0;color:#7b8794;">Zeitpunkt</td><td>${escapeHtml(formatWhen(info.at))}</td></tr>
       ${info.reason ? `<tr><td style="padding:2px 12px 2px 0;color:#7b8794;vertical-align:top;">Begründung</td><td>${escapeHtml(info.reason)}</td></tr>` : ''}
     </table>
     <p style="font-size:14px;line-height:1.6;margin-top:16px;">${parentLine}</p>
     <p style="text-align:center;margin:20px 0;">
       <a href="${info.adminLink}" style="display:inline-block;background:#2f6fed;color:#fff;text-decoration:none;padding:12px 26px;border-radius:10px;font-weight:600;">Zustellprobleme im Adminbereich öffnen</a>
     </p>`,
  );
  const text = `E-Mail konnte nicht zugestellt werden

Empfänger: ${info.recipient}
Betreff:   ${info.subject || '—'}
Status:    ${statusLabel}
Zeitpunkt: ${formatWhen(info.at)}${info.reason ? `\nBegründung: ${info.reason}` : ''}

${info.parentEmailId ? 'Die Adresse ist als Eltern-Adresse erfasst und im Adminbereich rot markiert. Prüfe die Schreibweise und korrigiere sie im Auftrag.' : 'Die Adresse ist keiner erfassten Eltern-Adresse zugeordnet.'}

Zustellprobleme im Adminbereich öffnen: ${info.adminLink}`;
  await sendMail({ to, subject, html, text });
}
