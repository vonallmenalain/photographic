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
  | 'child'
  | 'event'
  | 'note'
  | 'ignore';

/** Roles that map to exactly one column. */
export type SingleRole = 'name' | 'child' | 'event' | 'note';

/**
 * Column mapping. Every role except `email` maps to a single column. The
 * `email` role may map to *several* columns (e.g. a sheet with both an
 * "E-Mail" and an "E-Mail 2" column, or two columns that share the title
 * "E-Mail"). For backwards compatibility a single number is also accepted.
 */
export interface Mapping {
  email?: number | number[];
  name?: number;
  child?: number;
  event?: number;
  note?: number;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Separators that may be used to list several e-mail addresses in one cell. */
const EMAIL_SPLIT_RE = /[\s,;/|]+/;

/**
 * Splits a single cell into individual, normalized e-mail addresses. Tolerates
 * the separators admins typically use to put more than one address into one
 * field: comma, semicolon, slash, pipe and plain whitespace/line breaks.
 */
export function splitEmails(cell: string): string[] {
  return String(cell ?? '')
    .split(EMAIL_SPLIT_RE)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** Returns the (deduplicated) list of column indices mapped to the e-mail role. */
export function emailIndices(mapping: Mapping): number[] {
  const raw = mapping.email;
  if (raw === undefined || raw === null) return [];
  const arr = Array.isArray(raw) ? raw : [raw];
  return Array.from(new Set(arr.filter((n) => Number.isInteger(n) && n >= 0)));
}

/** True when the cell contains at least one address that looks like an e-mail. */
function cellHasEmail(value: string): boolean {
  return splitEmails(value).some((e) => EMAIL_RE.test(e));
}

/**
 * Substring keywords per role. Detection is tolerant: a header is mapped to a
 * role as soon as it *contains* one of the role's keywords (after normalizing
 * away case, accents and separators). The order below is the priority order –
 * more specific roles must come first so that, e.g. "Name Eltern" is read as
 * the parents' name and "Kindergarten" as the order, not as a child name.
 */
const ROLE_KEYWORDS: { role: Exclude<ImportRole, 'ignore'>; keywords: string[] }[] = [
  { role: 'email', keywords: ['mail'] },
  { role: 'note', keywords: ['notiz', 'note', 'bemerkung', 'kommentar', 'comment', 'hinweis'] },
  // Parents' name – anything that mentions the parents/family or a contact.
  { role: 'name', keywords: ['eltern', 'familienname', 'parent', 'kontakt'] },
  // Order / class – checked before "child" so "Kindergarten" is not read as a child.
  {
    role: 'event',
    keywords: [
      'auftrag', 'klasse', 'kindergarten', 'schule', 'gruppe', 'group',
      'class', 'event', 'veranstaltung', 'fotoset', 'galerie', 'gallery',
    ],
  },
  // Child – the full child name. "Name" and "Vorname" both land here.
  { role: 'child', keywords: ['kind', 'name', 'vorname', 'schueler', 'student', 'child'] },
];

function roleForHeader(header: string): Exclude<ImportRole, 'ignore'> | null {
  const key = normalizeName(header).replace(/[^a-z0-9]+/g, '');
  if (!key) return null;
  for (const { role, keywords } of ROLE_KEYWORDS) {
    if (keywords.some((kw) => key.includes(kw))) return role;
  }
  return null;
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
  const emailCols = new Set(emailIndices(mapping));
  const singleRoleByIndex = new Map<number, ImportRole>();
  (['name', 'child', 'event', 'note'] as const).forEach((role) => {
    const idx = mapping[role];
    if (typeof idx === 'number') singleRoleByIndex.set(idx, role);
  });
  const columns: DetectedColumn[] = [];
  for (let i = 0; i < width; i += 1) {
    const role: ImportRole = emailCols.has(i)
      ? 'email'
      : singleRoleByIndex.get(i) ?? 'ignore';
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
  const firstHasEmail = first.some(cellHasEmail);
  const headerMatches = first.filter((c) => roleForHeader(c)).length;
  const hasHeader = !firstHasEmail && headerMatches >= 1;

  const mapping: Mapping = {};

  if (hasHeader) {
    // Collect *all* columns whose header maps to the e-mail role so a second
    // "E-Mail"/"E-Mail 2" column is picked up as well. Other roles stay single.
    const emailCols: number[] = [];
    first.forEach((header, index) => {
      const role = roleForHeader(header);
      if (!role) return;
      if (role === 'email') {
        emailCols.push(index);
        return;
      }
      if (mapping[role] === undefined) mapping[role] = index;
    });
    if (emailCols.length > 0) mapping.email = emailCols;
  } else {
    // No header: infer the e-mail columns from content. A column counts as an
    // e-mail column when at least half of its non-empty cells contain an
    // address. The first remaining column becomes the child name (a best-effort
    // default the admin can override).
    const emailCols: number[] = [];
    for (let c = 0; c < width; c += 1) {
      let nonEmpty = 0;
      let hits = 0;
      for (const r of rows) {
        const v = String(r[c] ?? '').trim();
        if (!v) continue;
        nonEmpty += 1;
        if (cellHasEmail(v)) hits += 1;
      }
      if (hits > 0 && hits * 2 >= nonEmpty) emailCols.push(c);
    }
    if (emailCols.length > 0) mapping.email = emailCols;
    const others = Array.from({ length: width }, (_, i) => i).filter(
      (i) => !emailCols.includes(i),
    );
    if (others.length >= 1) mapping.child = others[0];
  }

  return { hasHeader, mapping, columns: describeColumns(rows, mapping, hasHeader) };
}

export interface PlanEmail {
  email: string;
  valid: boolean;
}

export interface PlanRow {
  rowIndex: number;
  /** All e-mail addresses found for the row (across columns and split cells). */
  emails: PlanEmail[];
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

  const idxs = emailIndices(mapping);

  dataRows.forEach((row, i) => {
    const warnings: string[] = [];
    // Gather e-mails across every mapped e-mail column and split multi-address
    // cells; deduplicate while keeping the first occurrence's order.
    const seen = new Set<string>();
    const emails: PlanEmail[] = [];
    for (const idx of idxs) {
      for (const addr of splitEmails(cell(row, idx))) {
        if (seen.has(addr)) continue;
        seen.add(addr);
        emails.push({ email: addr, valid: EMAIL_RE.test(addr) });
      }
    }
    const validEmails = emails.filter((e) => e.valid);
    const hasInvalid = emails.some((e) => !e.valid);

    const parentNameCell = cell(row, mapping.name);
    const childCell = cell(row, mapping.child);
    const eventName = cell(row, mapping.event);
    const note = cell(row, mapping.note);

    let parentName = '';
    let childNames: string[] = [];
    if (childCell) {
      // Explicit child column → the name column describes the parent/family.
      childNames = splitNames(childCell);
      parentName = parentNameCell;
    } else {
      // No child column → the name column describes the child.
      childNames = parentNameCell ? [parentNameCell] : [];
      parentName = '';
    }

    if (emails.length === 0 && childNames.length === 0) {
      skipped += 1;
      return; // genuinely empty row
    }

    if (hasInvalid)
      warnings.push('Ungültige E-Mail-Adresse(n) – diese werden nicht verknüpft.');
    if (validEmails.length === 0 && childNames.length > 0)
      warnings.push('Keine gültige E-Mail – Kind wird angelegt, aber nicht verknüpft.');
    if (validEmails.length > 0 && childNames.length === 0)
      warnings.push('Nur E-Mail – ohne Kind-Verknüpfung.');

    if (validEmails.length > 0) {
      withEmail += 1;
      for (const e of validEmails) emailSet.add(e.email);
    }
    children += childNames.length;

    planRows.push({
      rowIndex: i,
      emails,
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
    // Upsert every valid e-mail of the row so siblings/co-parents all get linked.
    const emailIds: string[] = [];
    for (const pe of row.emails) {
      if (!pe.valid) continue;
      emailIds.push(await upsertEmail(pe.email, row.parentName, row.note));
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
        for (const emailId of emailIds) await linkEmailChild(emailId, childId);
      }
    }
  }

  return result;
}
