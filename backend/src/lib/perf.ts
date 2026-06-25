import { AsyncLocalStorage } from 'async_hooks';

/**
 * Lightweight per-request performance accounting.
 *
 * The whole datastore lives in Cloud Firestore, so the dominant cost of almost
 * every request is the number (and size) of the Firestore round-trips it makes.
 * When the app suddenly feels slow this is the first thing we need to see: which
 * endpoint is hot, how many documents it pulled, and how long Firestore took.
 *
 * Implementation: an AsyncLocalStorage holds a mutable counter for the lifetime
 * of one request. The data layer (src/db/index.ts) reports every Firestore call
 * into it via {@link recordFirestore}; the request-timing middleware reads the
 * totals when the response finishes. If there is no active context (e.g. a
 * background sweep) recording is a cheap no-op.
 */
export interface PerfStats {
  /** Number of Firestore operations (reads, counts, writes). */
  ops: number;
  /** Documents actually read from Firestore (the real cost driver). */
  docsRead: number;
  /** Write operations (set/update/delete, including batched writes). */
  writes: number;
  /** Total time (ms) spent waiting on Firestore. */
  firestoreMs: number;
  /** The single slowest Firestore op, for quick "what stalled" triage. */
  slowest: { label: string; ms: number; docs: number } | null;
}

const storage = new AsyncLocalStorage<PerfStats>();

export function runWithPerf<T>(fn: () => T): T {
  const stats: PerfStats = { ops: 0, docsRead: 0, writes: 0, firestoreMs: 0, slowest: null };
  return storage.run(stats, fn);
}

export function currentPerf(): PerfStats | undefined {
  return storage.getStore();
}

/**
 * Records a single Firestore operation into the active request context (if any).
 * `docs` is the number of documents read (0 for pure writes); `writes` is the
 * number of write operations performed.
 */
export function recordFirestore(label: string, ms: number, docs = 0, writes = 0): void {
  const stats = storage.getStore();
  if (!stats) return;
  stats.ops += 1;
  stats.docsRead += docs;
  stats.writes += writes;
  stats.firestoreMs += ms;
  if (!stats.slowest || ms > stats.slowest.ms) {
    stats.slowest = { label, ms, docs };
  }
}

/** Convenience wrapper: times a Firestore call and records it. */
export async function timed<T>(
  label: string,
  fn: () => Promise<T>,
  countDocs: (result: T) => { docs?: number; writes?: number },
): Promise<T> {
  const start = Date.now();
  try {
    const result = await fn();
    const { docs = 0, writes = 0 } = countDocs(result);
    recordFirestore(label, Date.now() - start, docs, writes);
    return result;
  } catch (err) {
    recordFirestore(`${label} (error)`, Date.now() - start, 0, 0);
    throw err;
  }
}
