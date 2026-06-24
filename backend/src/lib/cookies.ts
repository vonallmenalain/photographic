import { Response } from 'express';
import { config } from '../config';

interface CookieOpts {
  maxAgeMs?: number;
}

export function setAuthCookie(res: Response, name: string, value: string, opts: CookieOpts = {}) {
  res.cookie(name, value, {
    httpOnly: true,
    secure: config.cookie.secure,
    sameSite: config.cookie.sameSite,
    domain: config.cookie.domain,
    path: '/',
    maxAge: opts.maxAgeMs,
  });
}

export function clearAuthCookie(res: Response, name: string) {
  res.clearCookie(name, {
    httpOnly: true,
    secure: config.cookie.secure,
    sameSite: config.cookie.sameSite,
    domain: config.cookie.domain,
    path: '/',
  });
}
