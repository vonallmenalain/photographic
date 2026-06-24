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
  // mounted into the container (see docker-compose.yml).
  storageDir: path.resolve(optional('STORAGE_DIR', path.join(process.cwd(), 'data', 'storage'))),
  dbPath: path.resolve(optional('DB_PATH', path.join(process.cwd(), 'data', 'app.db'))),

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
  },

  // Image variant settings.
  images: {
    adminThumbMax: int('IMG_ADMIN_THUMB_MAX', 480),
    thumbMax: int('IMG_THUMB_MAX', 520),
    previewMax: int('IMG_PREVIEW_MAX', 1100),
    previewQuality: int('IMG_PREVIEW_QUALITY', 62),
    thumbQuality: int('IMG_THUMB_QUALITY', 58),
    watermarkText: optional('IMG_WATERMARK_TEXT', 'VORSCHAU · GESCHÜTZT'),
  },

  // Stripe (optional). If not configured, checkout uses a manual/test flow.
  stripe: {
    secretKey: optional('STRIPE_SECRET_KEY'),
    webhookSecret: optional('STRIPE_WEBHOOK_SECRET'),
    currency: optional('CURRENCY', 'eur'),
    enabled: !!optional('STRIPE_SECRET_KEY'),
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
