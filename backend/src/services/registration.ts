import QRCode from 'qrcode';
import {
  COL,
  col,
  getById,
  firstOf,
  runQuery,
  setById,
  updateById,
  deleteById,
  deleteWhere,
  getManyById,
  linkId,
  nowIso,
} from '../db';
import { config } from '../config';
import { newId, randomToken } from '../lib/ids';
import { normalizeEmail } from '../lib/validation';
import { normalizeName, nameTokens } from '../lib/names';
import { audit } from '../lib/audit';
import { ApiError } from '../middleware/errorHandler';
import type { DeliveryProblemMarker } from '../lib/mailLog';
import {
  sendTeacherLinkEmail,
  sendConsentInviteEmail,
  sendRegistrationVerifyEmail,
  sendConsentConfirmationEmail,
  sendRegistrationCompletedEmail,
  type ClassMailInfo,
} from '../lib/email';
import { issueLinkToken, revokeLinkTokens, type RegistrationPayload } from './verification';
import { getAppSettings } from './settings';
import { allAdminEmails } from './mailDelivery';
import { recordInvitationsSent, invitationsSentForEvent } from './reminders';
import {
  CONSENT_LABELS,
  CONSENT_SHORT_LABELS,
  allowsGroupPhoto,
  allowsIndividualPhotos,
  combineDecisions,
  consentTextHash,
  formatDateDe,
  renderConsentText,
  storeConsentText,
  type ConsentDecision,
} from './consent';

/**
 * Klassenerfassung („Erfassung“) – die Vorstufe eines Auftrags.
 *
 * Der Fotograf legt eine Klasse an und entscheidet dabei, wer was tut:
 *  - Die Lehrperson erhält einen persönlichen Link zur Klassenseite, trägt die
 *    Kindernamen ein und sieht den Stand der Einverständnisse.
 *  - Optional erfasst die Lehrperson (oder der Fotograf) die E-Mail-Adressen der
 *    Eltern; die App lädt die Eltern dann per E-Mail ein (`teacher_enters_emails`).
 *  - Optional gibt es einen Klassenlink mit QR-Code, über den sich die Eltern
 *    selbst eintragen: E-Mail-Adresse, Kind, Bestätigung per Mail
 *    (`parent_link_enabled`).
 *  - Optional wird ein Einverständnis abgefragt (`consent_required`); ohne
 *    dient die Erfassung nur der Klassenliste.
 *
 * Die Erfassung IST der Auftrag (Status `collecting`): Kinder, E-Mail-Adressen
 * und Verknüpfungen entstehen direkt in den bekannten Sammlungen. „In Auftrag
 * übernehmen“ ist deshalb nur ein Statuswechsel auf `draft`, danach geht es im
 * Assistenten mit den Fotos weiter.
 */

export interface RegistrationDoc {
  school: string;
  /** Fototermin als „YYYY-MM-DD“, leer wenn unbekannt. */
  shooting_date: string | null;
  /** Rückmeldefrist als „YYYY-MM-DD“ (informativ + Basis der automatischen Erinnerung). */
  deadline: string | null;
  teacher_name: string;
  /** Normalisierte E-Mail-Adresse der Lehrperson; leer = keine Lehrperson beteiligt. */
  teacher_email: string;
  teacher_email_id: string | null;
  /** Lehrperson erfasst E-Mail-Adressen und sieht sie deshalb auch. */
  teacher_enters_emails: boolean;
  /** Klassenlink/QR-Code für die Selbstregistrierung der Eltern ist aktiv. */
  parent_link_enabled: boolean;
  parent_link_token: string | null;
  consent_required: boolean;
  auto_consent_reminder: boolean;
  auto_consent_reminder_days: number;
  auto_consent_reminder_sent_at: string | null;
  teacher_link_sent_at: string | null;
  teacher_completed_at: string | null;
  last_reminder_at: string | null;
  closed_at: string | null;
  created_at: string;
}

export interface RegistrationEvent {
  id: string;
  name: string;
  status: string;
  expires_at: string | null;
  created_at: string;
  registration?: RegistrationDoc | null;
}

interface ChildDoc {
  event_id: string;
  name: string;
  note?: string;
  source?: string;
  needs_review?: number;
  consent_status?: ConsentDecision | null;
  consent_conflict?: number;
  consent_updated_at?: string | null;
  created_at: string;
}

interface ParentEmailDoc {
  email: string;
  name?: string;
  status: string;
  delivery_problem?: DeliveryProblemMarker | null;
}

export interface ConsentDoc {
  event_id: string;
  child_id: string;
  email_id: string;
  email: string;
  decision: ConsentDecision;
  parent_name: string;
  text_hash: string;
  given_at: string;
  ip: string;
  user_agent: string;
  superseded: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** Gültigkeit des persönlichen Lehrpersonen-Links. */
const TEACHER_LINK_TTL_MS = 30 * DAY_MS;
/** Gültigkeit einer Einladung/Erinnerung zum Einverständnis. */
const INVITE_LINK_TTL_MS = 60 * DAY_MS;
/** Gültigkeit der Bestätigung nach der Selbstregistrierung. */
const REGISTER_LINK_TTL_MS = 2 * DAY_MS;
/** Höchstzahl Kinder je Klasse (Schutz vor Missbrauch des Klassenlinks). */
export const MAX_CHILDREN_PER_CLASS = 80;

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function chunk<T>(arr: T[], size = 30): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export function registrationOf(ev: RegistrationEvent | null | undefined): RegistrationDoc | null {
  return ev?.registration ?? null;
}

/** Läuft die Erfassung noch (Kinder eintragen, Einverständnis abgeben)? */
export function registrationOpen(ev: RegistrationEvent | null | undefined): boolean {
  if (!ev) return false;
  const reg = registrationOf(ev);
  return ev.status === 'collecting' && !!reg && !reg.closed_at;
}

export function isTeacherOf(ev: RegistrationEvent | null | undefined, email: string): boolean {
  const reg = registrationOf(ev);
  if (!reg || !reg.teacher_email) return false;
  return reg.teacher_email === normalizeEmail(email);
}

export function parentLinkUrl(token: string): string {
  return `${config.publicAppUrl}/k/${token}`;
}

/** Eckdaten der Klasse für E-Mails (Daten bereits formatiert). */
export function classMailInfo(ev: RegistrationEvent): ClassMailInfo {
  const reg = registrationOf(ev);
  return {
    className: ev.name,
    school: reg?.school ?? '',
    shootingDate: formatDateDe(reg?.shooting_date ?? null),
    deadline: formatDateDe(reg?.deadline ?? null),
  };
}

/** „anna.muster@gmail.com“ → „an…@gmail.com“ (für Lehrpersonen ohne Einsicht in die E-Mail-Adressen). */
export function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 0) return '…';
  const local = email.slice(0, at);
  const domain = email.slice(at);
  const keep = local.length > 3 ? 2 : 1;
  return `${local.slice(0, keep)}…${domain}`;
}

function isoDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

async function loadEvent(eventId: string): Promise<RegistrationEvent> {
  const ev = await getById<RegistrationEvent>(COL.events, eventId);
  if (!ev) throw new ApiError(404, 'Auftrag nicht gefunden.');
  return ev;
}

