import {
  COL,
  col,
  getById,
  firstOf,
  runQuery,
  setById,
  updateById,
  linkId,
  nowIso,
} from '../db';
import { newId } from '../lib/ids';
import { normalizeName, splitNames } from '../lib/names';
import { retentionExpiry } from './events';

/**
 * Bulk import of parents (e-mail addresses), children and their links from a
 * pasted table or an uploaded CSV/Excel sheet.
 *
 * The frontend turns any input (paste / CSV / XLSX) into a 2-D array of strings
 * (`string[][]`). Everything else – tolerant column detection, building a human
 * readable plan and finally committing it – happens here so there is a single
 * source of truth that can be unit-tested.
 */

export type ImportRole =
  | 'email'
  | 'name'
  | 'first_name'
  | 'last_name'
  | 'child'
  | 'event'
  | 'note'
  | 'ignore';

export type Mapping = Partial<Record<Exclude<ImportRole, 'ignore'>, number>>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Header aliases (normalized) → role. Order matters for ambiguous words. */
const ALIASES: Record<string, Exclude<ImportRole, 'ignore'>> = {};
function alias(role: Exclude<ImportRole, 'ignore'>, words: string[]) {
  for (const w of words) ALIASES[normalizeName(w).replace(/[^a-z0-9]+/g, '')] = role;
}
alias('email', ['email', 'e-mail', 'mail', 'emailadresse', 'e-mail-adresse', 'mailadresse', 'emailaddress', 'adresse']);
alias('first_name', ['vorname', 'first name', 'firstname', 'first', 'rufname']);
alias('last_name', ['nachname', 'last name', 'lastname', 'surname', 'familienname']);
alias('name', ['name', 'elternname', 'eltern', 'parent', 'parent name', 'kontakt', 'kontaktname']);
alias('child', ['kind', 'kinder', 'child', 'children', 'kindname', 'kindername', 'schueler', 'schuelerin', 'schuelername', 'student']);
alias('event', ['event', 'veranstaltung', 'klasse', 'class', 'gruppe', 'group', 'kindergarten', 'schule', 'set', 'fotoset', 'galerie', 'gallery']);
alias('note', ['notiz', 'note', 'bemerkung', 'info', 'kommentar', 'comment', 'hinweis']);

function roleForHeader(header: string): Exclude<ImportRole, 'ignore'> | null {
  const key = normalizeName(header).replace(/[^a-z0-9]+/g, '');
  return ALIASES[key] ?? null;
}

function looksLikeEmail(value: string): boolean {
  return EMAIL_RE.test(String(value ?? '').trim().toLowerCase());
}

export interface DetectedColumn {
  index: number;
  header: string;
  role: ImportRole;
  sample: string;
}

export interface Detection {
  hasHeader: boolean;
  mapping: Mapping;
  columns: DetectedColumn[];
}

/** Builds the per-column description (header, role, sample) for the UI. */
export function describeColumns(
  rows: string[][],
  mapping: Mapping,
  hasHeader: boolean,
): DetectedColumn[] {
  const width = rows.reduce((m, r) => Math.max(m, r.length), 0);
  const first = rows[0] ?? [];
  const columns: DetectedColumn[] = [];
  for (let i = 0; i < width; i += 1) {
    const role = (Object.entries(mapping).find(([, idx]) => idx === i)?.[0] as ImportRole) ?? 'ignore';
    const sampleRow = rows.find((r, ri) => (hasHeader ? ri > 0 : true) && (r[i] ?? '').trim());
    columns.push({
      index: i,
      header: hasHeader ? String(first[i] ?? '').trim() || `Spalte ${i + 1}` : `Spalte ${i + 1}`,
      role,
      sample: String(sampleRow?.[i] ?? '').trim(),
    });
  }
  return columns;
}

/**
 * Detects whether the first row is a header and which column maps to which role.
 * Tolerant to column order and to common German/English header spellings.
 */
