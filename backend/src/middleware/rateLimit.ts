import type { Request } from 'express';
import rateLimit, { type RateLimitInfo } from 'express-rate-limit';

// Alle Begrenzungen zählen pro IP-Adresse innerhalb eines Zeitfensters von
// 15 Minuten. Das Fenster beginnt mit der ersten Anfrage; ist das Kontingent
// aufgebraucht, antwortet die API bis zum Ende dieses Fensters mit 429.
// Weitere Anfragen während der Sperre verlängern sie nicht. Die Zähler liegen
// im Arbeitsspeicher – ein Neustart des Backends setzt sie zurück.
const WINDOW_MS = 15 * 60 * 1000;

/**
 * Restzeit bis zum Ende der Sperre als Text („in einer Minute“, „in 12 Minuten“).
 * Ohne bekannten Zeitpunkt wird vorsichtshalber das ganze Fenster genannt.
 */
export function waitHint(resetTime: Date | undefined, now = Date.now()): string {
  const ms = resetTime ? resetTime.getTime() - now : WINDOW_MS;
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  return minutes === 1 ? 'in einer Minute' : `in ${minutes} Minuten`;
}

/** Baut einen Limiter, dessen Meldung die verbleibende Wartezeit nennt. */
function limiter(max: number, reason: string) {
  return rateLimit({
    windowMs: WINDOW_MS,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: (req: Request) => {
      const info = (req as Request & { rateLimit?: RateLimitInfo }).rateLimit;
      return { error: `${reason} Bitte versuchen Sie es ${waitHint(info?.resetTime)} erneut.` };
    },
  });
}

// Protects e-mail verification request endpoint from abuse / address probing.
export const verificationLimiter = limiter(12, 'Zu viele Anfragen.');

export const codeCheckLimiter = limiter(30, 'Zu viele Versuche.');

export const adminLoginLimiter = limiter(20, 'Zu viele Anmeldeversuche.');

export const passwordResetLimiter = limiter(5, 'Zu viele Anfragen.');

// Protects the parent "report a problem" endpoint from spam/abuse. The endpoint
// does not strictly require a logged-in session, so without a limit anyone could
// flood the admin "Meldungen" inbox.
export const reportLimiter = limiter(10, 'Zu viele Meldungen.');

// Klassenlink (Selbstregistrierung der Eltern): öffentlich erreichbar, nur mit
// dem Klassenlink. Begrenzt, damit niemand die Klassenliste mit Einträgen
// flutet oder die Mailadressen anderer Leute mit Bestätigungs-Mails bombardiert.
export const registrationLimiter = limiter(20, 'Zu viele Anfragen.');

// Einverständnis-Formular und Klassenseite der Lehrperson: zwar nur mit
// bestätigter Sitzung erreichbar, aber ebenfalls begrenzt (Mailversand).
export const consentLimiter = limiter(60, 'Zu viele Anfragen.');
