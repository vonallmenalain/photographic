import rateLimit from 'express-rate-limit';

// Protects e-mail verification request endpoint from abuse / address probing.
export const verificationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 12,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Zu viele Anfragen. Bitte versuche es später erneut.' },
});

export const codeCheckLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Zu viele Versuche. Bitte versuche es später erneut.' },
});

export const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Zu viele Anmeldeversuche. Bitte warte einen Moment.' },
});

export const passwordResetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Zu viele Anfragen. Bitte versuche es später erneut.' },
});

// Protects the parent "report a problem" endpoint from spam/abuse. The endpoint
// does not strictly require a logged-in session, so without a limit anyone could
// flood the admin "Meldungen" inbox.
export const reportLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Zu viele Meldungen. Bitte versuchen Sie es später erneut.' },
});

// Klassenlink (Selbstregistrierung der Eltern): öffentlich erreichbar, nur mit
// dem Klassenlink. Begrenzt, damit niemand die Klassenliste mit Einträgen
// flutet oder die Mailadressen anderer Leute mit Bestätigungs-Mails bombardiert.
export const registrationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Zu viele Anfragen. Bitte versuchen Sie es später erneut.' },
});

// Einverständnis-Formular und Klassenseite der Lehrperson: zwar nur mit
// bestätigter Sitzung erreichbar, aber ebenfalls begrenzt (Mailversand).
export const consentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Zu viele Anfragen. Bitte versuchen Sie es später erneut.' },
});
