import { createHash, randomBytes } from "node:crypto";

const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function normalizeAccessCode(code: string): string {
  return code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function hashAccessCode(code: string): string {
  const pepper = process.env.ACCESS_CODE_PEPPER;
  if (!pepper) {
    throw new Error("Missing ACCESS_CODE_PEPPER");
  }

  return createHash("sha256").update(`${pepper}:${normalizeAccessCode(code)}`).digest("hex");
}

function randomSegment(length: number): string {
  const bytes = randomBytes(length);
  let segment = "";

  for (const byte of bytes) {
    segment += alphabet[byte % alphabet.length];
  }

  return segment;
}

export function generateAccessCode(): string {
  return `PG-${randomSegment(4)}-${randomSegment(4)}`;
}
