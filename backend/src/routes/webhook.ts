import { Router, raw } from 'express';
import { config } from '../config';
import { getStripe } from '../services/payments';
import { markOrderPaid, getOrderForEmail } from '../services/orders';
import { COL, getById } from '../db';
import { sendConfirmationEmail } from './parent';
import { verifySvixSignature } from '../lib/resendWebhook';
import { recordResendEvent } from '../services/mailDelivery';

const router = Router();

/**
 * Stripe webhook. Must receive the raw body to verify the signature. Mounted
 * before the JSON body parser in index.ts.
 */
router.post('/stripe', raw({ type: 'application/json' }), async (req, res) => {
  const stripe = getStripe();
  if (!stripe || !config.stripe.webhookSecret) {
    res.status(400).send('Stripe not configured');
    return;
  }
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig as string, config.stripe.webhookSecret);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[stripe] signature verification failed', err);
    res.status(400).send('Invalid signature');
    return;
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as { id: string; metadata?: { orderId?: string } };
    const orderId = session.metadata?.orderId;
    if (orderId) {
      await markOrderPaid(orderId, 'stripe', session.id);
      try {
        const order = await getById<{ email_id: string }>(COL.orders, orderId);
        if (order) {
          const parentEmail = await getById<{ email: string }>(COL.parentEmails, order.email_id);
          const detail = await getOrderForEmail(order.email_id, orderId);
          if (parentEmail && detail) await sendConfirmationEmail(parentEmail.email, detail);
        }
      } catch {
        /* non fatal */
      }
    }
  }

  res.json({ received: true });
});

/**
 * Resend-Webhook: meldet den Zustellstatus der verschickten E-Mails (gesendet,
 * zugestellt, verzögert, unzustellbar, Spam-Beschwerde, fehlgeschlagen). Auch
 * hier ist der rohe Body nötig, weil die Signatur (Svix) darüber gebildet wird.
 * Einrichtung: docs/04-email-smtp.md, Abschnitt 4.6.
 */
router.post('/resend', raw({ type: () => true }), async (req, res) => {
  if (!config.resend.webhookSecret) {
    res.status(400).send('Resend webhook not configured');
    return;
  }
  const body = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
  const header = (name: string): string | undefined => {
    const value = req.headers[name];
    return Array.isArray(value) ? value[0] : value;
  };
  const valid = verifySvixSignature(
    config.resend.webhookSecret,
    {
      id: header('svix-id'),
      timestamp: header('svix-timestamp'),
      signature: header('svix-signature'),
    },
    body,
  );
  if (!valid) {
    // eslint-disable-next-line no-console
    console.error('[resend] webhook signature verification failed');
    res.status(400).send('Invalid signature');
    return;
  }

  let event: unknown;
  try {
    event = JSON.parse(body);
  } catch {
    res.status(400).send('Invalid JSON');
    return;
  }

  try {
    const result = await recordResendEvent(event);
    res.json({ received: true, handled: result.handled });
  } catch (err) {
    // Resend wiederholt Zustellungen bei 5xx – ein Datenbankfehler soll also
    // zu einem erneuten Versuch führen.
    // eslint-disable-next-line no-console
    console.error('[resend] could not process webhook event', err);
    res.status(500).send('Could not process event');
  }
});

export default router;