async function patchRegistration(
  eventId: string,
  patch: Partial<RegistrationDoc>,
): Promise<void> {
  const updates: Record<string, unknown> = { updated_at: nowIso() };
  for (const [k, v] of Object.entries(patch)) updates[`registration.${k}`] = v;
  await updateById(COL.events, eventId, updates);
}

// ---------------------------------------------------------------------------
// Anlegen und Einstellungen
// ---------------------------------------------------------------------------

export interface RegistrationSettingsInput {
  school: string;
  shootingDate: string | null;
  deadline: string | null;
  teacherEntersEmails: boolean;
  parentLinkEnabled: boolean;
  consentRequired: boolean;
  autoConsentReminder: boolean;
  autoConsentReminderDays: number;
}

export interface NewClassInput {
  name: string;
  teacherEmail: string;
  teacherName: string;
}

export interface CreatedClass {
  id: string;
  name: string;
  teacherLinkSent: boolean;
  teacherLinkError: string | null;
}

export async function createRegistrationEvents(
  classes: NewClassInput[],
  settings: RegistrationSettingsInput,
  opts: { sendTeacherLink: boolean; actor: string },
): Promise<CreatedClass[]> {
  const out: CreatedClass[] = [];
  for (const cls of classes) {
    const id = newId('evt');
    const teacherEmail = cls.teacherEmail ? normalizeEmail(cls.teacherEmail) : '';
    const registration: RegistrationDoc = {
      school: settings.school.trim(),
      shooting_date: isoDate(settings.shootingDate),
      deadline: isoDate(settings.deadline),
      teacher_name: cls.teacherName.trim(),
      teacher_email: teacherEmail,
      teacher_email_id: null,
      teacher_enters_emails: settings.teacherEntersEmails,
      parent_link_enabled: settings.parentLinkEnabled,
      parent_link_token: settings.parentLinkEnabled ? randomToken(24) : null,
      consent_required: settings.consentRequired,
      auto_consent_reminder: settings.autoConsentReminder,
      auto_consent_reminder_days: Math.max(1, Math.min(60, Math.round(settings.autoConsentReminderDays || 3))),
      auto_consent_reminder_sent_at: null,
      teacher_link_sent_at: null,
      teacher_completed_at: null,
      last_reminder_at: null,
      closed_at: null,
      created_at: nowIso(),
    };
    await setById(COL.events, id, {
      name: cls.name.trim(),
      description: '',
      status: 'collecting',
      // Keine Bestellfrist während der Erfassung – sie wird beim Veröffentlichen gesetzt.
      expires_at: null,
      registration,
      created_at: nowIso(),
      updated_at: nowIso(),
    });
    await audit('registration.create', `${id}: ${cls.name}`, opts.actor);
    const created: CreatedClass = { id, name: cls.name.trim(), teacherLinkSent: false, teacherLinkError: null };
    if (opts.sendTeacherLink && teacherEmail) {
      try {
        await sendTeacherLink(await loadEvent(id));
        created.teacherLinkSent = true;
      } catch (err) {
        created.teacherLinkError =
          err instanceof ApiError ? err.publicMessage : 'Der Link konnte nicht verschickt werden.';
      }
    }
    out.push(created);
  }
  return out;
}

export interface RegistrationPatchInput extends Partial<RegistrationSettingsInput> {
  teacherEmail?: string;
  teacherName?: string;
}

export async function updateRegistrationSettings(
  ev: RegistrationEvent,
  input: RegistrationPatchInput,
  actor: string,
): Promise<RegistrationEvent> {
  const reg = registrationOf(ev);
  if (!reg) throw new ApiError(400, 'Dieser Auftrag hat keine Klassenerfassung.');
  const patch: Partial<RegistrationDoc> = {};
  if (input.school !== undefined) patch.school = input.school.trim();
  if (input.shootingDate !== undefined) patch.shooting_date = isoDate(input.shootingDate);
  if (input.deadline !== undefined) patch.deadline = isoDate(input.deadline);
  if (input.teacherEntersEmails !== undefined) patch.teacher_enters_emails = input.teacherEntersEmails;
  if (input.consentRequired !== undefined) patch.consent_required = input.consentRequired;
  if (input.autoConsentReminder !== undefined) patch.auto_consent_reminder = input.autoConsentReminder;
  if (input.autoConsentReminderDays !== undefined) {
    patch.auto_consent_reminder_days = Math.max(1, Math.min(60, Math.round(input.autoConsentReminderDays)));
  }
  if (input.parentLinkEnabled !== undefined) {
    patch.parent_link_enabled = input.parentLinkEnabled;
    if (input.parentLinkEnabled && !reg.parent_link_token) patch.parent_link_token = randomToken(24);
  }
  if (input.teacherName !== undefined) patch.teacher_name = input.teacherName.trim();
  if (input.teacherEmail !== undefined) {
    const next = input.teacherEmail ? normalizeEmail(input.teacherEmail) : '';
    if (next !== reg.teacher_email) {
      // Eine andere Lehrperson: Der alte persönliche Link verfällt sofort. Die
      // Rolle selbst hängt an der E-Mail-Adresse am Auftrag, sie ist damit ebenfalls weg.
      if (reg.teacher_email_id) {
        await revokeLinkTokens(reg.teacher_email_id, 'teacher', `/klasse/${ev.id}`);
      }
      patch.teacher_email = next;
      patch.teacher_email_id = null;
      patch.teacher_link_sent_at = null;
      patch.teacher_completed_at = null;
    }
  }
  if (Object.keys(patch).length > 0) {
    await patchRegistration(ev.id, patch);
    await audit('registration.update', `${ev.id}: ${JSON.stringify(patch)}`, actor);
  }
  return loadEvent(ev.id);
}

// ---------------------------------------------------------------------------
// Lehrpersonen-Link
// ---------------------------------------------------------------------------

/** Findet oder erstellt das parent_emails-Dokument zu einer E-Mail-Adresse. */
async function upsertParentEmail(
  email: string,
  name: string,
): Promise<{ id: string; created: boolean; disabled: boolean }> {
  const normalized = normalizeEmail(email);
  const existing = await firstOf<ParentEmailDoc>(col(COL.parentEmails).where('email', '==', normalized));
  if (existing) {
    if (name && !existing.name) {
      await updateById(COL.parentEmails, existing.id, { name, updated_at: nowIso() });
    }
    return { id: existing.id, created: false, disabled: existing.status === 'disabled' };
  }
  const id = newId('eml');
  await setById(COL.parentEmails, id, {
    email: normalized,
    name: name || '',
    status: 'not_verified',
    verified_at: null,
    note: '',
    created_at: nowIso(),
    updated_at: nowIso(),
  });
  return { id, created: true, disabled: false };
}

