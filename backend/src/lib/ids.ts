import crypto from 'crypto';

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/** URL-safe random id, not enumerable, no information leak. */
export function newId(prefix = ''): string {
  const bytes = crypto.randomBytes(16);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return prefix ? `${prefix}_${out}` : out;
}

/** Opaque token for magic links / sessions / downloads. */
export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

/** Numeric verification code (default 6 digits). */
export function numericCode(length = 6): string {
  let code = '';
  while (code.length < length) {
    code += crypto.randomInt(0, 10).toString();
  }
  return code.slice(0, length);
}

export function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

/** Constant-time compare to avoid timing leaks on codes/tokens. */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}
