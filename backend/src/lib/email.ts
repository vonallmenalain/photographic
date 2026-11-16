import nodemailer, { Transporter } from 'nodemailer';
import { config } from '../config';
import { getAppSettings, mailFrom } from '../services/settings';
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
   * Antworten der Eltern nicht an den "no-reply"-Absender verpuffen. Stimmt sie
   * mit dem Absender überein, wird kein Reply-To gesetzt – dann genügt das
   * "Von"-Feld.
   */
  replyTo?: string;
  /**
   * Eingebettete Bilder (z. B. die Miniaturbilder der Bestellbestätigung). Sie
   * reisen in der E-Mail selbst mit und werden im HTML über `cid:` angesprochen –
   * so bleiben sie sichtbar, auch wenn die Fotos später archiviert sind, und es
   * braucht keine öffentlich abrufbaren Bild-Links.
   */
  attachments?: MailAttachment[];
}

export interface MailAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
  cid: string;
}

export async function sendMail({ to, subject, html, text, replyTo, attachments }: SendArgs): Promise<void> {
  const t = getTransporter();
  const recipients = Array.isArray(to) ? to : [to];
  const [from, contact] = await Promise.all([mailFrom(), contactAddress()]);
  const explicitReplyTo = replyTo?.trim() ?? '';
  const effectiveReplyTo =
    explicitReplyTo || (contact && contact !== from.address ? contact : '') || undefined;
  if (!t) {
    // Dev mode: log so you can copy the code/link from the console.
    // eslint-disable-next-line no-console
    console.log('\n──────── E-MAIL (dev log only) ────────');
    console.log(`Von:     ${from.name ? `${from.name} <${from.address}>` : from.address}`);
    console.log(`An:      ${recipients.join(', ')}`);
    if (effectiveReplyTo) console.log(`Antwort: ${effectiveReplyTo}`);
    console.log(`Betreff: ${subject}`);
    if (attachments?.length) console.log(`Bilder:  ${attachments.length} eingebettet`);
    console.log(text);
    console.log('───────────────────────────────────────\n');
    return;
  }
  try {
    await t.sendMail({
      // Als Objekt übergeben: nodemailer kodiert den Anzeigenamen korrekt.
      from: { name: from.name, address: from.address },
      to: recipients,
      subject,
      html,
      text,
      ...(effectiveReplyTo ? { replyTo: effectiveReplyTo } : {}),
      ...(attachments?.length ? { attachments } : {}),
    });
  } catch (err) {
    // Fehlgeschlagene Versände landen im Zustellprotokoll (Adminbereich →
    // Einstellungen → Nicht zustellbare E-Mails). Der Fehler geht danach unverändert
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
 * Absender und Antwortadresse, wie sie `sendMail` setzt – für die E-Mail-Vorschau
 * im Adminbereich („Von“ / „Antwort an“).
 */
export async function mailEnvelope(): Promise<{ from: string; replyTo: string }> {
  const [from, contact] = await Promise.all([mailFrom(), contactAddress()]);
  return {
    from: from.name ? `${from.name} <${from.address}>` : from.address,
    replyTo: contact && contact !== from.address ? contact : '',
  };
}

/**
 * Fusszeile für alle E-Mails an Eltern: Hinweis auf die Kontaktadresse, damit
 * Rückfragen einen klaren Weg haben. Ohne konfigurierte Kontaktadresse bleibt sie leer.
 */
async function contactFooter(): Promise<{ html: string; text: string }> {
  const contact = await contactAddress();
  if (!contact) return { html: '', text: '' };
  return {
    html: `<p style="font-size:12px;color:#7b8794;line-height:1.6;margin:24px 0 0;border-top:1px solid #e6e9ee;padding-top:14px;">Fragen zu Ihren Fotos oder Ihrer Bestellung? Schreiben Sie uns an <a href="mailto:${contact}" style="color:#2f6fed;">${contact}</a>.</p>`,
    text: `\n\nFragen zu Ihren Fotos oder Ihrer Bestellung? Schreiben Sie uns an ${contact}`,
  };
}

/**
 * Schrift aller E-Mails – dieselbe wie in der App. Tabellen erben die Schrift in
 * manchen Mailprogrammen (Outlook) nicht, deshalb wird sie dort ausdrücklich
 * wiederholt.
 */
const FONT = "'Comic Sans MS','Comic Sans','Comic Neue',Helvetica,Arial,sans-serif";
const TEXT_COLOR = '#1f2933';
const MUTED_COLOR = '#7b8794';
const LINE_COLOR = '#e6e9ee';

/**
 * Rahmen aller E-Mails. Auf schmalen Bildschirmen (Handy) werden die Ränder um
 * die weisse Karte verkleinert, damit der Inhalt mehr Platz bekommt. Programme
 * ohne Unterstützung für `<style>` zeigen einfach die normalen Ränder.
 */
const wrap = (title: string, body: string, maxWidth = 520, footer = '') => `
<!doctype html><html lang="de"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><style>
  @media only screen and (max-width: 560px) {
    .mail-outer { padding: 12px 8px !important; }
    .mail-card { padding: 22px 16px !important; border-radius: 12px !important; }
  }
</style></head><body style="margin:0;background:#f4f5f7;font-family:${FONT};color:${TEXT_COLOR};">
  <div class="mail-outer" style="max-width:${maxWidth}px;margin:0 auto;padding:32px 20px;">
    <div class="mail-card" style="background:#fff;border-radius:16px;padding:32px;box-shadow:0 1px 3px rgba(0,0,0,.08);">
      <h1 style="font-size:20px;margin:0 0 16px;color:${TEXT_COLOR};">${title}</h1>
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
 * erfassten E-Mail-Adressen der Eltern schicken kann, sobald die Galerie freigeschaltet
 * ist. Enthält den Link zur App sowie Informationen zu den Fotos (Bestätigung,
 * Kauf, Wasserzeichen, Speicherort und Aufbewahrungsfrist).
 *
 * Mit `reminder: true` wird dieselbe Nachricht als Erinnerung formuliert
 * ("Ihre Fotos sind noch X Tage verfügbar"), z. B. für Eltern, die noch keine
 * Bestellung erfasst haben. `daysLeft` ist die verbleibende Anzahl Tage bis zur
 * Archivierung; fehlt sie, wird auf die Standard-Aufbewahrungsdauer zurück-
 * gegriffen.
 */
export interface GalleryMailOptions {
  retentionDays?: number;
  reminder?: boolean;
  daysLeft?: number | null;
  // Wenn gesetzt, weist die Erinnerung zusätzlich darauf hin, dass der
  // Bestellzeitraum bis zu diesem Datum verlängert wurde.
  extendedUntil?: string | null;
}

/** Fertig aufgebaute E-Mail (Betreff, HTML und Textversion) – für Versand und Vorschau. */
export interface BuiltMail {
  subject: string;
  html: string;
  text: string;
}

export async function sendGalleryReadyEmail(to: string, link: string, opts: GalleryMailOptions = {}) {
  await sendMail({ to, ...(await buildGalleryReadyEmail(link, opts)) });
}

/**
 * Baut die Einladung bzw. Erinnerung auf, ohne sie zu versenden. Der Versand
 * und die Vorschau im Adminbereich nutzen dieselbe Funktion, die Vorschau
 * zeigt also genau die E-Mail, die die Eltern erhalten.
 */
export async function buildGalleryReadyEmail(link: string, opts: GalleryMailOptions = {}): Promise<BuiltMail> {
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
  return { subject, html, text };
}

export interface OrderConfirmationAddress {
  first_name: string;
  last_name: string;
  street: string;
  house_no: string;
  zip: string;
  city: string;
}

/** Eine Position der Bestellbestätigung – mit Miniaturbild des bestellten Fotos. */
export interface OrderMailItem {
  /** Foto der Position; gleiche Fotos teilen sich ein eingebettetes Bild. */
  photoId: string;
  productName: string;
  productType: 'digital' | 'print';
  productKind: 'digital' | 'photo' | 'sticker' | 'magnet';
  includesDigital: boolean;
  qty: number;
  lineTotalCents: number;
  /** Wer bzw. was auf dem Foto ist: Name des Kindes oder Dateiname (z. B. „Klassenbild1“). */
  label: string;
  /** Kleines, quadratisches JPEG (siehe `mailThumbnail`); null, wenn keines vorliegt. */
  image: Buffer | null;
}

export interface OrderConfirmationData {
  currency: string;
  /** Zeitpunkt der Bestellung (Zahlung) – erscheint als Datum im Einleitungssatz. */
  orderedAt: string;
  subtotalCents: number;
  shippingFeeCents: number;
  totalCents: number;
  items: OrderMailItem[];
  shippingAddress: OrderConfirmationAddress | null;
  /** Link zur Bestellung in der App. */
  link: string;
}

/**
 * Wie die Miniaturbilder eingebunden werden: `cid` für den Versand (Bilder
 * reisen als eingebettete Anhänge mit), `inline` für die Vorschau im
 * Adminbereich (Bilder direkt als data:-URL im HTML).
 */
export type MailImageMode = 'cid' | 'inline';

export interface BuiltMailWithImages extends BuiltMail {
  attachments: MailAttachment[];
}

/**
 * Preis ohne Währungsangabe ("15.-" / "15.50") – gleich wie in der App
 * (siehe `formatPrice` im Frontend). Der Shop rechnet durchgehend in einer
 * Währung, deshalb steht sie nur beim Gesamtbetrag.
 */
function formatMoney(cents: number, currency: string): string {
  const code = currency.toUpperCase();
  if (code === 'CHF') {
    const hasRappen = Math.round(cents) % 100 !== 0;
    const francs = Math.round(cents) / 100;
    return hasRappen ? francs.toFixed(2) : `${Math.round(francs)}.-`;
  }
  return (cents / 100).toFixed(2);
}

/** Kurzbeschrieb einer Position: Druck oder Digital und wie sie zu den Eltern kommt. */
function orderItemKindText(item: OrderMailItem): string {
  if (item.productType === 'digital') return 'Digitale Datei zum Herunterladen';
  switch (item.productKind) {
    case 'sticker':
      return 'Sticker per Post';
    case 'magnet':
      return 'Magnete per Post';
    default:
      return item.includesDigital ? 'Druck per Post, inkl. digitaler Datei' : 'Druck per Post';
  }
}

function orderItemTitle(item: OrderMailItem): string {
  return `${item.qty > 1 ? `${item.qty}× ` : ''}${item.productName}`;
}

function formatOrderDate(value: string): string {
  const d = new Date(value);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('de-CH', { dateStyle: 'long', timeZone: 'Europe/Zurich' });
}

/**
 * Baut die Bestellbestätigung auf, ohne sie zu versenden. Versand und Vorschau
 * im Adminbereich („Bestellbestätigung ansehen“) nutzen dieselbe Funktion.
 *
 * Aufbau: je Position eine Zeile mit Miniaturbild, Produkt, Foto (Kind bzw.
 * Dateiname), Druck/Digital und Preis; darunter Zwischensumme, Versand und
 * Gesamtbetrag, bei Druckprodukten die Lieferadresse. Alles in derselben
 * Schrift wie der übrige Text, ohne farbige Kästen.
 */
export async function buildOrderConfirmationEmail(
  data: OrderConfirmationData,
  imageMode: MailImageMode = 'cid',
): Promise<BuiltMailWithImages> {
  const footer = await contactFooter();
  const money = (cents: number) => formatMoney(cents, data.currency);
  const currencyCode = data.currency.toUpperCase();
  const hasPrint = data.items.some((i) => i.productType === 'print');
  const hasDigital = data.items.some((i) => i.productType === 'digital' || i.includesDigital);
  const date = formatOrderDate(data.orderedAt);
  const address = hasPrint ? data.shippingAddress : null;

  // Ein eingebettetes Bild je Foto – wird dasselbe Foto mehrfach bestellt
  // (z. B. als Druck und als Magnete), reist es trotzdem nur einmal mit.
  const attachments: MailAttachment[] = [];
  const imageSrc = new Map<string, string>();
  for (const item of data.items) {
    if (!item.image || imageSrc.has(item.photoId)) continue;
    if (imageMode === 'inline') {
      imageSrc.set(item.photoId, `data:image/jpeg;base64,${item.image.toString('base64')}`);
    } else {
      const n = attachments.length + 1;
      const cid = `foto-${n}@bestellung`;
      attachments.push({ filename: `foto-${n}.jpg`, content: item.image, contentType: 'image/jpeg', cid });
      imageSrc.set(item.photoId, `cid:${cid}`);
    }
  }

  const cell = `font-family:${FONT};color:${TEXT_COLOR};`;
  const itemRows = data.items
    .map((item) => {
      const src = imageSrc.get(item.photoId);
      const thumb = src
        ? `<img src="${src}" width="64" height="64" alt="${escapeHtml(item.label || item.productName)}" style="display:block;width:64px;height:64px;border:0;border-radius:8px;" />`
        : `<div style="width:64px;height:64px;border-radius:8px;background:#f0f4f8;"></div>`;
      return `<tr>
          <td width="64" valign="top" style="width:64px;padding:12px 14px 12px 0;border-bottom:1px solid ${LINE_COLOR};">${thumb}</td>
          <td valign="top" style="${cell}padding:12px 0;border-bottom:1px solid ${LINE_COLOR};font-size:15px;line-height:1.45;">
            <strong>${escapeHtml(orderItemTitle(item))}</strong>${
              item.label
                ? `<br /><span style="font-size:14px;">${escapeHtml(item.label)}</span>`
                : ''
            }<br /><span style="font-size:13px;color:${MUTED_COLOR};">${escapeHtml(orderItemKindText(item))}</span>
          </td>
          <td valign="top" align="right" style="${cell}padding:12px 0 12px 12px;border-bottom:1px solid ${LINE_COLOR};font-size:15px;line-height:1.45;text-align:right;white-space:nowrap;">${money(item.lineTotalCents)}</td>
        </tr>`;
    })
    .join('');

  const sumRow = (label: string, value: string, strong = false) =>
    `<tr>
       <td style="${cell}padding:${strong ? '10px 0 0' : '4px 0'};font-size:${strong ? '16px' : '14px'};${strong ? '' : `color:${MUTED_COLOR};`}">${strong ? `<strong>${label}</strong>` : label}</td>
       <td align="right" style="${cell}padding:${strong ? '10px 0 0' : '4px 0'};font-size:${strong ? '16px' : '14px'};text-align:right;white-space:nowrap;">${strong ? `<strong>${value}</strong>` : value}</td>
     </tr>`;
  const sums =
    (data.shippingFeeCents > 0
      ? sumRow('Zwischensumme', money(data.subtotalCents)) +
        sumRow('Versand per Post', money(data.shippingFeeCents))
      : '') + sumRow('Gesamt', `${money(data.totalCents)} ${currencyCode}`, true);

  const addressLines = address
    ? [
        `${address.first_name} ${address.last_name}`,
        `${address.street} ${address.house_no}`,
        `${address.zip} ${address.city}`,
      ]
    : [];
  const deliveryHtml = hasPrint
    ? `<h2 style="font-size:16px;margin:28px 0 6px;color:${TEXT_COLOR};">Lieferung</h2>
       <p style="font-size:15px;line-height:1.6;margin:0;">Ihre gedruckten Fotos schicken wir Ihnen in ca. <strong style="white-space:nowrap;">3–4 Wochen</strong> per Post${
         address ? ' an diese Adresse:' : '.'
       }</p>${
         address
           ? `<p style="font-size:15px;line-height:1.6;margin:8px 0 0;">${addressLines.map(escapeHtml).join('<br />')}</p>`
           : ''
       }`
    : '';
  const downloadHtml = hasDigital
    ? `<p style="font-size:15px;line-height:1.6;margin:24px 0 0;">Die digitalen Dateien stehen ab sofort zum Herunterladen bereit.</p>`
    : '';
  const buttonLabel = hasDigital ? 'Bestellung & Downloads ansehen' : 'Bestellung ansehen';

  const intro = date
    ? `Wir haben Ihre Bestellung vom ${escapeHtml(date)} erhalten und bestätigt.`
    : 'Wir haben Ihre Bestellung erhalten und bestätigt.';

  const html = wrap(
    'Vielen Dank für Ihre Bestellung',
    `<p style="font-size:15px;line-height:1.6;">Guten Tag</p>
     <p style="font-size:15px;line-height:1.6;margin-bottom:8px;">${intro}</p>
     <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">
       ${itemRows}
     </table>
     <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;margin-top:8px;">
       ${sums}
     </table>
     ${deliveryHtml}
     ${downloadHtml}
     <p style="text-align:center;margin:${hasDigital ? '14px' : '28px'} 0 20px;">
       <a href="${data.link}" style="display:inline-block;background:#2f6fed;color:#fff;text-decoration:none;padding:12px 26px;border-radius:10px;font-weight:600;">${buttonLabel}</a>
     </p>`,
    520,
    footer.html,
  );

  const itemsText = data.items
    .map(
      (item) =>
        `${orderItemTitle(item)} – ${money(item.lineTotalCents)}\n   ${[item.label, orderItemKindText(item)]
          .filter(Boolean)
          .join(' · ')}`,
    )
    .join('\n\n');
  const sumsText = [
    ...(data.shippingFeeCents > 0
      ? [`Zwischensumme: ${money(data.subtotalCents)}`, `Versand per Post: ${money(data.shippingFeeCents)}`]
      : []),
    `Gesamt: ${money(data.totalCents)} ${currencyCode}`,
  ].join('\n');
  const deliveryText = hasPrint
    ? `\n\nLieferung: Ihre gedruckten Fotos schicken wir Ihnen in ca. 3–4 Wochen per Post${
        address ? ` an diese Adresse:\n${addressLines.join('\n')}` : '.'
      }`
    : '';
  const downloadText = hasDigital ? '\n\nDie digitalen Dateien stehen ab sofort zum Herunterladen bereit.' : '';

  const subject = hasPrint
    ? 'Ihre Bestellung ist bestätigt – Druck folgt'
    : 'Ihre Bestellung ist bestätigt';
  const text = `Guten Tag

${intro}

${itemsText}

${sumsText}${deliveryText}${downloadText}

${buttonLabel}: ${data.link}${footer.text}`;
  return { subject, html, text, attachments };
}

export async function sendOrderConfirmation(to: string, data: OrderConfirmationData) {
  const { attachments, ...mail } = await buildOrderConfirmationEmail(data, 'cid');
  await sendMail({ to, ...mail, attachments });
}

/**
 * Versandbestätigung für ausgedruckte Fotos: kurze, freundliche Nachricht an
 * Eltern, deren bestellte Fotos heute verschickt wurden. Bewusst schlicht
 * gehalten – keine technische Bestellnummer, nur die Bestätigung des Versands
 * und der Link zu den Bestellungen.
 */
export async function sendShippingConfirmationEmail(to: string, link: string) {
  await sendMail({ to, ...(await buildShippingConfirmationEmail(link)) });
}

/** Baut die Versandbestätigung auf (Versand und Vorschau im Adminbereich). */
export async function buildShippingConfirmationEmail(link: string): Promise<BuiltMail> {
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
  return { subject, html, text };
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
    ? `Die E-Mail-Adresse ist als Adresse der Eltern erfasst${info.parentName ? ` (${escapeHtml(info.parentName)})` : ''} und im Adminbereich rot markiert. Prüfe die Schreibweise und korrigiere sie im Auftrag („Bearbeiten“ → E-Mail-Adresse beim Kind anpassen).`
    : 'Die E-Mail-Adresse ist keiner erfassten Adresse der Eltern zugeordnet.';
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

${info.parentEmailId ? 'Die E-Mail-Adresse ist als Adresse der Eltern erfasst und im Adminbereich rot markiert. Prüfe die Schreibweise und korrigiere sie im Auftrag.' : 'Die E-Mail-Adresse ist keiner erfassten Adresse der Eltern zugeordnet.'}

Zustellprobleme im Adminbereich öffnen: ${info.adminLink}`;
  await sendMail({ to, subject, html, text });
}

// ---------------------------------------------------------------------------
// Klassenerfassung & Einverständniserklärung
// ---------------------------------------------------------------------------

/** Eckdaten einer Klasse für die Mails der Klassenerfassung (Daten bereits formatiert). */
export interface ClassMailInfo {
  className: string;
  school: string;
  /** Formatierter Fototermin, leer wenn unbekannt. */
  shootingDate: string;
  /** Formatierte Rückmeldefrist, leer wenn keine gesetzt. */
  deadline: string;
}

/** Kleine Tabelle mit Klasse, Schule, Fototermin und Frist (HTML + Text). */
function classFacts(info: ClassMailInfo): { html: string; text: string } {
  const rows: [string, string][] = [['Klasse', info.className]];
  if (info.school) rows.push(['Schule', info.school]);
  if (info.shootingDate) rows.push(['Fototermin', info.shootingDate]);
  if (info.deadline) rows.push(['Rückmeldung bis', info.deadline]);
  const html = `<table style="font-size:14px;line-height:1.6;border-collapse:collapse;margin:12px 0;">${rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:2px 12px 2px 0;color:#7b8794;">${escapeHtml(k)}</td><td>${escapeHtml(v)}</td></tr>`,
    )
    .join('')}</table>`;
  const text = rows.map(([k, v]) => `${k}: ${v}`).join('\n');
  return { html, text };
}

const button = (href: string, label: string) =>
  `<p style="text-align:center;margin:24px 0;">
     <a href="${href}" style="display:inline-block;background:#2f6fed;color:#fff;text-decoration:none;padding:13px 28px;border-radius:10px;font-weight:600;font-size:15px;">${escapeHtml(label)}</a>
   </p>
   <p style="font-size:13px;color:#7b8794;line-height:1.6;word-break:break-all;">Falls der Button nicht funktioniert: <br />${href}</p>`;

export interface TeacherLinkMailInfo extends ClassMailInfo {
  teacherName: string;
  link: string;
  teacherEntersEmails: boolean;
  parentLinkEnabled: boolean;
  consentRequired: boolean;
}

/**
 * Persönlicher Link der Lehrperson zur Klassenseite. Erklärt in wenigen
 * Punkten, was dort zu tun ist – abhängig davon, was der Fotograf beim Anlegen
 * der Klasse gewählt hat.
 */
export async function sendTeacherLinkEmail(to: string, info: TeacherLinkMailInfo) {
  const subject = `Klassenerfassung für die Schulfotografie: ${info.className}`;
  const facts = classFacts(info);
  const footer = await contactFooter();
  const greeting = info.teacherName ? `Guten Tag ${escapeHtml(info.teacherName)}` : 'Guten Tag';
  const todosHtml: string[] = [
    'Die Namen der Kinder eintragen (Vor- und Nachname), ein Name pro Zeile.',
  ];
  const todosText: string[] = [...todosHtml];
  if (info.parentLinkEnabled) {
    const t =
      'Den Klassenlink oder QR-Code an die Eltern weitergeben, z. B. über Ihren üblichen Kommunikationskanal. Die Eltern tragen ihre E-Mail-Adresse und ihr Kind ebenfalls ein.';
    todosHtml.push(t);
    todosText.push(t);
  }
  if (info.teacherEntersEmails) {
    const t =
      'Die E-Mail-Adressen der Eltern erfassen (Kind und E-Mail-Adresse). Die Eltern erhalten dann automatisch eine Einladung.';
    todosHtml.push(t);
    todosText.push(t);
  }
  if (info.consentRequired) {
    const t =
      'Auf der Klassenseite sehen Sie jederzeit, welche Eltern das Einverständnis bereits abgegeben haben.';
    todosHtml.push(t);
    todosText.push(t);
  }
  const html = wrap(
    'Klassenerfassung für die Schulfotografie',
    `<p style="font-size:15px;line-height:1.6;">${greeting}</p>
     <p style="font-size:15px;line-height:1.6;">Für die Schulfotografie wird die Klassenliste online erfasst. Über Ihren persönlichen Link gelangen Sie zur Klassenseite:</p>
     ${facts.html}
     ${button(info.link, 'Klassenseite öffnen')}
     <div style="background:#f0f4f8;border-radius:12px;padding:16px 18px;margin-top:18px;">
       <p style="font-size:14px;line-height:1.6;margin:0 0 8px;"><strong>Was auf der Klassenseite zu tun ist</strong></p>
       <ul style="font-size:14px;line-height:1.6;padding-left:20px;margin:0;">
         ${todosHtml.map((t) => `<li>${escapeHtml(t)}</li>`).join('')}
       </ul>
     </div>
     <p style="font-size:13px;color:#7b8794;line-height:1.6;margin-top:16px;">Der Link ist persönlich und einmalig gültig. Später melden Sie sich einfach auf ${escapeHtml(config.publicAppUrl)} mit dieser E-Mail-Adresse an, Sie gelangen dann automatisch zu Ihrer Klasse. Bitte geben Sie den Link nicht weiter.</p>`,
    560,
    footer.html,
  );
  const text = `${info.teacherName ? `Guten Tag ${info.teacherName}` : 'Guten Tag'}