/** Verschickt (erneut) den persönlichen Link der Lehrperson zur Klassenseite. */
export async function sendTeacherLink(ev: RegistrationEvent): Promise<void> {
  const reg = registrationOf(ev);
  if (!reg) throw new ApiError(400, 'Dieser Auftrag hat keine Klassenerfassung.');
  if (!reg.teacher_email) {
    throw new ApiError(400, 'Für diese Klasse ist keine E-Mail-Adresse einer Lehrperson hinterlegt.');
  }
  const teacher = await upsertParentEmail(reg.teacher_email, reg.teacher_name);
  if (teacher.disabled) {
    throw new ApiError(400, 'Die E-Mail-Adresse der Lehrperson ist deaktiviert.');
  }
  const next = `/klasse/${ev.id}`;
  // Nur der neueste Link ist gültig.
  await revokeLinkTokens(teacher.id, 'teacher', next);
  const link = await issueLinkToken(teacher.id, {
    purpose: 'teacher',
    next,
    ttlMs: TEACHER_LINK_TTL_MS,
  });
  await sendTeacherLinkEmail(reg.teacher_email, {
    ...classMailInfo(ev),
    teacherName: reg.teacher_name,
    link,
    teacherEntersEmails: reg.teacher_enters_emails,
    parentLinkEnabled: reg.parent_link_enabled,
    consentRequired: reg.consent_required,
  });
  await patchRegistration(ev.id, { teacher_email_id: teacher.id, teacher_link_sent_at: nowIso() });
  await audit('registration.teacher_link', `${ev.id} -> ${reg.teacher_email}`);
}

// ---------------------------------------------------------------------------
// Klassenlink (Selbstregistrierung der Eltern)
// ---------------------------------------------------------------------------

export async function rotateParentLink(ev: RegistrationEvent, actor: string): Promise<string> {
  const reg = registrationOf(ev);
  if (!reg) throw new ApiError(400, 'Dieser Auftrag hat keine Klassenerfassung.');
  const token = randomToken(24);
  await patchRegistration(ev.id, { parent_link_token: token, parent_link_enabled: true });
  await audit('registration.parent_link.rotate', ev.id, actor);
  return token;
}

export async function findEventByParentToken(token: string): Promise<RegistrationEvent | null> {
  if (!token || token.length < 16) return null;
  const ev = await firstOf<RegistrationEvent>(
    col(COL.events).where('registration.parent_link_token', '==', token),
  );
  if (!ev || !ev.registration?.parent_link_enabled) return null;
  return ev;
}

export async function qrCodeSvg(url: string): Promise<string> {
  return QRCode.toString(url, { type: 'svg', margin: 1, width: 220, errorCorrectionLevel: 'M' });
}

// ---------------------------------------------------------------------------
// Klassenliste (Roster)
// ---------------------------------------------------------------------------

export interface RosterParent {
  id: string;
  /** Vollständig oder maskiert („an…@gmail.com“), je nach Einsichtsrecht. */
  email: string;
  masked: boolean;
  name: string;
  status: string;
  verified: boolean;
  invited_at: string | null;
  delivery_problem: { status: string; subject: string; reason: string | null; at: string } | null;
  decision: ConsentDecision | null;
  decided_at: string | null;
}

export interface RosterChild {
  id: string;
  name: string;
  source: string;
  needs_review: boolean;
  consent: ConsentDecision | null;
  conflict: boolean;
  consent_updated_at: string | null;
  parents: RosterParent[];
  /** answered = Antwort liegt vor · invited = E-Mail-Adresse bekannt, keine Antwort · no_email = keine E-Mail-Adresse */
  state: 'answered' | 'invited' | 'no_email';
}

export interface RosterStats {
  children: number;
  answered: number;
  all: number;
  group_only: number;
  individual_only: number;
  none: number;
  invited_pending: number;
  no_email: number;
  conflicts: number;
  needs_review: number;
  parents: number;
  parents_verified: number;
}

export interface Roster {
  children: RosterChild[];
  stats: RosterStats;
}

export async function rosterForEvent(
  ev: RegistrationEvent,
  opts: { showEmails: boolean },
): Promise<Roster> {
  const children = await runQuery<ChildDoc>(col(COL.children).where('event_id', '==', ev.id));
  children.sort((a, b) => String(a.name).localeCompare(String(b.name), 'de'));
  const childIds = children.map((c) => c.id);

  const links: { email_id: string; child_id: string }[] = [];
  for (const part of chunk(childIds)) {
    if (part.length === 0) continue;
    links.push(
      ...(await runQuery<{ email_id: string; child_id: string }>(
        col(COL.emailChildren).where('child_id', 'in', part),
      )),
    );
  }
  const [emails, consents, invited] = await Promise.all([
    getManyById<ParentEmailDoc>(COL.parentEmails, links.map((l) => l.email_id)),
    runQuery<ConsentDoc>(col(COL.consents).where('event_id', '==', ev.id)),
    invitationsSentForEvent(ev.id),
  ]);
  const activeConsents = consents.filter((c) => Number(c.superseded) !== 1);
  const consentByChildEmail = new Map<string, ConsentDoc>();
  for (const c of activeConsents) consentByChildEmail.set(linkId(c.child_id, c.email_id), c);

  const stats: RosterStats = {
    children: children.length,
    answered: 0,
    all: 0,
    group_only: 0,
    individual_only: 0,
    none: 0,
    invited_pending: 0,
    no_email: 0,
    conflicts: 0,
    needs_review: 0,
    parents: 0,
    parents_verified: 0,
  };
  const seenParents = new Set<string>();

  const rows: RosterChild[] = children.map((c) => {
    const parents: RosterParent[] = links
      .filter((l) => l.child_id === c.id)
      .map((l): RosterParent | null => {
        const e = emails.get(l.email_id);
        if (!e || e.status === 'disabled') return null;
        if (!seenParents.has(e.id)) {
          seenParents.add(e.id);
          stats.parents += 1;
          if (e.status === 'verified') stats.parents_verified += 1;
        }
        const own = consentByChildEmail.get(linkId(c.id, e.id));
        return {
          id: e.id,
          email: opts.showEmails ? e.email : maskEmail(e.email),
          masked: !opts.showEmails,
          name: opts.showEmails ? e.name ?? '' : '',
          status: e.status,
          verified: e.status === 'verified',
          invited_at: invited.get(e.id) ?? null,
          delivery_problem: e.delivery_problem
            ? {
                status: String(e.delivery_problem.status),
                subject: e.delivery_problem.subject ?? '',
                reason: e.delivery_problem.reason ?? null,
                at: e.delivery_problem.at,
              }
            : null,
          decision: own?.decision ?? null,
          decided_at: own?.given_at ?? null,
        };
      })
      .filter((p): p is RosterParent => p !== null)
      .sort((a, b) => a.email.localeCompare(b.email));

    const consent = c.consent_status ?? null;
    const conflict = Number(c.consent_conflict) === 1;
    const needsReview = Number(c.needs_review) === 1;
    const state: RosterChild['state'] = consent ? 'answered' : parents.length > 0 ? 'invited' : 'no_email';
    if (consent) {
      stats.answered += 1;
      stats[consent] += 1;
    } else if (state === 'invited') stats.invited_pending += 1;
    else stats.no_email += 1;
    if (conflict) stats.conflicts += 1;
    if (needsReview) stats.needs_review += 1;

    return {
      id: c.id,
      name: c.name,
      source: c.source ?? 'admin',
      needs_review: needsReview,
      consent,
      conflict,
      consent_updated_at: c.consent_updated_at ?? null,
      parents,
      state,
    };
  });

  return { children: rows, stats };
}

// ---------------------------------------------------------------------------
// Kinder
// ---------------------------------------------------------------------------

/** Ergänzt „ae/oe/ue“-Schreibweisen, damit „Mueller“ und „Müller“ zusammenfinden. */
function foldTokens(name: string): string[] {
  return nameTokens(name).map((t) => t.replace(/ae/g, 'a').replace(/oe/g, 'o').replace(/ue/g, 'u'));
}

