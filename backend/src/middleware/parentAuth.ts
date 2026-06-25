import { NextFunction, Request, Response } from 'express';
import { COL, col, getById, firstOf, updateById, nowIso } from '../db';
import { hashToken } from '../lib/auth';
import { ApiError } from './errorHandler';

export const PARENT_COOKIE = 'parent_session';

interface SessionDoc {
  email_id: string;
  token_hash: string;
  expires_at: string;
}

export async function loadParent(req: Request): Promise<NonNullable<Request['parent']> | null> {
  const token = (req.cookies && req.cookies[PARENT_COOKIE]) as string | undefined;
  if (!token) return null;

  const session = await firstOf<SessionDoc>(
    col(COL.parentSessions).where('token_hash', '==', hashToken(token)),
  );
  if (!session) return null;
  if (new Date(session.expires_at).getTime() <= Date.now()) return null;

  const email = await getById<{ email: string; status: string }>(COL.parentEmails, session.email_id);
  if (!email || email.status !== 'verified') return null;

  await updateById(COL.parentSessions, session.id, { last_seen: nowIso() });
  return { emailId: session.email_id, email: email.email, sessionId: session.id };
}

/** Attaches req.parent if a valid verified session exists; never throws. */
export async function attachParent(req: Request, _res: Response, next: NextFunction) {
  try {
    const parent = await loadParent(req);
    if (parent) req.parent = parent;
    next();
  } catch (err) {
    next(err);
  }
}

/** Requires a verified parent session. */
export async function requireParent(req: Request, _res: Response, next: NextFunction) {
  try {
    const parent = await loadParent(req);
    if (!parent) {
      throw new ApiError(401, 'Bitte bestätigen Sie zuerst Ihre E-Mail-Adresse.');
    }
    req.parent = parent;
    next();
  } catch (err) {
    next(err);
  }
}
