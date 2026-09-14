import crypto from 'crypto';
import { COL, getById, setById, nowIso } from '../db';
import { config } from '../config';

/**
 * Einverständniserklärung der Eltern zur Schulfotografie (Klassenerfassung).
 *
 * Die Eltern wählen genau EINE der vier Antworten. Sie lehnen sich an das
 * Papierformular der Schulen an (Zettel „Einverständniserklärung fürs
 * Fotografieren, pro Kind ein Zettel“):
 *
 *  - all              Ja: Klassenfoto UND Einzelfotos
 *  - group_only       nur aufs Klassenfoto, keine Einzelfotos
 *  - individual_only  nur Einzelfotos, nicht aufs Klassenfoto
 *  - none             Nein: gar nicht fotografieren
 *
 * Jede abgegebene Entscheidung wird als eigenes, unveränderliches Dokument in
 * der Sammlung `consents` abgelegt (Kind, Adresse, Entscheidung, Zeitpunkt,
 * Version des Textes, Browser). Eine neue Entscheidung derselben Adresse für
 * dasselbe Kind ersetzt die alte, indem die alte als `superseded` markiert
 * wird – so bleibt der Verlauf als Nachweis erhalten.
 */
export const CONSENT_DECISIONS = ['all', 'group_only', 'individual_only', 'none'] as const;
export type ConsentDecision = (typeof CONSENT_DECISIONS)[number];

/** Vollständiger Wortlaut der Antworten, wie sie die Eltern im Formular sehen. */
export const CONSENT_LABELS: Record<ConsentDecision, string> = {
  all: 'Ja, mein Kind darf fotografiert werden: aufs Klassenfoto und für Einzelfotos.',
  group_only: 'Mein Kind darf nur aufs Klassenfoto. Keine Einzelfotos.',
  individual_only: 'Mein Kind darf nur für Einzelfotos fotografiert werden, nicht aufs Klassenfoto.',
  none: 'Nein, mein Kind soll nicht fotografiert werden und nicht aufs Klassenfoto.',
};

/** Kurzform für Tabellen, Listen und die Fototermin-Liste. */
export const CONSENT_SHORT_LABELS: Record<ConsentDecision, string> = {
  all: 'Ja, alles',
  group_only: 'Nur Klassenfoto',
  individual_only: 'Nur Einzelfotos',
  none: 'Nein',
};

export function isConsentDecision(value: unknown): value is ConsentDecision {
  return typeof value === 'string' && (CONSENT_DECISIONS as readonly string[]).includes(value);
}

export function allowsGroupPhoto(decision: ConsentDecision): boolean {
  return decision === 'all' || decision === 'group_only';
}

export function allowsIndividualPhotos(decision: ConsentDecision): boolean {
  return decision === 'all' || decision === 'individual_only';
}

/**
 * Fasst die Antworten mehrerer Elternteile zu einem Kind zusammen. Es gilt
 * immer die einschränkendste Antwort: Das Klassenfoto ist nur erlaubt, wenn
 * ALLE es erlauben, Einzelfotos nur, wenn ALLE sie erlauben. Weichen die
 * Antworten voneinander ab, wird das als Widerspruch markiert, damit der
 * Fotograf nachfragen kann.
 */
export function combineDecisions(decisions: ConsentDecision[]): {
  effective: ConsentDecision | null;
  conflict: boolean;
} {
  if (decisions.length === 0) return { effective: null, conflict: false };
  const group = decisions.every(allowsGroupPhoto);
  const individual = decisions.every(allowsIndividualPhotos);
  const effective: ConsentDecision =
    group && individual ? 'all' : group ? 'group_only' : individual ? 'individual_only' : 'none';
  return { effective, conflict: new Set(decisions).size > 1 };
}

/**
 * Standard-Wortlaut der Einverständniserklärung. Im Adminbereich unter
 * „Einstellungen“ anpassbar; die Platzhalter {Klasse}, {Schule}, {Datum} und
 * {Tage} werden beim Anzeigen ersetzt.
 */
export const DEFAULT_CONSENT_TEXT = `Liebe Eltern

Die Klasse {Klasse} ({Schule}) wird am {Datum} fotografiert. Es entstehen ein Klassenfoto sowie Einzelfotos der Kinder. Die Fotos können Sie anschliessend online ansehen und bei Interesse bestellen. Es besteht keine Kaufpflicht.

So gehen wir mit den Fotos um:
- Die Einzelfotos Ihres Kindes sehen nur Sie, über Ihre bestätigte E-Mail-Adresse.
- Das Klassenfoto sehen alle Familien der Klasse und können es bestellen.
- Alle Fotos liegen auf einem Server in der Schweiz. Sie sind {Tage} Tage online bestellbar und werden danach archiviert.
- Ihre Antwort können Sie bis zum Fototermin jederzeit hier ändern.

Bitte wählen Sie, ob und wie Ihr Kind fotografiert werden darf.`;

export interface ConsentTextVars {
  klasse: string;
  schule: string;
  datum: string;
  tage?: number;
}

/** Ersetzt die Platzhalter im gespeicherten Text durch die Angaben des Auftrags. */
export function renderConsentText(template: string, vars: ConsentTextVars): string {
  const tage = String(vars.tage ?? config.retentionDaysDefault);
  return template
    .replace(/\{Klasse\}/g, vars.klasse || 'Ihres Kindes')
    .replace(/\{Schule\}/g, vars.schule || 'Schule')
    .replace(/\{Datum\}/g, vars.datum || 'Fototermin')
    .replace(/\{Tage\}/g, tage)
    // „Klasse 3b ()“ ohne Schule sieht unschön aus.
    .replace(/\s*\(Schule\)/g, '');
}

/** Kurzer, stabiler Fingerabdruck des Wortlauts (Version des Textes). */
export function consentTextHash(text: string): string {
  return crypto.createHash('sha256').update(text.trim()).digest('hex').slice(0, 16);
}

/**
 * Legt den Wortlaut unter seinem Hash ab (einmal je Version), damit zu jeder
 * Entscheidung später der genaue Text nachgeschlagen werden kann.
 */
export async function storeConsentText(text: string): Promise<string> {
  const hash = consentTextHash(text);
  const existing = await getById(COL.consentTexts, hash);
  if (!existing) {
    await setById(COL.consentTexts, hash, { text: text.trim(), created_at: nowIso() });
  }
  return hash;
}

/** Datum „2026-09-30“ als „30. September 2026“; andere Werte unverändert. */
export function formatDateDe(value: string | null | undefined): string {
  if (!value) return '';
  const d = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  if (isNaN(d.getTime())) return value;
  return d.toLocaleDateString('de-CH', { dateStyle: 'long', timeZone: 'Europe/Zurich' });
}
