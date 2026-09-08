import { COL, getById, setById, nowIso } from '../db';
import { config } from '../config';
import { normalizeEmail } from '../lib/validation';

/**
 * App-weite Einstellungen, die der Admin im Adminbereich pflegt (statt in der
 * .env). Sie liegen in einem einzigen Firestore-Dokument `settings/app`:
 *
 *  - contact_email          öffentliche Kontaktadresse (Impressum, Hilfe-Seite
 *                           und Reply-To aller ausgehenden E-Mails)
 *  - shipping_fee_cents     Versandpauschale je Bestellung mit gedruckten
 *                           Produkten (einmal pro Bestellung)
 *  - report_notify_enabled  neue Meldung aus „Hilfe & Kontakt“ per E-Mail melden
 *  - report_notify_emails   Empfänger dafür (leer = alle Admin-Konten mit E-Mail)
 *  - bounce_notify_enabled  nicht zustellbare E-Mails per E-Mail melden
 *  - bounce_notify_emails   Empfänger dafür (leer = alle Admin-Konten mit E-Mail)
 *
 * Fehlende Felder fallen auf die Startwerte aus der Umgebung zurück, damit ein
 * bestehendes System ohne dieses Dokument unverändert weiterläuft. Das Dokument
 * wird bei jedem Zugriff kurz zwischengespeichert – es wird von jeder
 * ausgehenden E-Mail und jedem Warenkorb gelesen.
 */
export interface AppSettings {
  contact_email: string;
  shipping_fee_cents: number;
  report_notify_enabled: boolean;
  report_notify_emails: string[];
  bounce_notify_enabled: boolean;
  bounce_notify_emails: string[];
  updated_at: string | null;
}

export const APP_SETTINGS_ID = 'app';

const CACHE_TTL_MS = 30_000;
let cache: { value: AppSettings; at: number } | null = null;

function defaults(): AppSettings {
  return {
    contact_email: config.mail.contactEmailDefault ? normalizeEmail(config.mail.contactEmailDefault) : '',
    shipping_fee_cents: config.shop.shippingFeeCentsDefault,
    report_notify_enabled: true,
    report_notify_emails: [],
    bounce_notify_enabled: true,
    bounce_notify_emails: [],
    updated_at: null,
  };
}

/** Bereinigt eine Empfängerliste: trimmen, Kleinschreibung, Duplikate raus, nur E-Mails. */
export function cleanEmailList(input: unknown): string[] {
  const raw: string[] = Array.isArray(input)
    ? input.map((v) => String(v ?? ''))
    : typeof input === 'string'
      ? input.split(/[,;\s]+/)
      : [];
  const out: string[] = [];
  for (const entry of raw) {
    const email = normalizeEmail(entry);
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) continue;
    if (!out.includes(email)) out.push(email);
  }
  return out;
}

function fromDoc(doc: Record<string, unknown> | null): AppSettings {
  const d = defaults();
  if (!doc) return d;
  const contact =
    typeof doc.contact_email === 'string' ? normalizeEmail(doc.contact_email) : d.contact_email;
  const fee = Number(doc.shipping_fee_cents);
  return {
    contact_email: contact,
    shipping_fee_cents:
      Number.isFinite(fee) && fee >= 0 ? Math.round(fee) : d.shipping_fee_cents,
    report_notify_enabled:
      typeof doc.report_notify_enabled === 'boolean'
        ? doc.report_notify_enabled
        : d.report_notify_enabled,
    report_notify_emails: cleanEmailList(doc.report_notify_emails),
    bounce_notify_enabled:
      typeof doc.bounce_notify_enabled === 'boolean'
        ? doc.bounce_notify_enabled
        : d.bounce_notify_enabled,
    bounce_notify_emails: cleanEmailList(doc.bounce_notify_emails),
    updated_at: typeof doc.updated_at === 'string' ? doc.updated_at : null,
  };
}

export async function getAppSettings(): Promise<AppSettings> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;
  let value: AppSettings;
  try {
    const doc = await getById<Record<string, unknown>>(COL.settings, APP_SETTINGS_ID);
    value = fromDoc(doc);
  } catch (err) {
    // Einstellungen dürfen nie einen Versand oder Warenkorb blockieren.
    // eslint-disable-next-line no-console
    console.error('[settings] could not load settings/app – using defaults', err);
    value = defaults();
  }
  cache = { value, at: Date.now() };
  return value;
}

/** Speichert die übergebenen Felder (Teil-Update) und leert den Cache. */
export async function updateAppSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const current = await getAppSettings();
  const next: AppSettings = { ...current, ...patch, updated_at: nowIso() };
  next.contact_email = next.contact_email ? normalizeEmail(next.contact_email) : '';
  next.shipping_fee_cents = Math.max(0, Math.round(Number(next.shipping_fee_cents) || 0));
  next.report_notify_emails = cleanEmailList(next.report_notify_emails);
  next.bounce_notify_emails = cleanEmailList(next.bounce_notify_emails);
  await setById(COL.settings, APP_SETTINGS_ID, { ...next });
  cache = { value: next, at: Date.now() };
  return next;
}

/** Cache verwerfen (z. B. in Tests oder nach externen Änderungen). */
export function resetSettingsCache(): void {
  cache = null;
}

/** Die öffentliche Kontaktadresse (leer, wenn keine konfiguriert ist). */
export async function contactEmail(): Promise<string> {
  return (await getAppSettings()).contact_email;
}
