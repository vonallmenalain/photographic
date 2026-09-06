/**
 * Startup diagnostics for the Stripe configuration.
 *
 * Switching the shop from a Stripe sandbox to production is nothing but
 * exchanging two values in the `.env` (`STRIPE_SECRET_KEY` and the *live*
 * `STRIPE_WEBHOOK_SECRET`). Because nothing in the UI reveals which of the two
 * environments the backend talks to, the classic failure modes are silent: a
 * forgotten test key collects no money, and a missing/ sandbox webhook secret
 * leaves every paid order stuck in "Kauf gestartet". These helpers turn that
 * into one obvious log line plus explicit warnings – see docs/05-stripe.md 5.6.
 *
 * They are pure: everything is read from the passed snapshot, so they never
 * change checkout behaviour and live/test flows stay identical.
 */
import { config } from '../config';

export interface StripeStatus {
  enabled: boolean;
  mode: 'live' | 'test' | 'unknown';
  currency: string;
  webhookSecret: string;
  paymentMethods: string[];
  isProd: boolean;
}

/** The current configuration as a snapshot (default input for both helpers). */
export function currentStripeStatus(): StripeStatus {
  return {
    enabled: config.stripe.enabled,
    mode: config.stripe.mode,
    currency: config.stripe.currency,
    webhookSecret: config.stripe.webhookSecret,
    paymentMethods: config.stripe.paymentMethods,
    isProd: config.isProd,
  };
}

/**
 * One-line summary for the startup banner, e.g.
 * `LIVE (CHF) – real payments, webhook configured`.
 */
export function describeStripe(s: StripeStatus = currentStripeStatus()): string {
  if (!s.enabled) return 'manual/test mode (no STRIPE_SECRET_KEY)';
  const mode =
    s.mode === 'live' ? 'LIVE' : s.mode === 'test' ? 'TEST/Sandbox' : 'unknown key type';
  const payments = s.mode === 'live' ? 'real payments' : 'no real payments';
  const webhook = s.webhookSecret ? 'webhook configured' : 'WEBHOOK MISSING';
  return `${mode} (${s.currency.toUpperCase()}) – ${payments}, ${webhook}`;
}

/**
 * Configuration mistakes that silently break real payments. Warnings rather
 * than hard failures: the gallery (photos, logins, admin area) keeps working
 * while the problem is plainly visible in `docker compose logs backend`.
 */
export function stripeWarnings(s: StripeStatus = currentStripeStatus()): string[] {
  const warnings: string[] = [];
  if (!s.enabled) return warnings;

  if (!s.webhookSecret) {
    warnings.push(
      'WARNING: STRIPE_WEBHOOK_SECRET is not set — paid orders stay stuck in ' +
        '"Kauf gestartet" and downloads are never unlocked. See docs/05-stripe.md.',
    );
  }
  if (s.mode === 'test' && s.isProd) {
    warnings.push(
      'WARNING: NODE_ENV=production but STRIPE_SECRET_KEY is a TEST/Sandbox key ' +
        '(sk_test_…) — checkout accepts test cards only and no money is collected. ' +
        'Use the live key from the Stripe Dashboard to go live (docs/05-stripe.md 5.6).',
    );
  }
  if (s.mode === 'unknown') {
    warnings.push(
      'WARNING: STRIPE_SECRET_KEY does not look like a Stripe secret key ' +
        '(expected sk_live_… or sk_test_…) — checkout will fail.',
    );
  }
  if (s.paymentMethods.includes('twint') && s.currency.toLowerCase() !== 'chf') {
    warnings.push(
      `WARNING: TWINT is enabled but CURRENCY=${s.currency} — TWINT only works in ` +
        'CHF and Stripe rejects the checkout session. Set CURRENCY=chf.',
    );
  }
  return warnings;
}
