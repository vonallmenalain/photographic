import Stripe from 'stripe';
import { config } from '../config';

let stripe: Stripe | null = null;

export function getStripe(): Stripe | null {
  if (!config.stripe.enabled) return null;
  if (stripe) return stripe;
  // Pin via cast so we are not coupled to the exact apiVersion literal the
  // installed @types/stripe expects.
  stripe = new Stripe(config.stripe.secretKey, {
    apiVersion: (process.env.STRIPE_API_VERSION || undefined) as Stripe.LatestApiVersion | undefined,
  });
  return stripe;
}

export interface CheckoutLine {
  name: string;
  amountCents: number;
  qty: number;
}

/**
 * Creates a Stripe Checkout session. Returns the redirect URL. If Stripe is not
 * configured this returns null and the caller falls back to a manual flow.
 */
export async function createCheckoutSession(args: {
  orderId: string;
  email: string;
  lines: CheckoutLine[];
}): Promise<string | null> {
  const s = getStripe();
  if (!s) return null;

  const session = await s.checkout.sessions.create({
    mode: 'payment',
    customer_email: args.email,
    line_items: args.lines.map((l) => ({
      quantity: l.qty,
      price_data: {
        currency: config.stripe.currency,
        unit_amount: l.amountCents,
        product_data: { name: l.name },
      },
    })),
    metadata: { orderId: args.orderId },
    success_url: `${config.publicAppUrl}/bestellung/${args.orderId}?status=success`,
    cancel_url: `${config.publicAppUrl}/warenkorb?status=cancelled`,
  });

  return session.url;
}