export function detectMapping(rows: string[][]): Detection {
  const width = rows.reduce((m, r) => Math.max(m, r.length), 0);
  const first = rows[0] ?? [];

  // A header row is one where at least one cell matches a known alias and no
  // cell already looks like an e-mail address (which would mean it is data).
  const firstHasEmail = first.some(looksLikeEmail);
  const headerMatches = first.filter((c) => roleForHeader(c)).length;
  const hasHeader = !firstHasEmail && headerMatches >= 1;

  const mapping: Mapping = {};

  if (hasHeader) {
    first.forEach((header, index) => {
      const role = roleForHeader(header);
      if (!role) return;
      // "Name" alone means surname when a "Vorname" column exists, else full name.
      if (role === 'name' && first.some((h) => roleForHeader(h) === 'first_name')) {
        if (mapping.last_name === undefined) mapping.last_name = index;
        return;
      }
      if (mapping[role] === undefined) mapping[role] = index;
    });
  } else {
    // No header: infer the e-mail column from content; map remaining columns to
    // child/name as a best-effort default the admin can override in the UI.
    let emailCol = -1;
    let bestHits = 0;
    for (let c = 0; c < width; c += 1) {
      const hits = rows.filter((r) => looksLikeEmail(r[c] ?? '')).length;
      if (hits > bestHits) {
        bestHits = hits;
        emailCol = c;
      }
    }
    if (emailCol >= 0) mapping.email = emailCol;
    const others = Array.from({ length: width }, (_, i) => i).filter((i) => i !== emailCol);
    if (others.length === 1) {
      mapping.child = others[0];
    } else if (others.length >= 2) {
      mapping.first_name = others[0];
      mapping.last_name = others[1];
    }
  }

  return { hasHeader, mapping, columns: describeColumns(rows, mapping, hasHeader) };
}

export interface PlanRow {
  rowIndex: number;
  email: string;
  emailValid: boolean;
  parentName: string;
  childNames: string[];
  eventName: string;
  note: string;
  warnings: string[];
}

export interface ImportPlan {
  rows: PlanRow[];
  totals: {
    rows: number;
    withEmail: number;
    distinctEmails: number;
    children: number;
    skipped: number;
  };
}

function cell(row: string[], idx: number | undefined): string {
  if (idx === undefined) return '';
  return String(row[idx] ?? '').trim();
}

/** Turns raw rows + a column mapping into a normalized, reviewable plan. */
export function buildPlan(rows: string[][], mapping: Mapping, hasHeader: boolean): ImportPlan {
  const dataRows = hasHeader ? rows.slice(1) : rows;
  const planRows: PlanRow[] = [];
  const emailSet = new Set<string>();
  let withEmail = 0;
  let children = 0;
  let skipped = 0;

  dataRows.forEach((row, i) => {
    const warnings: string[] = [];
    const email = cell(row, mapping.email).toLowerCase();
    const first = cell(row, mapping.first_name);
    const last = cell(row, mapping.last_name);
    const fullName = cell(row, mapping.name);
    const childCell = cell(row, mapping.child);
    const eventName = cell(row, mapping.event);
    const note = cell(row, mapping.note);
    const partsName = [first, last].filter(Boolean).join(' ').trim();

    let parentName = '';
    let childNames: string[] = [];
    if (childCell) {
      // Explicit child column → the name columns describe the parent/family.
      childNames = splitNames(childCell);
      parentName = fullName || partsName;
    } else {
      // No child column → the name columns describe the child.
      const childName = fullName || partsName;
      childNames = childName ? [childName] : [];
      parentName = '';
    }

    const emailValid = !!email && EMAIL_RE.test(email);

    if (!email && childNames.length === 0) {
      skipped += 1;
      return; // genuinely empty row
    }

    if (email && !emailValid) warnings.push('Ungültige E-Mail-Adresse – Zeile wird nicht verknüpft.');
    if (!email && childNames.length > 0) warnings.push('Keine E-Mail – Kind wird angelegt, aber nicht verknüpft.');
    if (emailValid && childNames.length === 0) warnings.push('Nur E-Mail – ohne Kind-Verknüpfung.');

    if (emailValid) {
      withEmail += 1;
      emailSet.add(email);
    }
    children += childNames.length;

    planRows.push({
      rowIndex: i,
      email,
      emailValid,
      parentName,
      childNames,
      eventName,
      note,
      warnings,
    });
  });

  return {
    rows: planRows,
    totals: {
      rows: planRows.length,
      withEmail,
      distinctEmails: emailSet.size,
      children,
      skipped,
    },
  };
}

export interface CommitOptions {
  defaultEventId?: string;
  defaultEventName?: string;
  createMissingEvents?: boolean;
}

export interface CommitResult {
  emailsCreated: number;
  emailsExisting: number;
  childrenCreated: number;
  childrenExisting: number;
  linksCreated: number;
  linksExisting: number;
  eventsCreated: number;
  rowsSkipped: number;
  warnings: string[];
}

interface EventLike {
  id: string;
  name: string;
}

async function createEvent(name: string): Promise<string> {
  const id = newId('evt');
  await setById(COL.events, id, {
    name,
    description: '',
    status: 'draft',
    expires_at: retentionExpiry(),
    created_at: nowIso(),
    updated_at: nowIso(),
  });
  return id;
}