Für die Schulfotografie wird die Klassenliste online erfasst. Über Ihren persönlichen Link gelangen Sie zur Klassenseite:

${info.link}

${facts.text}

Was auf der Klassenseite zu tun ist:
${todosText.map((t) => `- ${t}`).join('\n')}

Der Link ist persönlich und einmalig gültig. Später melden Sie sich einfach auf ${config.publicAppUrl} mit dieser E-Mail-Adresse an. Bitte geben Sie den Link nicht weiter.${footer.text}`;
  await sendMail({ to, subject, html, text });
}

export interface ConsentInviteMailInfo extends ClassMailInfo {
  childNames: string[];
  link: string;
  reminder: boolean;
  consentRequired: boolean;
}

/**
 * Einladung an Eltern, deren E-Mail-Adresse die Lehrperson oder der Fotograf
 * erfasst hat: ein Klick bestätigt sie und öffnet das Einverständnis-Formular.
 * Mit `reminder` als Erinnerung formuliert.
 */
export async function sendConsentInviteEmail(to: string, info: ConsentInviteMailInfo) {
  await sendMail({ to, ...(await buildConsentInviteEmail(info)) });
}

/** Baut die Einladung zum Einverständnis auf (Versand und Vorschau im Adminbereich). */
export async function buildConsentInviteEmail(info: ConsentInviteMailInfo): Promise<BuiltMail> {
  const kids = info.childNames.join(', ') || 'Ihr Kind';
  const subject = info.consentRequired
    ? info.reminder
      ? `Erinnerung: Einverständnis für die Schulfotografie (${kids})`
      : `Einverständnis für die Schulfotografie: ${info.className}`
    : `Schulfotografie ${info.className}: Bitte E-Mail-Adresse bestätigen`;
  const facts = classFacts(info);
  const footer = await contactFooter();
  const intro = info.consentRequired
    ? info.reminder
      ? `Für <strong>${escapeHtml(kids)}</strong> liegt uns noch keine Antwort zur Schulfotografie vor. Bitte teilen Sie uns mit einem Klick mit, ob und wie Ihr Kind fotografiert werden darf.`
      : `Die Klasse wird fotografiert. Für <strong>${escapeHtml(kids)}</strong> bitten wir Sie um Ihr Einverständnis: Mit einem Klick bestätigen Sie Ihre E-Mail-Adresse und gelangen direkt zum Formular. Dort wählen Sie, ob und wie Ihr Kind fotografiert werden darf.`
    : `Die Klasse wird fotografiert. Damit Sie die Fotos von <strong>${escapeHtml(kids)}</strong> später ansehen und bestellen können, bestätigen Sie bitte mit einem Klick Ihre E-Mail-Adresse.`;
  const introText = intro.replace(/<[^>]+>/g, '');
  const deadlineHtml = info.deadline
    ? `<p style="font-size:15px;line-height:1.6;">Bitte antworten Sie bis zum <strong>${escapeHtml(info.deadline)}</strong>.</p>`
    : '';
  const deadlineText = info.deadline ? `\n\nBitte antworten Sie bis zum ${info.deadline}.` : '';
  const buttonLabel = info.consentRequired ? 'Einverständnis abgeben' : 'E-Mail-Adresse bestätigen';
  const html = wrap(
    info.consentRequired ? 'Einverständnis für die Schulfotografie' : 'Schulfotografie: E-Mail-Adresse bestätigen',
    `<p style="font-size:15px;line-height:1.6;">Guten Tag</p>
     <p style="font-size:15px;line-height:1.6;">${intro}</p>
     ${facts.html}
     ${deadlineHtml}
     ${button(info.link, buttonLabel)}
     <p style="font-size:13px;color:#7b8794;line-height:1.6;">Der Link ist einmalig gültig. Später können Sie sich jederzeit auf ${escapeHtml(config.publicAppUrl)} mit dieser E-Mail-Adresse anmelden und Ihre Antwort ansehen oder ändern. Bitte geben Sie den Link nicht weiter.</p>`,
    560,
    footer.html,
  );
  const text = `Guten Tag

