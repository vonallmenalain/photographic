import crypto from 'crypto';

/**
 * Signaturprüfung für Resend-Webhooks. Resend verschickt Webhooks über Svix:
 * Jede Zustellung trägt die Header `svix-id`, `svix-timestamp` und
 * `svix-signature`; signiert wird `${id}.${timestamp}.${rawBody}` mit
 * HMAC-SHA256 und dem base64-kodierten Teil des Signing Secrets (`whsec_…`).
 * Der Header kann mehrere Signaturen enthalten (`v1,<sig> v1,<sig>`), z. B.
 * nach einer Secret-Rotation – eine passende genügt.
 */
export interface SvixHeaders {
  id?: string;
  timestamp?: string;
  signature?: string;
}

export function verifySvixSignature(
  secret: string,
  headers: SvixHeaders,
  payload: string,
  toleranceSeconds = 5 * 60,
): boolean {
  if (!secret || !headers.id || !headers.timestamp || !headers.signature) return false;
  const ts = Number(headers.timestamp);
  if (!Number.isFinite(ts)) return false;
  // Alte (wiederholte) Zustellungen ablehnen.
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > toleranceSeconds) return false;

  const key = Buffer.from(secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret, 'base64');
  if (key.length === 0) return false;
  const expected = crypto
    .createHmac('sha256', key)
    .update(`${headers.id}.${headers.timestamp}.${payload}`)
    .digest();

  return headers.signature
    .split(' ')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => (entry.includes(',') ? entry.split(',')[1] ?? '' : entry))
    .some((sig) => {
      let given: Buffer;
      try {
        given = Buffer.from(sig, 'base64');
      } catch {
        return false;
      }
      return given.length === expected.length && crypto.timingSafeEqual(given, expected);
    });
}
