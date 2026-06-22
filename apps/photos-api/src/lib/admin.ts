import { env } from "../config/env";

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function isAdminEmail(emailLower: string) {
  const admins = env.ADMIN_EMAILS.split(",")
    .map((email) => normalizeEmail(email))
    .filter(Boolean);

  return admins.includes(emailLower);
}
