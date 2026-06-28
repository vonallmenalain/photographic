import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name: string, fallback = ''): string {
  return process.env[name] ?? fallback;
}

function bool(name: string, fallback = false): boolean {
  const v = process.env[name];
  if (v === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}

function int(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Normalises the configured Stripe Checkout payment methods.
 *
 * Apple Pay and Google Pay are *wallets* that Stripe surfaces through the
 * `card` payment method – they are NOT standalone Checkout `payment_method_types`.
 * Passing `apple_pay`/`google_pay` (or `link`) in `payment_method_types` makes
 * the Stripe API reject the request. When `card` is enabled and the wallets are
 * activated in the Dashboard, Stripe shows Apple Pay / Google Pay automatically
 * on supported devices ("Checkout supports Apple Pay and Google Pay with no
 * integration changes").
 *
 * To let operators list all four methods (card, twint, apple_pay, google_pay)
 * in `STRIPE_PAYMENT_METHODS` without breaking checkout, we translate the wallet
 * aliases (and common spelling variants) to `card`, drop empty entries and
 * de-duplicate while preserving order.
 */
function normalizePaymentMethods(raw: string): string[] {
  const walletAliases = new Set([
    'apple_pay',
    'applepay',
    'apple-pay',
    'google_pay',
    'googlepay',
    'google-pay',
  ]);
  const result: string[] = [];
  for (const entry of raw.split(',')) {
    const method = entry.trim().toLowerCase();
    if (!method) continue;
    const normalized = walletAliases.has(method) ? 'card' : method;
    if (!result.includes(normalized)) result.push(normalized);
  }
  return result;
}

const isProd = (process.env.NODE_ENV ?? 'development') === 'production';

/**
 * Central configuration. All secrets and infrastructure paths come from the
 * environment so the same image can run locally, on the QNAP via Docker, etc.
 */
export const config = {
  env: process.env.NODE_ENV ?? 'development',
  isProd,
  port: int('PORT', 4000),

  // Where the React frontend (Netlify) is served from. Used for CORS and the
  // links inside verification e-mails.
  publicAppUrl: optional('PUBLIC_APP_URL', 'http://localhost:5173').replace(/\/$/, ''),

  // Comma separated list of additionally allowed CORS origins.
  extraCorsOrigins: optional('EXTRA_CORS_ORIGINS')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  // Storage: this directory is expected to live on the QNAP volume that is
  // mounted into the container (see docker-compose.yml). Photo originals and the
  // generated (watermarked) variants live here; only metadata goes to Firestore.
  storageDir: path.resolve(optional('STORAGE_DIR', path.join(process.cwd(), 'data', 'storage'))),

  // ------------------------------------------------------------------------
  // Firebase / Firestore. The whole datastore now lives in Cloud Firestore and
  // parent e-mail verification runs through Firebase Authentication.
  //
  // The backend uses the Firebase Admin SDK and therefore needs a service
  // account (NOT the public web config). Provide it via one of:
  //   - FIREBASE_SERVICE_ACCOUNT       : the service-account JSON as a string
  //   - FIREBASE_SERVICE_ACCOUNT_PATH  : path to the service-account JSON file
  //   - GOOGLE_APPLICATION_CREDENTIALS : standard ADC path (auto-detected)
  // For local development you can instead point at the Firebase Emulator Suite
  // by setting FIRESTORE_EMULATOR_HOST and FIREBASE_AUTH_EMULATOR_HOST.
  // ------------------------------------------------------------------------
  firebase: {
    projectId: optional('FIREBASE_PROJECT_ID', 'photographic-7ba68'),
    serviceAccountJson: optional('FIREBASE_SERVICE_ACCOUNT'),
    serviceAccountPath:
      optional('FIREBASE_SERVICE_ACCOUNT_PATH') || optional('GOOGLE_APPLICATION_CREDENTIALS'),
    storageBucket: optional('FIREBASE_STORAGE_BUCKET', 'photographic-7ba68.firebasestorage.app'),
    firestoreEmulatorHost: optional('FIRESTORE_EMULATOR_HOST'),
    authEmulatorHost: optional('FIREBASE_AUTH_EMULATOR_HOST'),
    // When true (default), parents may verify via Firebase Authentication.
    parentAuthEnabled: bool('FIREBASE_PARENT_AUTH', true),
  },

  // Secrets used to sign tokens. MUST be set in production.
  jwtSecret: required('JWT_SECRET', isProd ? undefined : 'dev-insecure-jwt-secret-change-me'),
  fileTokenSecret: required(
    'FILE_TOKEN_SECRET',
    isProd ? undefined : 'dev-insecure-file-secret-change-me',
  ),

  // Admin credentials. ADMIN_PASSWORD_HASH is a bcrypt hash (see create-admin).
  admin: {
    username: optional('ADMIN_USERNAME', 'admin'),
    passwordHash: optional('ADMIN_PASSWORD_HASH'),
    // Fallback for first run / local dev only.
    plainPassword: optional('ADMIN_PASSWORD'),
    // E-Mail-Adresse des Admins – wird für den "Passwort vergessen"-Link benötigt.
    email: optional('ADMIN_EMAIL', 'vonallmenalain@gmail.com'),
    // TTL für Passwort-Reset-Token in Minuten (Standard: 60).
    passwordResetTtlMinutes: int('ADMIN_PASSWORD_RESET_TTL_MINUTES', 60),
    // Notfall-/Wiederherstellungs-Schalter. NUR wenn true wird beim Start das
    // Passwort des konfigurierten Admins aus der Umgebung (ADMIN_PASSWORD /
    // ADMIN_PASSWORD_HASH) erzwungen. Standard false, damit ein im Adminbereich
    // bzw. per "Passwort vergessen" gesetztes Passwort einen Neustart/Deploy
    // überlebt und nicht still vom .env-Wert überschrieben wird.
    passwordResetOnBoot: bool('ADMIN_PASSWORD_RESET_ON_BOOT', false),
  },

  // Parent verification behaviour.
  verification: {
    codeTtlMinutes: int('VERIFICATION_CODE_TTL_MINUTES', 20),
    maxAttempts: int('VERIFICATION_MAX_ATTEMPTS', 6),
    sessionTtlDays: int('PARENT_SESSION_TTL_DAYS', 30),
  },

  // Foto-Set retention. Default 30 days per concept.
  retentionDaysDefault: int('GALLERY_RETENTION_DAYS', 30),

  // SMTP / e-mail.
  mail: {
    host: optional('SMTP_HOST'),
    port: int('SMTP_PORT', 587),
    secure: bool('SMTP_SECURE', false),
    user: optional('SMTP_USER'),
    pass: optional('SMTP_PASS'),
    from: optional('MAIL_FROM', 'Foto-Galerie <no-reply@example.com>'),
    // If no SMTP host is configured we log e-mails to the console (dev mode).
    devLogOnly: !optional('SMTP_HOST'),
    supportEmail: optional('SUPPORT_EMAIL', 'support@example.com'),
    // Upper bound (ms) for establishing the SMTP connection / waiting on the
    // server, so a misconfigured host fails fast rather than stalling requests.
    timeoutMs: int('SMTP_TIMEOUT_MS', 10_000),
  },

  // Image variant settings.
  images: {
    adminThumbMax: int('IMG_ADMIN_THUMB_MAX', 480),
    thumbMax: int('IMG_THUMB_MAX', 520),
    previewMax: int('IMG_PREVIEW_MAX', 1100),
    previewQuality: int('IMG_PREVIEW_QUALITY', 62),
    thumbQuality: int('IMG_THUMB_QUALITY', 58),
    watermarkText: optional('IMG_WATERMARK_TEXT', 'Vorschau'),
    // Font family used for the watermark text. Kept configurable so the
    // watermark always matches the typeface used across the website (currently
    // "Kalam", the hand-lettered display font of the parent view). Change this
    // in ONE place when the site font changes – just make sure the chosen font
    // is actually installed in the runtime image (see backend/Dockerfile, which
    // ships the bundled fonts from backend/assets/fonts). The fallbacks are the
    // metric-compatible families we always ship so the watermark never silently
    // disappears if the primary font is missing.
    watermarkFontFamily: optional(
      'IMG_WATERMARK_FONT_FAMILY',
      "'Kalam', 'Liberation Sans', 'DejaVu Sans', Arial, Helvetica, sans-serif",
    ),
  },

  // Stripe (optional). If not configured, checkout uses a manual/test flow.
  stripe: {
    secretKey: optional('STRIPE_SECRET_KEY'),
    webhookSecret: optional('STRIPE_WEBHOOK_SECRET'),
    currency: optional('CURRENCY', 'chf'),
    enabled: !!optional('STRIPE_SECRET_KEY'),
    // Which payment methods the Stripe Checkout page offers. We pin this in code
    // (instead of relying on the Stripe Dashboard's "automatic payment methods")
    // so the available methods are explicit and reproducible. Default: card +
    // TWINT (TWINT requires the currency to be CHF). Apple Pay and Google Pay are
    // wallets that ride on `card` and appear automatically when enabled in the
    // Dashboard – listing them here is allowed and simply maps to `card`.
    // Comma-separated list; leave empty to let Stripe/Dashboard decide.
    paymentMethods: normalizePaymentMethods(
      optional('STRIPE_PAYMENT_METHODS', 'card,twint,apple_pay,google_pay'),
    ),
  },

  // Cookie settings.
  cookie: {
    secure: bool('COOKIE_SECURE', isProd),
    // 'none' is required when frontend and API are on different domains
    // (Netlify + Cloudflare Tunnel). Falls back to 'lax' locally.
    sameSite: (optional('COOKIE_SAMESITE', isProd ? 'none' : 'lax') as 'none' | 'lax' | 'strict'),
    domain: optional('COOKIE_DOMAIN') || undefined,
  },

  maxUploadMb: int('MAX_UPLOAD_MB', 60),
};

export type AppConfig = typeof config;