/** Executes a previously built plan against Firestore. */
export async function commitImport(
  plan: ImportPlan,
  options: CommitOptions,
): Promise<CommitResult> {
  const result: CommitResult = {
    emailsCreated: 0,
    emailsExisting: 0,
    childrenCreated: 0,
    childrenExisting: 0,
    linksCreated: 0,
    linksExisting: 0,
    eventsCreated: 0,
    rowsSkipped: 0,
    warnings: [],
  };

  // Resolve events by (normalized) name so per-row event columns can be reused.
  const allEvents = await runQuery<EventLike>(col(COL.events));
  const eventByName = new Map<string, string>();
  for (const e of allEvents) eventByName.set(normalizeName(e.name), e.id);

  let defaultEventId = options.defaultEventId || '';
  if (!defaultEventId && options.defaultEventName && options.defaultEventName.trim()) {
    const nm = options.defaultEventName.trim();
    const existing = eventByName.get(normalizeName(nm));
    if (existing) {
      defaultEventId = existing;
    } else {
      defaultEventId = await createEvent(nm);
      eventByName.set(normalizeName(nm), defaultEventId);
      result.eventsCreated += 1;
    }
  }

  const resolveEvent = async (name: string): Promise<string> => {
    if (!name) return defaultEventId;
    const key = normalizeName(name);
    const found = eventByName.get(key);
    if (found) return found;
    if (options.createMissingEvents) {
      const id = await createEvent(name);
      eventByName.set(key, id);
      result.eventsCreated += 1;
      return id;
    }
    return defaultEventId;
  };

  // Caches to keep the number of Firestore reads down.
  const emailCache = new Map<string, string>(); // normalized email -> id
  const childCache = new Map<string, Map<string, string>>(); // eventId -> name -> id

  const loadChildren = async (eventId: string): Promise<Map<string, string>> => {
    let m = childCache.get(eventId);
    if (m) return m;
    m = new Map();
    const kids = await runQuery<{ name: string }>(col(COL.children).where('event_id', '==', eventId));
    for (const k of kids) m.set(normalizeName(k.name), k.id);
    childCache.set(eventId, m);
    return m;
  };

  const upsertEmail = async (email: string, name: string, note: string): Promise<string> => {
    const cached = emailCache.get(email);
    if (cached) return cached;
    const existing = await firstOf<{ name?: string }>(col(COL.parentEmails).where('email', '==', email));
    if (existing) {
      emailCache.set(email, existing.id);
      result.emailsExisting += 1;
      // Fill in a missing name without clobbering existing data.
      if (name && !existing.name) await updateById(COL.parentEmails, existing.id, { name, updated_at: nowIso() });
      return existing.id;
    }
    const id = newId('eml');
    await setById(COL.parentEmails, id, {
      email,
      name: name || '',
      status: 'not_verified',
      verified_at: null,
      note: note || '',
      created_at: nowIso(),
      updated_at: nowIso(),
    });
    emailCache.set(email, id);
    result.emailsCreated += 1;
    return id;
  };

  const upsertChild = async (eventId: string, name: string): Promise<string> => {
    const m = await loadChildren(eventId);
    const key = normalizeName(name);
    const existing = m.get(key);
    if (existing) {
      result.childrenExisting += 1;
      return existing;
    }
    const id = newId('chd');
    await setById(COL.children, id, {
      event_id: eventId,
      name,
      note: '',
      created_at: nowIso(),
    });
    m.set(key, id);
    result.childrenCreated += 1;
    return id;
  };

  const linkEmailChild = async (emailId: string, childId: string): Promise<void> => {
    const id = linkId(emailId, childId);
    const exists = await getById(COL.emailChildren, id);
    if (exists) {
      result.linksExisting += 1;
      return;
    }
    await setById(COL.emailChildren, id, {
      email_id: emailId,
      child_id: childId,
      created_at: nowIso(),
    });
    result.linksCreated += 1;
  };

  for (const row of plan.rows) {
    const eventId = await resolveEvent(row.eventName);
    let emailId = '';
    if (row.emailValid) {
      emailId = await upsertEmail(row.email, row.parentName, row.note);
    }

    if (row.childNames.length > 0) {
      if (!eventId) {
        result.rowsSkipped += 1;
        result.warnings.push(
          `Kein Ziel-Event für „${row.childNames.join(', ')}“ – bitte ein Event wählen.`,
        );
        continue;
      }
      for (const childName of row.childNames) {
        const childId = await upsertChild(eventId, childName);
        if (emailId) await linkEmailChild(emailId, childId);
      }
    }
  }

  return result;
}
