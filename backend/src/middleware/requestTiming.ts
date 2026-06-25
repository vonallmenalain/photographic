import { NextFunction, Request, Response } from 'express';
import { runWithPerf, currentPerf } from '../lib/perf';

/**
 * Logs one line per request with the wall-clock duration and the Firestore work
 * it triggered (ops / documents read / writes / time spent in Firestore).
 *
 * Why this exists: the app stores everything in Cloud Firestore, so a request
 * that "suddenly takes 30 s" is almost always doing too many / too large
 * Firestore reads, or is waiting on a degraded connection to Google. Without
 * this line there is no way to tell those apart from the outside. Requests
 * slower than SLOW_REQUEST_MS are additionally flagged with `[slow]` so they
 * stand out in `docker logs`.
 */
const SLOW_REQUEST_MS = Number(process.env.SLOW_REQUEST_MS ?? 1500);

export function requestTiming(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  runWithPerf(() => {
    res.on('finish', () => {
      const stats = currentPerf();
      const total = Date.now() - start;
      const fs = stats
        ? `firestore=${stats.ops}ops/${stats.docsRead}docs/${stats.writes}writes ${stats.firestoreMs}ms`
        : 'firestore=n/a';
      const slow = stats?.slowest ? ` slowest=${stats.slowest.label}(${stats.slowest.ms}ms,${stats.slowest.docs}docs)` : '';
      const tag = total >= SLOW_REQUEST_MS ? '[slow]' : '[req]';
      // eslint-disable-next-line no-console
      console.log(
        `${tag} ${req.method} ${req.originalUrl} -> ${res.statusCode} ${total}ms ${fs}${
          total >= SLOW_REQUEST_MS ? slow : ''
        }`,
      );
    });
    next();
  });
}