${introText}

${facts.text}${deadlineText}

${buttonLabel}: ${info.link}

Der Link ist einmalig gültig. Später können Sie sich jederzeit auf ${config.publicAppUrl} mit dieser E-Mail-Adresse anmelden und Ihre Antwort ansehen oder ändern.${footer.text}`;
  return { subject, html, text };
}

export interface RegistrationVerifyMailInfo extends ClassMailInfo {
  childName: string;
  link: string;
  consentRequired: boolean;
}

/**
 * Bestätigungs-Mail nach der Selbstregistrierung über den Klassenlink: Erst der
 * Klick trägt das Kind wirklich in die Klassenliste ein.
 */
export async function sendRegistrationVerifyEmail(to: string, info: RegistrationVerifyMailInfo) {
  const subject = `Bitte bestätigen: ${info.childName} für die Schulfotografie ${info.className}`;
  const facts = classFacts(info);
  const footer = await contactFooter();
  const after = info.consentRequired
    ? ' Danach gelangen Sie direkt zum Einverständnis-Formular.'
    : ' Danach ist Ihr Kind in der Klassenliste eingetragen.';
  const html = wrap(
    'E-Mail-Adresse bestätigen',
    `<p style="font-size:15px;line-height:1.6;">Guten Tag</p>
     <p style="font-size:15px;line-height:1.6;">Sie haben <strong>${escapeHtml(info.childName)}</strong> für die Schulfotografie eingetragen. Bitte bestätigen Sie Ihre E-Mail-Adresse mit einem Klick.${after}</p>
     ${facts.html}
     ${button(info.link, 'E-Mail-Adresse bestätigen')}
     <p style="font-size:13px;color:#7b8794;line-height:1.6;">Der Link ist 48 Stunden gültig. Falls Sie das nicht waren, können Sie diese E-Mail ignorieren; ohne Bestätigung wird nichts eingetragen.</p>`,
    520,
    footer.html,
  );
  const text = `Guten Tag