async function childrenOf(eventId: string): Promise<(ChildDoc & { id: string })[]> {
  return runQuery<ChildDoc>(col(COL.children).where('event_id', '==', eventId));
}

async function createChild(
  eventId: string,
  name: string,
  source: 'admin' | 'teacher' | 'parent',
  needsReview: boolean,
): Promise<string> {
  const id = newId('chd');
  await setById(COL.children, id, {
    event_id: eventId,
    name: name.trim(),
    note: '',
    source,
    needs_review: needsReview ? 1 : 0,
    consent_status: null,
    consent_conflict: 0,
    consent_updated_at: null,
    created_at: nowIso(),
  });
  return id;
}

/** Trägt Kindernamen ein (ein Name pro Eintrag); bereits vorhandene werden übersprungen. */
export async function addChildrenByNames(
  ev: RegistrationEvent,
  names: string[],
  source: 'admin' | 'teacher',
  actor: string,
): Promise<{ created: string[]; existing: string[] }> {
  const existingChildren = await childrenOf(ev.id);
  const known = new Map(existingChildren.map((c) => [normalizeName(c.name), c.name]));
  const created: string[] = [];
  const existing: string[] = [];
  for (const raw of names) {
    const name = String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
    if (!name) continue;
    const key = normalizeName(name);
    if (known.has(key)) {
      existing.push(name);
      continue;
    }
    if (known.size + created.length >= MAX_CHILDREN_PER_CLASS) {
      throw new ApiError(400, `Eine Klasse kann höchstens ${MAX_CHILDREN_PER_CLASS} Kinder enthalten.`);
    }
    await createChild(ev.id, name, source, false);
    known.set(key, name);
    created.push(name);
  }
  if (created.length > 0) {
    await audit('registration.children.add', `${ev.id}: ${created.length} Kind(er)`, actor);
  }
  return { created, existing };
}

/**
 * Sucht das Kind zu einem von den Eltern getippten Namen. Reihenfolge:
 *  1. gleicher Name (normalisiert),
 *  2. alle getippten Namensteile kommen in genau EINEM Kind vor („Lena“ → „Lena Müller“),
 *  3. alle Namensteile des Kindes kommen im getippten Namen vor („Lena M.“ ← „Lena Müller“).
 * Mehrdeutige Treffer liefern null – das Kind wird dann als „von Eltern ergänzt“
 * angelegt und von der Lehrperson zusammengeführt.
 */
export function matchChildByTypedName<T extends { id: string; name: string }>(
  typed: string,
  children: T[],
): T | null {
  const key = normalizeName(typed);
  if (!key) return null;
  const exact = children.filter((c) => normalizeName(c.name) === key);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;
  const typedTokens = foldTokens(typed);
  if (typedTokens.length === 0) return null;
  const subset = (a: string[], b: string[]) => a.every((t) => b.includes(t));
  const containing = children.filter((c) => subset(typedTokens, foldTokens(c.name)));
  if (containing.length === 1) return containing[0];
  if (containing.length > 1) return null;
  const contained = children.filter((c) => {
    const ct = foldTokens(c.name);
    return ct.length > 0 && subset(ct, typedTokens);
  });
  return contained.length === 1 ? contained[0] : null;
}

export async function renameChild(ev: RegistrationEvent, childId: string, name: string, actor: string) {
  const child = await getById<ChildDoc>(COL.children, childId);
  if (!child || child.event_id !== ev.id) throw new ApiError(404, 'Kind nicht gefunden.');
  const clean = name.replace(/\s+/g, ' ').trim().slice(0, 200);
  if (!clean) throw new ApiError(400, 'Bitte einen Namen eingeben.');
  await updateById(COL.children, childId, { name: clean });
  await audit('registration.child.rename', `${childId}: ${child.name} -> ${clean}`, actor);
}

/** Bestätigt einen von Eltern ergänzten Eintrag als richtiges Kind der Klasse. */
export async function confirmChild(ev: RegistrationEvent, childId: string, actor: string) {
  const child = await getById<ChildDoc>(COL.children, childId);
  if (!child || child.event_id !== ev.id) throw new ApiError(404, 'Kind nicht gefunden.');
  await updateById(COL.children, childId, { needs_review: 0 });
  await audit('registration.child.confirm', childId, actor);
}

/**
 * Führt einen (meist von Eltern ergänzten) Doppel-Eintrag mit dem richtigen
 * Kind zusammen: Verknüpfungen und Entscheidungen wandern, der Doppel-Eintrag
 * verschwindet, die Einverständnis-Zusammenfassung wird neu berechnet.
 */
export async function mergeChildren(
  ev: RegistrationEvent,
  sourceId: string,
  targetId: string,
  actor: string,
): Promise<void> {
  if (sourceId === targetId) throw new ApiError(400, 'Bitte ein anderes Kind als Ziel wählen.');
  const [source, target] = await Promise.all([
    getById<ChildDoc>(COL.children, sourceId),
    getById<ChildDoc>(COL.children, targetId),
  ]);
  if (!source || source.event_id !== ev.id || !target || target.event_id !== ev.id) {
    throw new ApiError(404, 'Kind nicht gefunden.');
  }
  const links = await runQuery<{ email_id: string; child_id: string }>(
    col(COL.emailChildren).where('child_id', '==', sourceId),
  );
  for (const l of links) {
    const id = linkId(l.email_id, targetId);
    if (!(await getById(COL.emailChildren, id))) {
      await setById(COL.emailChildren, id, { email_id: l.email_id, child_id: targetId, created_at: nowIso() });
    }
    await deleteById(COL.emailChildren, l.id);
  }
  const consents = await runQuery<ConsentDoc>(col(COL.consents).where('child_id', '==', sourceId));
  for (const c of consents) {
    // Gibt es für dieselbe E-Mail-Adresse schon eine Antwort beim Zielkind, gilt die neuere.
    if (Number(c.superseded) !== 1) {
      const existing = await runQuery<ConsentDoc>(
        col(COL.consents).where('child_id', '==', targetId).where('email_id', '==', c.email_id),
      );
      for (const e of existing) {
        if (Number(e.superseded) === 1) continue;
        if (e.given_at > c.given_at) {
          await updateById(COL.consents, c.id, { child_id: targetId, superseded: 1 });
        } else {
          await updateById(COL.consents, e.id, { superseded: 1 });
        }
      }
    }
    await updateById(COL.consents, c.id, { child_id: targetId });
  }
  // Fotos, die am Doppel-Eintrag hängen (unwahrscheinlich, aber möglich), umhängen.
  const photos = await runQuery<{ child_id: string }>(col(COL.photos).where('child_id', '==', sourceId));
  await Promise.all(photos.map((p) => updateById(COL.photos, p.id, { child_id: targetId })));
  await deleteById(COL.children, sourceId);
  await recomputeChildConsent(targetId);
  await audit('registration.child.merge', `${sourceId} -> ${targetId}`, actor);
}

