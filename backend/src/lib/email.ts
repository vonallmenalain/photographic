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

const wrap = (title: string, body: string) => `
<!doctype html><html lang="de"><body style="margin:0;background:#f4f5f7;font-family:Helvetica,Arial,sans-serif;color:#1f2933;">
  <div style="max-width:520px;margin:0 auto;padding:32px 20px;">
    <div style="background:#fff;border-radius:16px;padding:32px;box-shadow:0 1px 3px rgba(0,0,0,.08);">
      <h1 style="font-size:20px;margin:0 0 16px;color:#1f2933;">${title}</h1>
      ${body}
    </div>
    <p style="text-align:center;color:#9aa5b1;font-size:12px;margin-top:24px;">
      Diese Nachricht schützt Kinderfotos. Bitte geben Sie Ihren Code oder Link nicht weiter.
    </p>
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
 * ist. Enthält den Link zur App, eine Kurzanleitung zur Verifizierung sowie die
 * Hinweise zum Schutz der Fotos und zur Aufbewahrungsfrist.
 */
export async function sendGalleryReadyEmail(
  to: string,
  link: string,
  opts: { retentionDays?: number } = {},
) {
  const retentionDays = opts.retentionDays ?? config.retentionDaysDefault;
  const subject = 'Ihre Fotos sind bereit';
  const html = wrap(
    'Ihre Fotos sind bereit',
    `<p style="font-size:15px;line-height:1.6;">Guten Tag,</p>
     <p style="font-size:15px;line-height:1.6;">die Fotos sind jetzt für Sie freigeschaltet. So sehen Sie Ihre persönlichen Bilder:</p>
     <ol style="font-size:15px;line-height:1.7;padding-left:20px;margin:0 0 4px;">
       <li>Öffnen Sie die Galerie über den Button unten.</li>
       <li>Geben Sie <strong>diese E-Mail-Adresse</strong> ein – Sie erhalten dann einen Bestätigungslink bzw. einen Code.</li>
       <li>Nach der Bestätigung sehen Sie ausschliesslich die Ihnen zugeordneten Fotos.</li>
     </ol>
     <p style="text-align:center;margin:24px 0;">
       <a href="${link}" style="display:inline-block;background:#2f6fed;color:#fff;text-decoration:none;padding:13px 28px;border-radius:10px;font-weight:600;font-size:15px;">Zu meinen Fotos</a>
     </p>
     <p style="font-size:13px;color:#7b8794;line-height:1.6;word-break:break-all;">Falls der Button nicht funktioniert, öffnen Sie diese Adresse im Browser:<br />${link}</p>
     <div style="background:#f0f4f8;border-radius:12px;padding:16px 18px;margin-top:18px;">
       <p style="font-size:14px;line-height:1.6;margin:0 0 8px;"><strong>Zum Schutz der Fotos:</strong></p>
       <ul style="font-size:14px;line-height:1.6;padding-left:20px;margin:0;">
         <li>Die Bilder sind nur nach Bestätigung genau dieser E-Mail-Adresse sichtbar.</li>
         <li>Vorschaubilder sind mit einem Wasserzeichen geschützt; die Originale erhalten Sie erst nach dem Kauf.</li>
         <li>Die Fotos stehen <strong>${retentionDays} Tage</strong> zur Verfügung und werden danach automatisch archiviert.</li>
         <li>Bitte geben Sie Ihren Bestätigungslink bzw. Code nicht weiter.</li>
       </ul>
     </div>`,
  );
  const text = `Guten Tag,

die Fotos sind jetzt für Sie freigeschaltet. So sehen Sie Ihre persönlichen Bilder:

1. Öffnen Sie die Galerie: ${link}
2. Geben Sie DIESE E-Mail-Adresse ein – Sie erhalten dann einen Bestätigungslink bzw. einen Code.
3. Nach der Bestätigung sehen Sie ausschliesslich die Ihnen zugeordneten Fotos.

Zum Schutz der Fotos:
- Die Bilder sind nur nach Bestätigung genau dieser E-Mail-Adresse sichtbar.
- Vorschaubilder sind mit einem Wasserzeichen geschützt; die Originale erhalten Sie erst nach dem Kauf.
- Die Fotos stehen ${retentionDays} Tage zur Verfügung und werden danach automatisch archiviert.
- Bitte geben Sie Ihren Bestätigungslink bzw. Code nicht weiter.`;
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
