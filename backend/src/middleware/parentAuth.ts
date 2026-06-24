import { NextFunction, Request, Response } from 'express';
import { getDb } from '../db';
import { hashToken } from '../lib/auth';
import { ApiError } from './errorHandler';

export const PARENT_COOKIE = 'parent_session';

interface SessionRow {
  id: string;
  email_id: string;
  email: string;
  expires_at: string;
}

export function loadParent(req: Request): Request['parent'] | null {
  const token = (req.cookies && req.cookies[PARENT_COOKIE]) as string | undefined;
  if (!token) return null;
  const db = getDb();
  const row = db
    .prepare(
      `SELECT s.id, s.email_id, s.expires_at, e.email
       FROM parent_sessions s
       JOIN parent_emails e ON e.id = s.email_id
       WHERE s.token_hash = ? AND s.expires_at > datetime('now')
         AND e.status = 'verified'`,
    )
    .get(hashToken(token)) as SessionRow | undefined;
  if (!row) return null;
  db.prepare("UPDATE parent_sessions SET last_seen = datetime('now') WHERE id = ?").run(row.id);
  return { emailId: row.email_id, email: row.email, sessionId: row.id };
}

/** Attaches req.parent if a valid verified session exists; never throws. */
export function attachParent(req: Request, _res: Response, next: NextFunction) {
  const parent = loadParent(req);
  if (parent) req.parent = parent;
  next();
}

/** Requires a verified parent session. */
export function requireParent(req: Request, _res: Response, next: NextFunction) {
  const parent = loadParent(req);
  if (!parent) {
    throw new ApiError(401, 'Bitte bestätige zuerst deine E-Mail-Adresse.');
  }
  req.parent = parent;
  next();
}
