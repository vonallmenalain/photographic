import { Response } from 'express';
import bcrypt from 'bcryptjs';
import {
  COL,
  col,
  getById,
  firstOf,
  runQuery,
  setById,
  updateById,
  deleteById,
  nowIso,
} from '../db';
import { config } from '../config';
import { newId, randomToken, numericCode } from '../lib/ids';
import { hashToken } from '../lib/auth';
import { authAdmin } from '../lib/firebase';
import { sendVerificationEmail } from '../lib/email';
import { setAuthCookie } from '../lib/cookies';
import { PARENT_COOKIE } from '../middleware/parentAuth';
import { normalizeEmail } from '../lib/validation';

interface EmailRow {
  id: string;
  email: string;
  status: string;
}

export async function findEmail(email: string): Promise<EmailRow | undefined> {
  const row = await firstOf<{ email: string; status: string }>(
    col(COL.parentEmails).where('email', '==', normalizeEmail(email)),
  );
  if (!row) return undefined;
  return { id: row.id, email: row.email, status: row.status };
}

/**
 * Issues a verification code + magic link IF the address is registered and not
 * disabled. Returns silently for unknown addresses so callers cannot probe
 * which e-mails exist (neutral response policy).
 */
export async function requestVerification(rawEmail: string): Promise<void> {
  const email = normalizeEmail(rawEmail);
  const row = await findEmail(email);
  // Neutral behaviour: do nothing (but do not reveal) for unknown/disabled.
  if (!row || row.status === 'disabled') return;

  const code = numericCode(6);
  const linkToken = randomToken(32);
  const codeHash = bcrypt.hashSync(code, 10);
  const expiresAt = new Date(Date.now() + config.verification.codeTtlMinutes * 60_000).toISOString();

  // Invalidate older unconsumed tokens for this e-mail.
  const open = await runQuery(
    col(COL.verificationTokens).where('email_id', '==', row.id).where('consumed_at', '==', null),
  );
  await Promise.all(open.map((t) => updateById(COL.verificationTokens, t.id, { consumed_at: nowIso() })));

  await setById(COL.verificationTokens, newId('vt'), {
    email_id: row.id,
    code_hash: codeHash,
    link_token: linkToken,
    attempts: 0,
    consumed_at: null,
    expires_at: expiresAt,
    created_at: nowIso(),
  });

  if (row.status === 'created' || row.status === 'not_verified') {
    await updateById(COL.parentEmails, row.id, {
      status: 'verification_sent',
      updated_at: nowIso(),
    });
  }

  const link = `${config.publicAppUrl}/verifizieren?token=${linkToken}`;
  // E-mail delivery must never crash the request. The verification token is
  // already persisted above, so the code/link remain valid even if SMTP is
  // momentarily unavailable. Crucially, throwing here would also break the
  // neutral-response policy: unknown addresses return 200, so a registered
  // address whose send fails returning 500 would reveal that it exists.
  try {
    await sendVerificationEmail(email, code, link);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[verification] Failed to send verification e-mail. Check SMTP_* settings.', err);
  }
}

interface VerifyResult {
  ok: boolean;
  emailId?: string;
  email?: string;
}

async function consumeToken(emailId: string, tokenId: string): Promise<void> {
  await updateById(COL.verificationTokens, tokenId, { consumed_at: nowIso() });
  await updateById(COL.parentEmails, emailId, {
    status: 'verified',
    verified_at: nowIso(),
    updated_at: nowIso(),
  });
}

interface VTokenDoc {
  email_id: string;
  code_hash: string;
  link_token: string;
  attempts: number;
  consumed_at: string | null;
  expires_at: string;
  created_at: string;
}

export async function verifyByCode(rawEmail: string, code: string): Promise<VerifyResult> {
  const row = await findEmail(rawEmail);
  if (!row || row.status === 'disabled') return { ok: false };

  const open = await runQuery<VTokenDoc>(
    col(COL.verificationTokens).where('email_id', '==', row.id).where('consumed_at', '==', null),
  );
  const token = open
    .filter((t) => new Date(t.expires_at).getTime() > Date.now())
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  if (!token) return { ok: false };

  if (token.attempts >= config.verification.maxAttempts) return { ok: false };
  await updateById(COL.verificationTokens, token.id, { attempts: token.attempts + 1 });

  if (!bcrypt.compareSync(code, token.code_hash)) return { ok: false };

  await consumeToken(row.id, token.id);
  return { ok: true, emailId: row.id, email: row.email };
}

export async function verifyByLink(linkToken: string): Promise<VerifyResult> {
  const matches = await runQuery<VTokenDoc>(
    col(COL.verificationTokens).where('link_token', '==', linkToken).where('consumed_at', '==', null),
  );
  const token = matches.filter((t) => new Date(t.expires_at).getTime() > Date.now())[0];
  if (!token) return { ok: false };

  const emailRow = await getById<{ email: string; status: string }>(COL.parentEmails, token.email_id);
  if (!emailRow || emailRow.status === 'disabled') return { ok: false };

  await consumeToken(token.email_id, token.id);
  return { ok: true, emailId: token.email_id, email: emailRow.email };
}

/**
 * Firebase Authentication flow. The frontend signs the parent in with Firebase
 * (e-mail link / verified e-mail) and posts the resulting ID token here. We
 * verify it with the Admin SDK, then upsert the matching parent_emails record.
 *
 * A parent who verifies an address that the admin has not registered yet still
 * gets a session, but simply sees an empty gallery (no info leak) until the
 * admin links children/photos to that address.
 */
export async function verifyByFirebaseToken(idToken: string): Promise<VerifyResult> {
  let decoded;
  try {
    decoded = await authAdmin().verifyIdToken(idToken, true);
  } catch {
    return { ok: false };
  }
  const email = decoded.email ? normalizeEmail(decoded.email) : '';
  if (!email || decoded.email_verified === false) return { ok: false };

  const existing = await findEmail(email);
  if (existing) {
    if (existing.status === 'disabled') return { ok: false };
    await updateById(COL.parentEmails, existing.id, {
      status: 'verified',
      verified_at: nowIso(),
      firebase_uid: decoded.uid,
      updated_at: nowIso(),
    });
    return { ok: true, emailId: existing.id, email: existing.email };
  }

  // Self-registration on first verified sign-in.
  const id = newId('eml');
  await setById(COL.parentEmails, id, {
    email,
    status: 'verified',
    verified_at: nowIso(),
    firebase_uid: decoded.uid,
    note: '',
    created_at: nowIso(),
    updated_at: nowIso(),
  });
  return { ok: true, emailId: id, email };
}

/** Creates a parent session and sets the httpOnly cookie (browser remembers). */
export async function startSession(res: Response, emailId: string, userAgent: string): Promise<void> {
  const token = randomToken(32);
  const ttlMs = config.verification.sessionTtlDays * 24 * 60 * 60 * 1000;
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();
  await setById(COL.parentSessions, newId('ps'), {
    email_id: emailId,
    token_hash: hashToken(token),
    user_agent: userAgent.slice(0, 255),
    created_at: nowIso(),
    last_seen: nowIso(),
    expires_at: expiresAt,
  });
  setAuthCookie(res, PARENT_COOKIE, token, { maxAgeMs: ttlMs });
}

export async function endSession(sessionId: string): Promise<void> {
  await deleteById(COL.parentSessions, sessionId);
}
