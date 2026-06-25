import { Router } from 'express';
import { z } from 'zod';
import { COL, col, runQuery, setById, nowIso } from '../db';
import { config } from '../config';
import { asyncHandler, ApiError } from '../middleware/errorHandler';
import { attachParent, requireParent, PARENT_COOKIE } from '../middleware/parentAuth';
import { verificationLimiter, codeCheckLimiter } from '../middleware/rateLimit';
import { clearAuthCookie } from '../lib/cookies';
import { emailSchema, parse } from '../lib/validation';
import { signFileToken } from '../lib/auth';
import { newId } from '../lib/ids';
import {
  requestVerification,
  verifyByCode,
  verifyByLink,
  verifyByFirebaseToken,
  startSession,
  endSession,
} from '../services/verification';
import { getVisiblePhotos } from '../services/access';
import {
  getCart,
  addToCart,
  updateCartItemQty,
  removeFromCart,
  clearCart,
  beginCheckout,
  markOrderPaid,
  getOrderForEmail,
  listOrdersForEmail,
} from '../services/orders';
import { createCheckoutSession } from '../services/payments';
import { sendOrderConfirmation } from '../lib/email';

const router = Router();

// Neutral message that never reveals whether an address exists.
const NEUTRAL_MESSAGE =
  'Falls diese E-Mail-Adresse für Fotos freigeschaltet ist, senden wir Ihnen einen Zugangslink und einen Code.';

interface ProductDoc {
  name: string;
  description: string;
  type: string;
  price_cents: number;
  currency: string;
  active: number;
  sort_order: number;
}

router.get(
  '/products',
  asyncHandler(async (_req, res) => {
    const products = (await runQuery<ProductDoc>(col(COL.products)))
      .filter((p) => p.active === 1)
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      .map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        type: p.type,
        price_cents: p.price_cents,
        currency: p.currency,
      }));
    res.json({ products });
  }),
);

// --- Verification --------------------------------------------------------
router.post(
  '/request-code',
  verificationLimiter,
  asyncHandler(async (req, res) => {
    const email = parse(z.object({ email: emailSchema }), req.body).email;
    await requestVerification(email);
    res.json({ message: NEUTRAL_MESSAGE });
  }),
);

router.post(
  '/verify-code',
  codeCheckLimiter,
  asyncHandler(async (req, res) => {
    const { email, code } = parse(
      z.object({ email: emailSchema, code: z.string().trim().regex(/^\d{4,8}$/, 'Ungültiger Code.') }),
      req.body,
    );
    const result = await verifyByCode(email, code);
    if (!result.ok || !result.emailId) {
      throw new ApiError(400, 'Der Code ist ungültig oder abgelaufen.');
    }
    await startSession(res, result.emailId, req.headers['user-agent'] ?? '');
    res.json({ verified: true, email: result.email });
  }),
);

router.post(
  '/verify-link',
  codeCheckLimiter,
  asyncHandler(async (req, res) => {
    const { token } = parse(z.object({ token: z.string().min(10) }), req.body);
    const result = await verifyByLink(token);
    if (!result.ok || !result.emailId) {
      throw new ApiError(400, 'Dieser Bestätigungslink ist ungültig oder abgelaufen.');
    }
    await startSession(res, result.emailId, req.headers['user-agent'] ?? '');
    res.json({ verified: true, email: result.email });
  }),
);

// Firebase Authentication: exchange a verified Firebase ID token for a session.
router.post(
  '/firebase-session',
  codeCheckLimiter,
  asyncHandler(async (req, res) => {
    if (!config.firebase.parentAuthEnabled) {
      throw new ApiError(400, 'Firebase-Anmeldung ist nicht aktiviert.');
    }
    const { idToken } = parse(z.object({ idToken: z.string().min(20) }), req.body);
    const result = await verifyByFirebaseToken(idToken);
    if (!result.ok || !result.emailId) {
      throw new ApiError(400, 'Die Anmeldung konnte nicht bestätigt werden.');
    }
    await startSession(res, result.emailId, req.headers['user-agent'] ?? '');
    res.json({ verified: true, email: result.email });
  }),
);

