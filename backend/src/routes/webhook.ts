import { Router, raw } from 'express';
import { config } from '../config';
import { getStripe } from '../services/payments';
import { markOrderPaid, getOrderForEmail } from '../services/orders';
import { getDb } from '../db';
import { sendConfirmationEmail } from './parent';

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
      markOrderPaid(orderId, 'stripe', session.id);
      try {
        const db = getDb();
        const row = db
          .prepare('SELECT e.email, e.id FROM orders o JOIN parent_emails e ON e.id = o.email_id WHERE o.id = ?')
          .get(orderId) as { email: string; id: string } | undefined;
        if (row) {
          const order = getOrderForEmail(row.id, orderId);
          if (order) await sendConfirmationEmail(row.email, order);
        }
      } catch {
        /* non fatal */
      }
    }
  }

  res.json({ received: true });
});

export default router;
