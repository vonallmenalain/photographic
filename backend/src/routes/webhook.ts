import { Router, raw } from 'express';
import { config } from '../config';
import { getStripe } from '../services/payments';
import { markOrderPaid, getOrderForEmail } from '../services/orders';
import { COL, getById } from '../db';
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

export default router;