router.get(
  '/session',
  attachParent,
  asyncHandler(async (req, res) => {
    if (!req.parent) {
      res.json({ verified: false });
      return;
    }
    res.json({ verified: true, email: req.parent.email });
  }),
);

router.post(
  '/logout',
  attachParent,
  asyncHandler(async (req, res) => {
    if (req.parent) await endSession(req.parent.sessionId);
    clearAuthCookie(res, PARENT_COOKIE);
    res.json({ ok: true });
  }),
);

// --- Photos (only visible, published, linked) ----------------------------
router.get(
  '/photos',
  requireParent,
  asyncHandler(async (req, res) => {
    const photos = await getVisiblePhotos(req.parent!.emailId);
    // Group by event for a calm presentation.
    const eventsMap = new Map<string, { id: string; name: string; photos: unknown[] }>();
    for (const p of photos) {
      if (!eventsMap.has(p.event_id)) {
        eventsMap.set(p.event_id, { id: p.event_id, name: p.event_name, photos: [] });
      }
      eventsMap.get(p.event_id)!.photos.push({
        id: p.id,
        isClassPhoto: !!p.is_class_photo,
        // Short-lived signed URLs to watermarked variants only. No IDs/paths leak.
        thumbUrl: `/files/preview-image?token=${signFileToken(p.id, 'thumb', 3600)}`,
        previewUrl: `/files/preview-image?token=${signFileToken(p.id, 'preview', 3600)}`,
      });
    }
    res.json({ events: Array.from(eventsMap.values()) });
  }),
);

// --- Cart ----------------------------------------------------------------
router.get(
  '/cart',
  requireParent,
  asyncHandler(async (req, res) => {
    const cart = await getCart(req.parent!.emailId);
    res.json({
      cart: {
        total_cents: cart.total_cents,
        currency: cart.currency,
        items: cart.items.map((i) => ({
          id: i.id,
          photoId: i.photo_id,
          productId: i.product_id,
          productName: i.product_name,
          productType: i.product_type,
          qty: i.qty,
          unitPriceCents: i.unit_price_cents,
          thumbUrl: `/files/preview-image?token=${signFileToken(i.photo_id, 'thumb', 3600)}`,
        })),
      },
    });
  }),
);

router.post(
  '/cart',
  requireParent,
  asyncHandler(async (req, res) => {
    const { photoId, productId, qty } = parse(
      z.object({ photoId: z.string(), productId: z.string(), qty: z.number().int().min(1).max(99).default(1) }),
      req.body,
    );
    await addToCart(req.parent!.emailId, photoId, productId, qty);
    res.json({ ok: true });
  }),
);

router.patch(
  '/cart/:itemId',
  requireParent,
  asyncHandler(async (req, res) => {
    const { qty } = parse(z.object({ qty: z.number().int().min(1).max(99) }), req.body);
    await updateCartItemQty(req.parent!.emailId, req.params.itemId, qty);
    res.json({ ok: true });
  }),
);

router.delete(
  '/cart/:itemId',
  requireParent,
  asyncHandler(async (req, res) => {
    await removeFromCart(req.parent!.emailId, req.params.itemId);
    res.json({ ok: true });
  }),
);

router.post(
  '/cart/clear',
  requireParent,
  asyncHandler(async (req, res) => {
    await clearCart(req.parent!.emailId);
    res.json({ ok: true });
  }),
);

// --- Checkout ------------------------------------------------------------
router.post(
  '/checkout',
  requireParent,
  asyncHandler(async (req, res) => {
    const { orderId } = await beginCheckout(req.parent!.emailId);
    const cart = await getCart(req.parent!.emailId);
    const lines = cart.items.map((i) => ({
      name: `${i.product_name}`,
      amountCents: i.unit_price_cents,
      qty: i.qty,
    }));

    const url = await createCheckoutSession({ orderId, email: req.parent!.email, lines });
    if (url) {
      res.json({ mode: 'stripe', checkoutUrl: url, orderId });
      return;
    }
    // No payment provider configured: manual confirmation flow (test/dev).
    res.json({ mode: 'manual', orderId });
  }),
);