Sie haben ${info.childName} für die Schulfotografie eingetragen. Bitte bestätigen Sie Ihre E-Mail-Adresse mit einem Klick.${after}

${facts.text}

E-Mail-Adresse bestätigen: ${info.link}

Der Link ist 48 Stunden gültig. Falls Sie das nicht waren, können Sie diese E-Mail ignorieren; ohne Bestätigung wird nichts eingetragen.${footer.text}`;
  await sendMail({ to, subject, html, text });
}

export interface ConsentConfirmationMailInfo extends ClassMailInfo {
  /**
   * Eine Zeile je Kind. Geschwister landen bewusst in EINER E-Mail: Wer für
   * zwei Kinder antwortet, soll auch nur eine Bestätigung erhalten.
   */
  entries: { childName: string; decisionLabel: string }[];
  link: string;
}

/** Bestätigung der abgegebenen Entscheidung(en), als Beleg für die Eltern. */
export async function sendConsentConfirmationEmail(to: string, info: ConsentConfirmationMailInfo) {
  const names = info.entries.map((e) => e.childName);
  const many = info.entries.length > 1;
  const subject = many
    ? `Ihre Antworten zur Schulfotografie: ${names.join(', ')}`
    : `Ihre Antwort zur Schulfotografie: ${names[0] ?? ''}`;
  const facts = classFacts(info);
  const footer = await contactFooter();
  const intro = many
    ? 'Ihre Antworten haben wir gespeichert:'
    : `Ihre Antwort für <strong>${escapeHtml(names[0] ?? '')}</strong> haben wir gespeichert:`;
  const introText = many
    ? 'Ihre Antworten haben wir gespeichert:'
    : `Ihre Antwort für ${names[0] ?? ''} haben wir gespeichert:`;
  const answersHtml = info.entries
    .map(
      (e) =>
        `<p style="font-size:15px;line-height:1.6;background:#f0f4f8;border-radius:12px;padding:14px 16px;margin:0 0 10px;">${
          many ? `<strong>${escapeHtml(e.childName)}</strong><br />` : ''
        }<strong>${escapeHtml(e.decisionLabel)}</strong></p>`,
    )
    .join('');
  const answersText = info.entries
    .map((e) => (many ? `${e.childName}: ${e.decisionLabel}` : e.decisionLabel))
    .join('\n');
  const html = wrap(
    'Vielen Dank für Ihre Antwort',
    `<p style="font-size:15px;line-height:1.6;">Guten Tag</p>
     <p style="font-size:15px;line-height:1.6;">${intro}</p>
     ${answersHtml}
     ${facts.html}
     <p style="font-size:14px;line-height:1.6;">Sie können Ihre ${many ? 'Antworten' : 'Antwort'} bis zum Fototermin ändern. Melden Sie sich dazu einfach mit dieser E-Mail-Adresse an.</p>
     ${button(info.link, many ? 'Antworten ansehen' : 'Antwort ansehen')}`,
    520,
    footer.html,
  );
  const text = `Guten Tag

