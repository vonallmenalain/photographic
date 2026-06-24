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

/** Removes a trailing file extension (".jpg", ".jpeg", …). */
export function stripExtension(filename: string): string {
  return String(filename ?? '').replace(/\.[a-z0-9]{1,8}$/i, '');
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
 *
 * The best match is the one covering the most characters. If two different
 * children tie for the best score the result is flagged `ambiguous` so callers
 * can choose to skip the automatic assignment.
 */
export function matchChildByFilename(
  filename: string,
  children: ChildLike[],
): FilenameMatch | null {
  const base = stripExtension(filename);
  const fileTokens = canonicalTokens(base);
  const fileJoined = canonical(base).replace(/[^a-z0-9]+/g, '');
  if (!fileJoined) return null;

  let best: { child: ChildLike; score: number } | null = null;
  let tie = false;

  for (const child of children) {
    const childToks = canonicalTokens(child.name);
    const childJoined = canonical(child.name).replace(/[^a-z0-9]+/g, '');
    if (childJoined.length < 2) continue;

    let score = 0;
    const allTokensPresent =
      childToks.length > 0 && childToks.every((t) => fileTokens.includes(t));
    if (allTokensPresent) {
      score = childToks.join('').length + 1; // whole-token match is strongest
    } else if (fileJoined.includes(childJoined)) {
      score = childJoined.length;
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
