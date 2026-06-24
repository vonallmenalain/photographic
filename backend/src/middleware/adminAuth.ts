import { NextFunction, Request, Response } from 'express';
import { verifyAdminToken } from '../lib/auth';
import { ApiError } from './errorHandler';

const COOKIE = 'admin_token';

export function getAdminToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) return header.slice(7);
  const cookie = (req.cookies && req.cookies[COOKIE]) as string | undefined;
  return cookie ?? null;
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  const token = getAdminToken(req);
  const payload = token ? verifyAdminToken(token) : null;
  if (!payload) {
    throw new ApiError(401, 'Nicht angemeldet.');
  }
  req.admin = { id: payload.sub, username: payload.sub };
  next();
}

export const ADMIN_COOKIE = COOKIE;