/** Entfernt ein Kind der Erfassung, solange noch keine Antwort dazu vorliegt. */
export async function removeChild(ev: RegistrationEvent, childId: string, actor: string): Promise<void> {
  const child = await getById<ChildDoc>(COL.children, childId);
  if (!child || child.event_id !== ev.id) throw new ApiError(404, 'Kind nicht gefunden.');
  const consents = await runQuery<ConsentDoc>(col(COL.consents).where('child_id', '==', childId));
  if (consents.length > 0) {
    throw new ApiError(
      409,
      'Für dieses Kind liegt bereits eine Antwort der Eltern vor. Bitte den Eintrag stattdessen zusammenführen oder den Fotografen kontaktieren.',
    );
  }
  await deleteWhere(col(COL.emailChildren).where('child_id', '==', childId));
  await deleteById(COL.children, childId);
  await audit('registration.child.remove', `${childId}: ${child.name}`, actor);
}

// ---------------------------------------------------------------------------
// Eltern einladen (E-Mail-Adresse erfasst durch Lehrperson oder Fotograf)
// ---------------------------------------------------------------------------

export interface InviteEntry {
  childName: string;
  emails: string[];
  parentName: string;
}

export interface InviteResult {
  childrenCreated: number;
  childrenExisting: number;
  emailsCreated: number;
  linksCreated: number;
  sent: number;
  failed: string[];
  invalid: string[];
}

async function sendConsentInvitationTo(
  ev: RegistrationEvent,
  emailId: string,
  email: string,
  childNames: string[],
  reminder: boolean,
): Promise<void> {
  const reg = registrationOf(ev);
  // Nur die neueste Einladung ist einlösbar.
  await revokeLinkTokens(emailId, 'invite', '/einverstaendnis');
  const link = await issueLinkToken(emailId, {
    purpose: 'invite',
    next: '/einverstaendnis',
    ttlMs: INVITE_LINK_TTL_MS,
  });
  await sendConsentInviteEmail(email, {
    ...classMailInfo(ev),
    childNames,
    link,
    reminder,
    consentRequired: reg?.consent_required ?? true,
  });
  await recordInvitationsSent(ev.id, [emailId]);
}

