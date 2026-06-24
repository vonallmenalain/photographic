import { Response } from 'express';
import bcrypt from 'bcryptjs';
import { getDb } from '../db';
import { config } from '../config';
import { newId, randomToken, numericCode } from '../lib/ids';
import { hashToken } from '../lib/auth';
import { sendVerificationEmail } from '../lib/email';
import { setAuthCookie } from '../lib/cookies';
import { PARENT_COOKIE } from '../middleware/parentAuth';
import { normalizeEmail } from '../lib/validation';

interface EmailRow {
  id: string;
  email: string;
  status: string;
}

export function findEmail(email: string): EmailRow | undefined {
  const db = getDb();
  return db
    .prepare('SELECT id, email, status FROM parent_emails WHERE email = ?')
    .get(normalizeEmail(email)) as EmailRow | undefined;
}

/**
 * Issues a verification code + magic link IF the address is registered and not
 * disabled. Returns silently for unknown addresses so callers cannot probe
 * which e-mails exist (neutral response policy).
 */
export async function requestVerification(rawEmail: string): Promise<void> {
  const email = normalizeEmail(rawEmail);
  const row = findEmail(email);
  // Neutral behaviour: do nothing (but do not reveal) for unknown/disabled.
  if (!row || row.status === 'disabled') return;

  const db = getDb();
  const code = numericCode(6);
  const linkToken = randomToken(32);
  const codeHash = bcrypt.hashSync(code, 10);
  const expiresAt = new Date(Date.now() + config.verification.codeTtlMinutes * 60_000)
    .toISOString()
    .replace('T', ' ')
    .slice(0, 19);

  // Invalidate older unconsumed tokens for this e-mail.
  db.prepare(
    "UPDATE verification_tokens SET consumed_at = datetime('now') WHERE email_id = ? AND consumed_at IS NULL",
  ).run(row.id);

  db.prepare(
    `INSERT INTO verification_tokens (id, email_id, code_hash, link_token, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(newId('vt'), row.id, codeHash, linkToken, expiresAt);

  if (row.status === 'created' || row.status === 'not_verified') {
    db.prepare(
      "UPDATE parent_emails SET status = 'verification_sent', updated_at = datetime('now') WHERE id = ?",
    ).run(row.id);
  }

  const link = `${config.publicAppUrl}/verifizieren?token=${linkToken}`;
  await sendVerificationEmail(email, code, link);
}

interface VerifyResult {
  ok: boolean;
  emailId?: string;
  email?: string;
}

function consumeToken(emailId: string, tokenId: string) {
  const db = getDb();
  db.prepare("UPDATE verification_tokens SET consumed_at = datetime('now') WHERE id = ?").run(tokenId);
  db.prepare(
    "UPDATE parent_emails SET status = 'verified', verified_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
  ).run(emailId);
}

export function verifyByCode(rawEmail: string, code: string): VerifyResult {
  const db = getDb();
  const row = findEmail(rawEmail);
  if (!row || row.status === 'disabled') return { ok: false };

  const token = db
    .prepare(
      `SELECT id, code_hash, attempts FROM verification_tokens
       WHERE email_id = ? AND consumed_at IS NULL AND expires_at > datetime('now')
       ORDER BY created_at DESC LIMIT 1`,
    )
    .get(row.id) as { id: string; code_hash: string; attempts: number } | undefined;
  if (!token) return { ok: false };

  if (token.attempts >= config.verification.maxAttempts) return { ok: false };

  db.prepare('UPDATE verification_tokens SET attempts = attempts + 1 WHERE id = ?').run(token.id);

  if (!bcrypt.compareSync(code, token.code_hash)) return { ok: false };

  consumeToken(row.id, token.id);
  return { ok: true, emailId: row.id, email: row.email };
}

export function verifyByLink(linkToken: string): VerifyResult {
  const db = getDb();
  const token = db
    .prepare(
      `SELECT id, email_id FROM verification_tokens
       WHERE link_token = ? AND consumed_at IS NULL AND expires_at > datetime('now')
       LIMIT 1`,
    )
    .get(linkToken) as { id: string; email_id: string } | undefined;
  if (!token) return { ok: false };
  const emailRow = db
    .prepare("SELECT email, status FROM parent_emails WHERE id = ?")
    .get(token.email_id) as { email: string; status: string } | undefined;
  if (!emailRow || emailRow.status === 'disabled') return { ok: false };
  consumeToken(token.email_id, token.id);
  return { ok: true, emailId: token.email_id, email: emailRow.email };
}

/** Creates a parent session and sets the httpOnly cookie (browser remembers). */
export function startSession(res: Response, emailId: string, userAgent: string): void {
  const db = getDb();
  const token = randomToken(32);
  const ttlMs = config.verification.sessionTtlDays * 24 * 60 * 60 * 1000;
  const expiresAt = new Date(Date.now() + ttlMs).toISOString().replace('T', ' ').slice(0, 19);
  db.prepare(
    `INSERT INTO parent_sessions (id, email_id, token_hash, user_agent, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(newId('ps'), emailId, hashToken(token), userAgent.slice(0, 255), expiresAt);
  setAuthCookie(res, PARENT_COOKIE, token, { maxAgeMs: ttlMs });
}

export function endSession(sessionId: string): void {
  getDb().prepare('DELETE FROM parent_sessions WHERE id = ?').run(sessionId);
}
