import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { config } from '../config';

export interface AdminTokenPayload {
  sub: string; // admin id / username
  role: 'admin';
}

export function signAdminToken(payload: AdminTokenPayload): string {
  return jwt.sign(payload, config.jwtSecret, { expiresIn: '12h' });
}

export function verifyAdminToken(token: string): AdminTokenPayload | null {
  try {
    const decoded = jwt.verify(token, config.jwtSecret) as AdminTokenPayload;
    if (decoded.role !== 'admin') return null;
    return decoded;
  } catch {
    return null;
  }
}

/**
 * Signs short-lived tokens used to access protected image variants. Bound to a
 * photo id + variant so a token cannot be repurposed.
 */
export function signFileToken(photoId: string, variant: string, ttlSeconds = 3600): string {
  return jwt.sign({ pid: photoId, v: variant }, config.fileTokenSecret, {
    expiresIn: ttlSeconds,
  });
}

export function verifyFileToken(token: string): { pid: string; v: string } | null {
  try {
    const decoded = jwt.verify(token, config.fileTokenSecret) as { pid: string; v: string };
    return decoded;
  } catch {
    return null;
  }
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}