${introText}

${answersText}

${facts.text}

Sie können Ihre ${many ? 'Antworten' : 'Antwort'} bis zum Fototermin ändern. Melden Sie sich dazu einfach mit dieser E-Mail-Adresse an: ${info.link}${footer.text}`;
  await sendMail({ to, subject, html, text });
}

export interface RegistrationCompletedMailInfo {
  className: string;
  school: string;
  teacherName: string;
  teacherEmail: string;
  children: number;
  answered: number;
  pending: number;
  declined: number;
  adminLink: string;
}

/** Info an die Admins: Die Lehrperson hat die Erfassung als abgeschlossen gemeldet. */
export async function sendRegistrationCompletedEmail(to: string[], info: RegistrationCompletedMailInfo) {
  const subject = `Klassenerfassung abgeschlossen: ${info.className}`;
  const who = info.teacherName ? `${info.teacherName} (${info.teacherEmail})` : info.teacherEmail;
  const html = wrap(
    'Klassenerfassung abgeschlossen',
    `<p style="font-size:15px;line-height:1.6;">Die Lehrperson ${escapeHtml(who)} hat die Erfassung der Klasse <strong>${escapeHtml(info.className)}</strong>${info.school ? ` (${escapeHtml(info.school)})` : ''} als abgeschlossen gemeldet.</p>
     <table style="font-size:14px;line-height:1.6;border-collapse:collapse;">
       <tr><td style="padding:2px 12px 2px 0;color:#7b8794;">Kinder</td><td>${info.children}</td></tr>
       <tr><td style="padding:2px 12px 2px 0;color:#7b8794;">Antworten</td><td>${info.answered}</td></tr>
       <tr><td style="padding:2px 12px 2px 0;color:#7b8794;">Ausstehend</td><td>${info.pending}</td></tr>
       <tr><td style="padding:2px 12px 2px 0;color:#7b8794;">Nein</td><td>${info.declined}</td></tr>
     </table>
     ${button(info.adminLink, 'Erfassung im Adminbereich öffnen')}`,
  );
  const text = `Die Lehrperson ${who} hat die Erfassung der Klasse ${info.className}${info.school ? ` (${info.school})` : ''} als abgeschlossen gemeldet.

Kinder:     ${info.children}
Antworten:  ${info.answered}
Ausstehend: ${info.pending}
Nein:       ${info.declined}

Erfassung im Adminbereich öffnen: ${info.adminLink}`;
  await sendMail({ to, subject, html, text, ...(info.teacherEmail ? { replyTo: info.teacherEmail } : {}) });
}
