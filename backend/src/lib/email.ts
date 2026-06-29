import nodemailer, { Transporter } from 'nodemailer';
import { config } from '../config';

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
  to: string;
  subject: string;
  html: string;
  text: string;
}

export async function sendMail({ to, subject, html, text }: SendArgs): Promise<void> {
  const t = getTransporter();
  if (!t) {
    // Dev mode: log so you can copy the code/link from the console.
    // eslint-disable-next-line no-console
    console.log('\n──────── E-MAIL (dev log only) ────────');
    console.log(`An:      ${to}`);
    console.log(`Betreff: ${subject}`);
    console.log(text);
    console.log('───────────────────────────────────────\n');
    return;
  }
  await t.sendMail({ from: config.mail.from, to, subject, html, text });
}

const wrap = (title: string, body: string, maxWidth = 520) => `
<!doctype html><html lang="de"><body style="margin:0;background:#f4f5f7;font-family:Helvetica,Arial,sans-serif;color:#1f2933;">
  <div style="max-width:${maxWidth}px;margin:0 auto;padding:32px 20px;">
    <div style="background:#fff;border-radius:16px;padding:32px;box-shadow:0 1px 3px rgba(0,0,0,.08);">
      <h1 style="font-size:20px;margin:0 0 16px;color:#1f2933;">${title}</h1>
      ${body}
    </div>
  </div>
</body></html>`;

export async function sendVerificationEmail(to: string, code: string, link: string) {
  const subject = 'Ihr Zugangscode für die Foto-Galerie';
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
  );
  const text = `Ihr Bestätigungscode: ${code}\n\nOder bestätigen Sie per Link: ${link}\n\nDer Code ist ${config.verification.codeTtlMinutes} Minuten gültig.`;
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
- Alle Fotos werden auf einem lokalen Server in der Schweiz gespeichert.`;
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
  orderId: string,
  summary: string,
  link: string,
  opts: { hasPrint?: boolean; shippingAddress?: OrderConfirmationAddress | null } = {},
) {
  const { hasPrint = false, shippingAddress = null } = opts;

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
     </p>
     <p style="font-size:13px;color:#7b8794;">Bestellnummer: ${orderId}</p>`,
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
  const text = `Vielen Dank für Ihre Bestellung (Nr. ${orderId}).\n\n${summary}${printText}\n\nBestellung & Downloads: ${link}`;
  await sendMail({ to, subject, html, text });
}
