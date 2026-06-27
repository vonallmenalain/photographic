/**
 * Shared, tolerant name handling used by the bulk import and by the automatic
 * "match a photo to a child via its file name" feature.
 *
 * The goal is to be forgiving: different casing, German umlauts/accents, extra
 * spaces, separators or surrounding words should not stop a sensible match.
 */

/** Lowercases, strips diacritics (ä→a, é→e, ß→ss) and collapses whitespace. */
export function normalizeName(input: string): string {
  return String(input ?? '')
    .normalize('NFD')
    // eslint-disable-next-line no-misleading-character-class
    .replace(/[\u0300-\u036f]/g, '') // combining marks (accents)
    .replace(/ß/g, 'ss')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Splits an arbitrary string into comparable alphanumeric tokens. */
export function nameTokens(input: string): string[] {
  return normalizeName(input)
    .split(/[^a-z0-9]+/i)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2); // ignore single letters/initials and noise
}

/**
 * Aggressive fold used ONLY for fuzzy filename matching: treats the common
 * German umlaut transcriptions as equal so a file named "Mueller" matches a
 * child "Müller" (and vice-versa). Applied symmetrically to both sides.
 */
function canonical(input: string): string {
  return normalizeName(input)
    .replace(/ae/g, 'a')
    .replace(/oe/g, 'o')
    .replace(/ue/g, 'u');
}

function canonicalTokens(input: string): string[] {
  return canonical(input)
    .split(/[^a-z0-9]+/i)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
}

/**
 * Common name particles ("von", "van", "de", …). They appear in many surnames
 * and must NOT be enough on their own to auto-assign a photo: otherwise a file
 * named "von Allmen" would match every sibling that shares the surname. They
 * still count towards a *full* name match, just not towards a partial one.
 */
const NAME_PARTICLES = new Set([
  'von', 'van', 'de', 'der', 'den', 'des', 'del', 'della', 'di', 'da', 'do',
  'dos', 'das', 'le', 'la', 'les', 'du', 'zu', 'zur', 'zum', 'am', 'auf',
  'ten', 'ter', 'op', 'of', 'und', 'and', 'mac', 'mc', 'al', 'el', 'bin',
  'ibn', 'san', 'santa', 'st',
]);

/**
 * Expands the raw file-name tokens with digit-stripped variants so a photo
 * named "Elin1", "Elin_1" or "Elin-01" still yields the bare token "elin".
 * Photographers routinely append a running number directly to the first name.
 */
function expandFileTokens(tokens: string[]): Set<string> {
  const set = new Set<string>();
  for (const t of tokens) {
    set.add(t);
    const noTrailingDigits = t.replace(/\d+$/, '');
    if (noTrailingDigits.length >= 2) set.add(noTrailingDigits);
    const noLeadingDigits = t.replace(/^\d+/, '');
    if (noLeadingDigits.length >= 2) set.add(noLeadingDigits);
  }
  return set;
}

/** Score offset that guarantees a full-name match always beats a partial one. */
const FULL_MATCH_BASE = 1_000_000;

/** Removes a trailing file extension (".jpg", ".jpeg", …). */
export function stripExtension(filename: string): string {
  return String(filename ?? '').replace(/\.[a-z0-9]{1,8}$/i, '');
}

/**
 * Keywords that mark a photo as a group/class photo via its file name. A photo
 * whose file name contains any of these is treated as a "Gruppen-/Klassenfoto"
 * that is visible to the whole class. Matched tolerantly (case-insensitive,
 * umlaut/accent-insensitive) against the normalised file name.
 */
const GROUP_PHOTO_KEYWORDS = ['gruppenfoto', 'klassenfoto', 'klassenspiegel'];

/**
 * Returns true when a photo's file name marks it as a group/class photo, i.e.
 * it contains one of the well-known keywords ("Gruppenfoto", "Klassenfoto",
 * "Klassenspiegel"). The extension is ignored so "Gruppenfoto.jpg" matches.
 */
export function isGroupPhotoFilename(filename: string): boolean {
  const normalized = normalizeName(stripExtension(filename));
  return GROUP_PHOTO_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

/**
 * Splits a "child" cell into individual names. Tolerates several separators
 * that admins typically use to list siblings in a single cell:
 *   "Max, Moritz" · "Max; Moritz" · "Max / Moritz" · "Max & Moritz" · "Max und Moritz"
 */
export function splitNames(cell: string): string[] {
  return String(cell ?? '')
    .split(/[,;/|]|&| und | and | u\. /gi)
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface ChildLike {
  id: string;
  name: string;
}

export interface FilenameMatch {
  childId: string;
  childName: string;
  /** true when more than one child matched equally well (caller may skip). */
  ambiguous: boolean;
}

/**
 * Tries to find the child whose name is contained in a photo's file name.
 *
 * Matching rules (in order of confidence):
 *  1. All tokens of the child's name appear as whole tokens in the file name.
 *  2. The child's concatenated name appears as a substring of the concatenated
 *     file name (handles "MaxMustermann_001.jpg" without separators).
 *  3. A *partial* match: at least one distinctive token of the child's name
 *     (e.g. the first name) appears in the file name. This is what makes the
 *     common "first name + running number" convention work – a file called
 *     "Elin 1.jpg" is matched to the child "Elin von Allmen" even though only
 *     the first name is in the file name. Pure name particles ("von", "de", …)
 *     never trigger a partial match on their own.
 *
 * Full matches (1 & 2) always outrank partial ones (3). Within a tier the best
 * match is the one covering the most characters. If two different children tie
 * for the best score the result is flagged `ambiguous` so callers can choose to
 * skip the automatic assignment (e.g. two children share the same first name).
 */
export function matchChildByFilename(
  filename: string,
  children: ChildLike[],
): FilenameMatch | null {
  const base = stripExtension(filename);
  const fileTokens = expandFileTokens(canonicalTokens(base));
  const fileJoined = canonical(base).replace(/[^a-z0-9]+/g, '');
  if (!fileJoined) return null;

  let best: { child: ChildLike; score: number } | null = null;
  let tie = false;

  for (const child of children) {
    const childToks = canonicalTokens(child.name);
    const childJoined = canonical(child.name).replace(/[^a-z0-9]+/g, '');
    if (childJoined.length < 2) continue;

    const matchedToks = childToks.filter((t) => fileTokens.has(t));
    const substantiveMatched = matchedToks.filter((t) => !NAME_PARTICLES.has(t));

    let score = 0;
    const allTokensPresent =
      childToks.length > 0 && matchedToks.length === childToks.length;
    if (allTokensPresent || fileJoined.includes(childJoined)) {
      // Whole-name match (all tokens present or concatenated substring).
      score = FULL_MATCH_BASE + childJoined.length;
    } else if (substantiveMatched.length > 0) {
      // Partial match: only part of the name (typically the first name) is in
      // the file name. Score by how many real name characters were matched.
      score = substantiveMatched.reduce((sum, t) => sum + t.length, 0);
    }

    if (score === 0) continue;

    if (!best || score > best.score) {
      best = { child, score };
      tie = false;
    } else if (score === best.score && best.child.id !== child.id) {
      tie = true;
    }
  }

  if (!best) return null;
  return { childId: best.child.id, childName: best.child.name, ambiguous: tie };
}