export async function inviteParents(
  ev: RegistrationEvent,
  entries: InviteEntry[],
  source: 'admin' | 'teacher',
  actor: string,
): Promise<InviteResult> {
  const result: InviteResult = {
    childrenCreated: 0,
    childrenExisting: 0,
    emailsCreated: 0,
    linksCreated: 0,
    sent: 0,
    failed: [],
    invalid: [],
  };
  const existingChildren = await childrenOf(ev.id);
  const childByKey = new Map(existingChildren.map((c) => [normalizeName(c.name), c.id]));
  // emailId -> { email, childNames }
  const perEmail = new Map<string, { email: string; childNames: string[] }>();

  for (const entry of entries) {
    const childName = String(entry.childName ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
    if (!childName) continue;
    const key = normalizeName(childName);
    let childId = childByKey.get(key);
    if (childId) {
      result.childrenExisting += 1;
    } else {
      if (childByKey.size >= MAX_CHILDREN_PER_CLASS) {
        throw new ApiError(400, `Eine Klasse kann höchstens ${MAX_CHILDREN_PER_CLASS} Kinder enthalten.`);
      }
      childId = await createChild(ev.id, childName, source, false);
      childByKey.set(key, childId);
      result.childrenCreated += 1;
    }
    for (const raw of entry.emails) {
      const email = normalizeEmail(String(raw ?? ''));
      if (!email) continue;
      if (!EMAIL_RE.test(email)) {
        if (!result.invalid.includes(email)) result.invalid.push(email);
        continue;
      }
      const row = await upsertParentEmail(email, String(entry.parentName ?? '').trim().slice(0, 200));
      if (row.created) result.emailsCreated += 1;
      if (row.disabled) continue;
      const id = linkId(row.id, childId);
      if (!(await getById(COL.emailChildren, id))) {
        await setById(COL.emailChildren, id, { email_id: row.id, child_id: childId, created_at: nowIso() });
        result.linksCreated += 1;
      }
      const bucket = perEmail.get(row.id) ?? { email, childNames: [] };
      if (!bucket.childNames.includes(childName)) bucket.childNames.push(childName);
      perEmail.set(row.id, bucket);
    }
  }

  for (const [emailId, info] of perEmail) {
    try {
      await sendConsentInvitationTo(ev, emailId, info.email, info.childNames, false);
      result.sent += 1;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[registration] invitation failed', info.email, err);
      result.failed.push(info.email);
    }
  }
  await audit(
    'registration.invite',
    `${ev.id}: ${result.sent} Einladung(en), ${result.childrenCreated} neue Kinder, ${result.failed.length} fehlgeschlagen`,
    actor,
  );
  return result;
}

// ---------------------------------------------------------------------------
// Selbstregistrierung über den Klassenlink
// ---------------------------------------------------------------------------

export interface SelfRegistrationInput {
  email: string;
  childName: string;
  parentName: string;
}

/**
 * Schritt 1 der Selbstregistrierung. Hat die Person bereits eine bestätigte
 * Sitzung mit derselben E-Mail-Adresse, wird das Kind sofort eingetragen; sonst geht
 * eine Bestätigungs-Mail raus und erst der Klick trägt das Kind ein. Die
 * Antwort ist in beiden Fällen neutral (kein Rückschluss auf bestehende E-Mail-Adressen).
 */
export async function startSelfRegistration(
  ev: RegistrationEvent,
  input: SelfRegistrationInput,
  session: { emailId: string; email: string } | null,
): Promise<{ direct: boolean }> {
  if (!registrationOpen(ev)) throw new ApiError(410, 'Die Erfassung für diese Klasse ist abgeschlossen.');
  const email = normalizeEmail(input.email);
  const childName = input.childName.replace(/\s+/g, ' ').trim().slice(0, 200);
  const parentName = input.parentName.replace(/\s+/g, ' ').trim().slice(0, 200);
  if (!EMAIL_RE.test(email)) throw new ApiError(400, 'Bitte geben Sie eine gültige E-Mail-Adresse ein.');
  if (!childName) throw new ApiError(400, 'Bitte geben Sie den Namen Ihres Kindes ein.');

  const payload: RegistrationPayload = { event_id: ev.id, child_name: childName, parent_name: parentName };

  if (session && session.email === email) {
    await materializeRegistration(session.emailId, payload);
    return { direct: true };
  }

  const row = await upsertParentEmail(email, parentName);
  if (row.disabled) return { direct: false };
  const link = await issueLinkToken(row.id, {
    purpose: 'register',
    next: '/einverstaendnis',
    ttlMs: REGISTER_LINK_TTL_MS,
    registration: payload,
  });
  try {
    await sendRegistrationVerifyEmail(email, {
      ...classMailInfo(ev),
      childName,
      link,
      consentRequired: registrationOf(ev)?.consent_required ?? true,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[registration] verification e-mail failed', err);
  }
  return { direct: false };
}

/**
 * Schritt 2: Nach bestätigter E-Mail-Adresse das Kind in die Klassenliste eintragen
 * (bzw. mit dem Eintrag der Lehrperson verknüpfen). Läuft die Erfassung nicht
 * mehr, passiert nichts.
 */
export async function materializeRegistration(
  emailId: string,
  payload: RegistrationPayload,
): Promise<{ eventId: string; childId: string; matched: boolean } | null> {
  const ev = await getById<RegistrationEvent>(COL.events, payload.event_id);
  if (!ev || !registrationOpen(ev)) return null;
  const children = await childrenOf(ev.id);
  const match = matchChildByTypedName(payload.child_name, children);
  let childId: string;
  if (match) {
    childId = match.id;
  } else {
    if (children.length >= MAX_CHILDREN_PER_CLASS) return null;
    childId = await createChild(ev.id, payload.child_name, 'parent', true);
  }
  const id = linkId(emailId, childId);
  if (!(await getById(COL.emailChildren, id))) {
    await setById(COL.emailChildren, id, { email_id: emailId, child_id: childId, created_at: nowIso() });
  }
  if (payload.parent_name) {
    const row = await getById<ParentEmailDoc>(COL.parentEmails, emailId);
    if (row && !row.name) await updateById(COL.parentEmails, emailId, { name: payload.parent_name, updated_at: nowIso() });
  }
  const row = await getById<ParentEmailDoc>(COL.parentEmails, emailId);
  await audit(
    'registration.parent.join',
    `${ev.id}: ${payload.child_name}${match ? ` -> ${match.name}` : ' (neu, von Eltern ergänzt)'}`,
    row?.email ?? emailId,
  );
  return { eventId: ev.id, childId, matched: !!match };
}

/** Weiteres Kind derselben Klasse durch bereits angemeldete Eltern. */
export async function addOwnChild(
  ev: RegistrationEvent,
  session: { emailId: string; email: string },
  childName: string,
): Promise<{ childId: string; matched: boolean }> {
  if (!registrationOpen(ev)) throw new ApiError(410, 'Die Erfassung für diese Klasse ist abgeschlossen.');
  const name = childName.replace(/\s+/g, ' ').trim().slice(0, 200);
  if (!name) throw new ApiError(400, 'Bitte geben Sie den Namen Ihres Kindes ein.');
  const result = await materializeRegistration(session.emailId, {
    event_id: ev.id,
    child_name: name,
    parent_name: '',
  });
  if (!result) throw new ApiError(400, 'Das Kind konnte nicht eingetragen werden.');
  return { childId: result.childId, matched: result.matched };
}

/** Zweite E-Mail-Adresse der Eltern (z. B. anderer Elternteil) für ein eigenes Kind. */
export async function addSecondParent(
  ev: RegistrationEvent,
  session: { emailId: string; email: string },
  childId: string,
  email: string,
): Promise<{ sent: boolean }> {
  if (!registrationOpen(ev)) throw new ApiError(410, 'Die Erfassung für diese Klasse ist abgeschlossen.');
  const normalized = normalizeEmail(email);
  if (!EMAIL_RE.test(normalized)) throw new ApiError(400, 'Bitte geben Sie eine gültige E-Mail-Adresse ein.');
  if (normalized === session.email) throw new ApiError(400, 'Das ist bereits Ihre eigene E-Mail-Adresse.');
  const own = await getById(COL.emailChildren, linkId(session.emailId, childId));
  const child = await getById<ChildDoc>(COL.children, childId);
  if (!own || !child || child.event_id !== ev.id) throw new ApiError(404, 'Kind nicht gefunden.');
  const row = await upsertParentEmail(normalized, '');
  if (row.disabled) return { sent: false };
  const id = linkId(row.id, childId);
  if (!(await getById(COL.emailChildren, id))) {
    await setById(COL.emailChildren, id, { email_id: row.id, child_id: childId, created_at: nowIso() });
  }
  let sent = false;
  try {
    await sendConsentInvitationTo(ev, row.id, normalized, [child.name], false);
    sent = true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[registration] second parent invitation failed', err);
  }
  await audit('registration.parent.add_second', `${ev.id}: ${childId} <- ${normalized}`, session.email);
  return { sent };
}

// ---------------------------------------------------------------------------
// Einverständnis
// ---------------------------------------------------------------------------

export interface ConsentRequestChild {
  id: string;
  name: string;
  decision: ConsentDecision | null;
  decidedAt: string | null;
  /** Ein anderer Elternteil hat bereits geantwortet (ohne dessen E-Mail-Adresse zu zeigen). */
  othersAnswered: boolean;
  needsReview: boolean;
}

export interface ConsentRequestView {
  eventId: string;
  className: string;
  school: string;
  shootingDate: string;
  deadline: string;
  open: boolean;
  consentRequired: boolean;
  text: string;
  textHash: string;
  children: ConsentRequestChild[];
}

/** Alle Klassen, in denen diese E-Mail-Adresse ein Kind eingetragen hat, mit eigenem Stand. */
export async function consentRequestsForEmail(emailId: string): Promise<ConsentRequestView[]> {
  const links = await runQuery<{ email_id: string; child_id: string }>(
    col(COL.emailChildren).where('email_id', '==', emailId),
  );
  if (links.length === 0) return [];
  const children = await getManyById<ChildDoc>(COL.children, links.map((l) => l.child_id));
  const eventIds = [...new Set([...children.values()].map((c) => c.event_id))];
  const events = await getManyById<RegistrationEvent>(COL.events, eventIds);
  const relevant = [...events.values()].filter((ev) => !!ev.registration && ev.status !== 'archived');
  if (relevant.length === 0) return [];

  const ownConsents = (
    await runQuery<ConsentDoc>(col(COL.consents).where('email_id', '==', emailId))
  ).filter((c) => Number(c.superseded) !== 1);
  const ownByChild = new Map(ownConsents.map((c) => [c.child_id, c]));

  const othersByChild = new Set<string>();
  for (const ev of relevant) {
    const all = await runQuery<ConsentDoc>(col(COL.consents).where('event_id', '==', ev.id));
    for (const c of all) {
      if (Number(c.superseded) === 1 || c.email_id === emailId) continue;
      othersByChild.add(c.child_id);
    }
  }

  const settings = await getAppSettings();
  const textHash = consentTextHash(settings.consent_text);

  const out: ConsentRequestView[] = [];
  for (const ev of relevant.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))) {
    const reg = ev.registration!;
    const kids = [...children.values()]
      .filter((c) => c.event_id === ev.id)
      .sort((a, b) => a.name.localeCompare(b.name, 'de'))
      .map((c) => {
        const own = ownByChild.get(c.id);
        return {
          id: c.id,
          name: c.name,
          decision: own?.decision ?? null,
          decidedAt: own?.given_at ?? null,
          othersAnswered: othersByChild.has(c.id),
          needsReview: Number(c.needs_review) === 1,
        };
      });
    // Abgeschlossene Erfassungen nur zeigen, wenn hier schon geantwortet wurde.
    const open = registrationOpen(ev);
    if (!open && !kids.some((k) => k.decision)) continue;
    out.push({
      eventId: ev.id,
      className: ev.name,
      school: reg.school,
      shootingDate: formatDateDe(reg.shooting_date),
      deadline: formatDateDe(reg.deadline),
      open,
      consentRequired: reg.consent_required,
      text: renderConsentText(settings.consent_text, {
        klasse: ev.name,
        schule: reg.school,
        datum: formatDateDe(reg.shooting_date),
      }),
      textHash,
      children: kids,
    });
  }
  return out;
}

/** Anzahl eigener Kinder in laufenden Erfassungen, für die noch keine Antwort vorliegt. */
export async function pendingConsentCountForEmail(emailId: string): Promise<number> {
  const requests = await consentRequestsForEmail(emailId);
  let n = 0;
  for (const r of requests) {
    if (!r.open || !r.consentRequired) continue;
    n += r.children.filter((c) => !c.decision).length;
  }
  return n;
}

export async function recomputeChildConsent(childId: string): Promise<void> {
  const consents = (await runQuery<ConsentDoc>(col(COL.consents).where('child_id', '==', childId))).filter(
    (c) => Number(c.superseded) !== 1,
  );
  const { effective, conflict } = combineDecisions(consents.map((c) => c.decision));
  const latest = consents.map((c) => c.given_at).sort().pop() ?? null;
  await updateById(COL.children, childId, {
    consent_status: effective,
    consent_conflict: conflict ? 1 : 0,
    consent_updated_at: latest,
  });
}

export interface RecordConsentMeta {
  parentName: string;
  ip: string;
  userAgent: string;
}

export async function recordConsent(
  ev: RegistrationEvent,
  session: { emailId: string; email: string },
  childId: string,
  decision: ConsentDecision,
  meta: RecordConsentMeta,
): Promise<void> {
  const reg = registrationOf(ev);
  if (!reg || !reg.consent_required) throw new ApiError(400, 'Für diese Klasse wird kein Einverständnis abgefragt.');
  if (!registrationOpen(ev)) {
    throw new ApiError(410, 'Die Erfassung ist abgeschlossen. Änderungen bitte über „Hilfe & Kontakt“ melden.');
  }
  const child = await getById<ChildDoc>(COL.children, childId);
  if (!child || child.event_id !== ev.id) throw new ApiError(404, 'Kind nicht gefunden.');
  const link = await getById(COL.emailChildren, linkId(session.emailId, childId));
  if (!link) throw new ApiError(403, 'Dieses Kind ist nicht mit Ihrer E-Mail-Adresse verknüpft.');

  const settings = await getAppSettings();
  const textHash = await storeConsentText(settings.consent_text);

  const previous = await runQuery<ConsentDoc>(
    col(COL.consents).where('child_id', '==', childId).where('email_id', '==', session.emailId),
  );
  await Promise.all(
    previous
      .filter((c) => Number(c.superseded) !== 1)
      .map((c) => updateById(COL.consents, c.id, { superseded: 1 })),
  );
  const parentName = meta.parentName.replace(/\s+/g, ' ').trim().slice(0, 200);
  await setById(COL.consents, newId('cns'), {
    event_id: ev.id,
    child_id: childId,
    email_id: session.emailId,
    email: session.email,
    decision,
    parent_name: parentName,
    text_hash: textHash,
    given_at: nowIso(),
    ip: meta.ip.slice(0, 64),
    user_agent: meta.userAgent.slice(0, 255),
    superseded: 0,
  } satisfies ConsentDoc);
  if (parentName) {
    const row = await getById<ParentEmailDoc>(COL.parentEmails, session.emailId);
    if (row && !row.name) await updateById(COL.parentEmails, session.emailId, { name: parentName, updated_at: nowIso() });
  }
  await recomputeChildConsent(childId);
  await audit('consent.record', `${ev.id}: ${childId} = ${decision}`, session.email);
  try {
    await sendConsentConfirmationEmail(session.email, {
      ...classMailInfo(ev),
      childName: child.name,
      decisionLabel: CONSENT_LABELS[decision],
      link: `${config.publicAppUrl}/einverstaendnis`,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[registration] consent confirmation e-mail failed', err);
  }
}

// ---------------------------------------------------------------------------
// Erinnerungen
// ---------------------------------------------------------------------------

export interface RemindResult {
  sent: number;
  failed: string[];
  /** Kinder ohne bekannte E-Mail-Adresse – die kann die App nicht erinnern. */
  withoutEmail: number;
}

/**
 * Erinnert alle Eltern, deren Kind noch keine Antwort hat und deren E-Mail-Adresse
 * bekannt ist. `throttleMs` verhindert, dass die Lehrperson die Eltern mehrmals
 * am Tag anschreibt; der Fotograf und die automatische Erinnerung sind frei.
 */
export async function remindPendingConsents(
  ev: RegistrationEvent,
  opts: { actor: string; auto: boolean; throttleMs?: number },
): Promise<RemindResult> {
  const reg = registrationOf(ev);
  if (!reg) throw new ApiError(400, 'Dieser Auftrag hat keine Klassenerfassung.');
  if (!reg.consent_required) throw new ApiError(400, 'Für diese Klasse wird kein Einverständnis abgefragt.');
  if (!registrationOpen(ev)) throw new ApiError(410, 'Die Erfassung ist abgeschlossen.');
  if (opts.throttleMs && reg.last_reminder_at) {
    const since = Date.now() - new Date(reg.last_reminder_at).getTime();
    if (since < opts.throttleMs) {
      const hours = Math.ceil((opts.throttleMs - since) / (60 * 60 * 1000));
      throw new ApiError(
        429,
        `Eine Erinnerung wurde vor Kurzem verschickt. Die nächste ist in ${hours} Stunde(n) möglich.`,
      );
    }
  }
  const roster = await rosterForEvent(ev, { showEmails: true });
  const perEmail = new Map<string, { email: string; childNames: string[] }>();
  let withoutEmail = 0;
  for (const child of roster.children) {
    if (child.consent) continue;
    if (child.parents.length === 0) {
      withoutEmail += 1;
      continue;
    }
    for (const p of child.parents) {
      if (p.decision) continue; // dieser Elternteil hat geantwortet, der andere nicht → nur den anderen erinnern
      const bucket = perEmail.get(p.id) ?? { email: p.email, childNames: [] };
      bucket.childNames.push(child.name);
      perEmail.set(p.id, bucket);
    }
  }
  const result: RemindResult = { sent: 0, failed: [], withoutEmail };
  for (const [emailId, info] of perEmail) {
    try {
      await sendConsentInvitationTo(ev, emailId, info.email, info.childNames, true);
      result.sent += 1;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[registration] reminder failed', info.email, err);
      result.failed.push(info.email);
    }
  }
  await patchRegistration(ev.id, {
    last_reminder_at: nowIso(),
    ...(opts.auto ? { auto_consent_reminder_sent_at: nowIso() } : {}),
  });
  if (result.sent > 0) {
    await setById(COL.reminders, newId('rem'), {
      event_id: ev.id,
      sent_at: nowIso(),
      note: `${opts.auto ? 'Automatische Erinnerung' : 'Erinnerung'} Einverständnis an ${result.sent} E-Mail-Adresse(n)`,
      created_at: nowIso(),
    });
  }
  await audit(
    'registration.remind',
    `${ev.id}: ${result.sent} sent, ${result.failed.length} failed${opts.auto ? ' (auto)' : ''}`,
    opts.actor,
  );
  return result;
}

// ---------------------------------------------------------------------------
// Abschluss und Übernahme
// ---------------------------------------------------------------------------

/** Lehrperson meldet die Erfassung als vollständig; die Admins erhalten eine Info. */
export async function markTeacherCompleted(ev: RegistrationEvent, teacherEmail: string): Promise<void> {
  const reg = registrationOf(ev);
  if (!reg) throw new ApiError(400, 'Dieser Auftrag hat keine Klassenerfassung.');
  await patchRegistration(ev.id, { teacher_completed_at: nowIso() });
  await audit('registration.teacher_completed', ev.id, teacherEmail);
  try {
    const recipients = await allAdminEmails();
    if (recipients.length === 0) return;
    const roster = await rosterForEvent(ev, { showEmails: true });
    await sendRegistrationCompletedEmail(recipients, {
      className: ev.name,
      school: reg.school,
      teacherName: reg.teacher_name,
      teacherEmail,
      children: roster.stats.children,
      answered: roster.stats.answered,
      pending: roster.stats.invited_pending + roster.stats.no_email,
      declined: roster.stats.none,
      adminLink: `${config.publicAppUrl}/admin/events/${ev.id}/erfassung`,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[registration] completion notification failed', err);
  }
}

/**
 * „In Auftrag übernehmen“: schliesst die Erfassung (Klassenlink und Formular
 * sind danach zu) und setzt den Status auf Entwurf, damit es im Assistenten
 * mit den Fotos weitergeht. Kinder, E-Mail-Adressen und Verknüpfungen bleiben.
 */
export async function closeRegistration(ev: RegistrationEvent, actor: string): Promise<void> {
  const reg = registrationOf(ev);
  if (!reg) throw new ApiError(400, 'Dieser Auftrag hat keine Klassenerfassung.');
  await updateById(COL.events, ev.id, {
    status: 'draft',
    'registration.closed_at': nowIso(),
    updated_at: nowIso(),
  });
  await audit('registration.close', ev.id, actor);
}

/** Erfassung wieder öffnen (z. B. Nachzügler). Nur aus „Entwurf“ heraus. */
export async function reopenRegistration(ev: RegistrationEvent, actor: string): Promise<void> {
  const reg = registrationOf(ev);
  if (!reg) throw new ApiError(400, 'Dieser Auftrag hat keine Klassenerfassung.');
  if (ev.status === 'published') {
    throw new ApiError(400, 'Ein veröffentlichter Auftrag kann nicht erneut in die Erfassung.');
  }
  await updateById(COL.events, ev.id, {
    status: 'collecting',
    'registration.closed_at': null,
    updated_at: nowIso(),
  });
  await audit('registration.reopen', ev.id, actor);
}

/** Alle Klassen, für die diese E-Mail-Adresse als Lehrperson eingetragen ist. */
export async function teacherEventsForEmail(email: string): Promise<RegistrationEvent[]> {
  const normalized = normalizeEmail(email);
  if (!normalized) return [];
  const rows = await runQuery<RegistrationEvent>(
    col(COL.events).where('registration.teacher_email', '==', normalized),
  );
  return rows
    .filter((ev) => ev.status !== 'archived')
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
}

// ---------------------------------------------------------------------------
// Ansichten und Export
// ---------------------------------------------------------------------------

/** Registrierungsdaten ohne den Klassenlink-Token (der kommt separat als URL). */
export function registrationView(ev: RegistrationEvent) {
  const reg = registrationOf(ev);
  if (!reg) return null;
  const { parent_link_token, ...rest } = reg;
  return {
    ...rest,
    parent_link_url: reg.parent_link_enabled && parent_link_token ? parentLinkUrl(parent_link_token) : null,
    open: registrationOpen(ev),
    shooting_date_text: formatDateDe(reg.shooting_date),
    deadline_text: formatDateDe(reg.deadline),
  };
}

/** Verlauf aller Entscheidungen einer Klasse (neueste zuerst), für den Adminbereich. */
export async function consentHistory(ev: RegistrationEvent) {
  const [consents, children] = await Promise.all([
    runQuery<ConsentDoc>(col(COL.consents).where('event_id', '==', ev.id)),
    childrenOf(ev.id),
  ]);
  const childName = new Map(children.map((c) => [c.id, c.name]));
  return consents
    .sort((a, b) => b.given_at.localeCompare(a.given_at))
    .map((c) => ({
      id: c.id,
      child_id: c.child_id,
      child_name: childName.get(c.child_id) ?? '(gelöscht)',
      email: c.email,
      parent_name: c.parent_name,
      decision: c.decision,
      decision_label: CONSENT_SHORT_LABELS[c.decision],
      given_at: c.given_at,
      text_hash: c.text_hash,
      superseded: Number(c.superseded) === 1,
    }));
}

function csvCell(value: string | number | null | undefined): string {
  const s = String(value ?? '');
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Liste für den Fototermin: ein Kind je Zeile mit Antwort und Hinweisen. */
export function rosterCsv(ev: RegistrationEvent, roster: Roster): string {
  const header = ['Kind', 'Antwort', 'Klassenfoto', 'Einzelfotos', 'Eltern', 'Hinweis'];
  const lines = [header.join(';')];
  for (const c of roster.children) {
    const hints: string[] = [];
    if (c.conflict) hints.push('Widerspruch zwischen den Elternteilen');
    if (c.needs_review) hints.push('von Eltern ergänzt, nicht bestätigt');
    if (c.state === 'no_email') hints.push('keine E-Mail-Adresse bekannt');
    lines.push(
      [
        c.name,
        c.consent ? CONSENT_SHORT_LABELS[c.consent] : 'keine Antwort',
        c.consent ? (allowsGroupPhoto(c.consent) ? 'ja' : 'nein') : '?',
        c.consent ? (allowsIndividualPhotos(c.consent) ? 'ja' : 'nein') : '?',
        c.parents.map((p) => p.email).join(', '),
        hints.join('; '),
      ]
        .map(csvCell)
        .join(';'),
    );
  }
  // BOM, damit Excel Umlaute korrekt liest.
  return `﻿${lines.join('\r\n')}\r\n`;
}

/**
 * Textvorschlag für die Eltern (Elternbrief, Klapp, E-Mail), den die Lehrperson
 * kopieren kann. Enthält Klassenlink, Termin und Frist.
 */
export function parentShareText(ev: RegistrationEvent, url: string): string {
  const reg = registrationOf(ev);
  const when = formatDateDe(reg?.shooting_date ?? null);
  const until = formatDateDe(reg?.deadline ?? null);
  const consent = reg?.consent_required ?? true;
  return [
    'Liebe Eltern',
    '',
    `Die Klasse ${ev.name}${reg?.school ? ` (${reg.school})` : ''} wird${when ? ` am ${when}` : ''} fotografiert. Es entstehen ein Klassenfoto und Einzelfotos; die Fotos können Sie anschliessend online ansehen und bei Interesse bestellen.`,
    '',
    `Bitte tragen Sie Ihr Kind${until ? ` bis zum ${until}` : ''} über diesen Link ein${consent ? ' und geben Sie dort Ihr Einverständnis' : ''}:`,
    url,
    '',
    'Sie brauchen dafür nur Ihre E-Mail-Adresse. Über dieselbe E-Mail-Adresse sehen Sie später die Fotos. Es besteht keine Kaufpflicht.',
  ].join('\n');
}

/** Zusammenfassung der Einverständnisse je Auftrag für die Aufträge-Liste. */
export function consentSummary(children: { consent_status?: ConsentDecision | null }[]) {
  const out = { children: children.length, answered: 0, none: 0 };
  for (const c of children) {
    if (c.consent_status) out.answered += 1;
    if (c.consent_status === 'none') out.none += 1;
  }
  return out;
}

export { CONSENT_LABELS, CONSENT_SHORT_LABELS };
export type { ConsentDecision };
