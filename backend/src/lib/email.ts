import nodemailer, { Transporter } from 'nodemailer';
import { config } from '../config';

let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  if (config.mail.devLogOnly) return null;
  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    host: config.mail.host,
    port: config.mail.port,
    secure: config.mail.secure,
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

export async function sendOrderConfirmation(to: string, orderId: string, summary: string, link: string) {
  const subject = 'Ihre Bestellung ist bestätigt';
  const html = wrap(
    'Vielen Dank für Ihre Bestellung',
    `<p style="font-size:15px;line-height:1.6;">Wir haben Ihre Bestellung erhalten und bestätigt.</p>
     <pre style="font-size:14px;background:#f0f4f8;border-radius:12px;padding:16px;white-space:pre-wrap;">${summary}</pre>
     <p style="text-align:center;margin:20px 0;">
       <a href="${link}" style="display:inline-block;background:#2f6fed;color:#fff;text-decoration:none;padding:12px 26px;border-radius:10px;font-weight:600;">Bestellung & Downloads ansehen</a>
     </p>
     <p style="font-size:13px;color:#7b8794;">Bestellnummer: ${orderId}</p>`,
  );
  const text = `Vielen Dank für Ihre Bestellung (Nr. ${orderId}).\n\n${summary}\n\nBestellung & Downloads: ${link}`;
  await sendMail({ to, subject, html, text });
}