// Manual confirmation – only allowed when Stripe is NOT configured.
router.post(
  '/checkout/confirm',
  requireParent,
  asyncHandler(async (req, res) => {
    if (config.stripe.enabled) {
      throw new ApiError(400, 'Bitte schließe die Zahlung über den bereitgestellten Bezahllink ab.');
    }
    const { orderId } = parse(z.object({ orderId: z.string() }), req.body);
    const order = await getOrderForEmail(req.parent!.emailId, orderId);
    if (!order) throw new ApiError(404, 'Bestellung nicht gefunden.');
    await markOrderPaid(orderId, 'manual', 'manual-confirm');
    const final = (await getOrderForEmail(req.parent!.emailId, orderId))!;
    await sendConfirmationEmail(req.parent!.email, final);
    res.json({ ok: true, orderId });
  }),
);

// --- Orders --------------------------------------------------------------
router.get(
  '/orders',
  requireParent,
  asyncHandler(async (req, res) => {
    res.json({ orders: await listOrdersForEmail(req.parent!.emailId) });
  }),
);

router.get(
  '/orders/:id',
  requireParent,
  asyncHandler(async (req, res) => {
    const order = await getOrderForEmail(req.parent!.emailId, req.params.id);
    if (!order) throw new ApiError(404, 'Bestellung nicht gefunden.');
    res.json({
      order: {
        id: order.id,
        status: order.status,
        currency: order.currency,
        total_cents: order.total_cents,
        created_at: order.created_at,
        items: order.items.map((i) => ({
          productName: i.product_name,
          productType: i.product_type,
          childName: i.child_name,
          qty: i.qty,
          unitPriceCents: i.unit_price_cents,
          thumbUrl: `/files/preview-image?token=${signFileToken(i.photo_id, 'thumb', 3600)}`,
          downloadUrl:
            i.product_type === 'digital' && i.download_token
              ? `/files/download/${i.download_token}`
              : null,
        })),
      },
    });
  }),
);

// --- Report a problem (Meldefunktion) ------------------------------------
router.post(
  '/report',
  attachParent,
  asyncHandler(async (req, res) => {
    const { type, message, email } = parse(
      z.object({
        type: z.enum(['wrong_photo', 'missing_photo', 'wrong_email', 'link_problem', 'purchase_problem', 'other']),
        message: z.string().trim().min(1).max(2000),
        email: emailSchema.optional(),
      }),
      req.body,
    );
    await setById(COL.reports, newId('rep'), {
      email_id: req.parent?.emailId ?? null,
      email_text: email ?? req.parent?.email ?? '',
      type,
      message,
      status: 'open',
      created_at: nowIso(),
    });
    res.json({ message: 'Danke, Ihre Meldung ist bei uns eingegangen. Wir melden uns bei Ihnen.' });
  }),
);

function formatMoney(cents: number, currency: string): string {
  const code = currency.toUpperCase();
  if (code === 'CHF') {
    const hasRappen = Math.round(cents) % 100 !== 0;
    const francs = Math.round(cents) / 100;
    return hasRappen ? `${francs.toFixed(2)} CHF` : `${Math.round(francs)}.- CHF`;
  }
  return `${(cents / 100).toFixed(2)} ${code}`;
}

async function sendConfirmationEmail(email: string, order: NonNullable<Awaited<ReturnType<typeof getOrderForEmail>>>) {
  const summary = order.items
    .map((i) => `• ${i.qty}× ${i.product_name} – ${formatMoney(i.unit_price_cents, order.currency)}`)
    .join('\n');
  const link = `${config.publicAppUrl}/bestellung/${order.id}`;
  try {
    await sendOrderConfirmation(email, order.id, summary, link);
  } catch {
    /* non fatal */
  }
}

export { sendConfirmationEmail };
export default router;
