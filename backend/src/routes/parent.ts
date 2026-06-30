import { Router } from 'express';
import { z } from 'zod';
import { COL, col, getById, runQuery, setById, nowIso } from '../db';
import { config } from '../config';
import { asyncHandler, ApiError } from '../middleware/errorHandler';
import { attachParent, requireParent, PARENT_COOKIE } from '../middleware/parentAuth';
import { verificationLimiter, codeCheckLimiter, reportLimiter } from '../middleware/rateLimit';
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
import { stripExtension } from '../lib/names';
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
  purchasedDigitalPhotoIds,
  cartDigitalPhotoIds,
} from '../services/orders';
import type { ShippingAddress } from '../services/orders';
import { createCheckoutSession } from '../services/payments';
import { sendOrderConfirmation } from '../lib/email';

const router = Router();

// Delivery address for orders that include a print product. Every field is
// required so the printed photos can actually be shipped.
const shippingAddressSchema = z.object({
  firstName: z.string().trim().min(1).max(120),
  lastName: z.string().trim().min(1).max(120),
  street: z.string().trim().min(1).max(200),
  houseNo: z.string().trim().min(1).max(40),
  zip: z.string().trim().min(1).max(20),
  city: z.string().trim().min(1).max(120),
});

function toShippingAddress(input: z.infer<typeof shippingAddressSchema>): ShippingAddress {
  return {
    first_name: input.firstName,
    last_name: input.lastName,
    street: input.street,
    house_no: input.houseNo,
    zip: input.zip,
    city: input.city,
  };
}

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
    const [photos, purchased, inCart] = await Promise.all([
      getVisiblePhotos(req.parent!.emailId),
      purchasedDigitalPhotoIds(req.parent!.emailId),
      cartDigitalPhotoIds(req.parent!.emailId),
    ]);

    // Resolve the (internal) child names so each individual order can be titled
    // "<Auftragstitel> – <Name des Kindes>" (e.g. the event/order name followed
    // by the child's name). A child name is only ever shown for THIS family's
    // own children (those linked to this e-mail); for any other child we fall
    // back to the plain order/event name so no foreign name leaks.
    const linkedRows = await runQuery<{ child_id: string }>(
      col(COL.emailChildren).where('email_id', '==', req.parent!.emailId),
    );
    const linkedChildIds = new Set(linkedRows.map((r) => r.child_id));
    const childIds = [
      ...new Set(photos.map((p) => p.child_id).filter((id): id is string => !!id && linkedChildIds.has(id))),
    ];
    const childNames = new Map<string, string>();
    await Promise.all(
      childIds.map(async (id) => {
        const c = await getById<{ name: string }>(COL.children, id);
        if (c?.name) childNames.set(id, c.name);
      }),
    );

    const toPublic = (p: (typeof photos)[number]) => ({
      id: p.id,
      isClassPhoto: !!p.is_class_photo,
      // Original pixel dimensions so the gallery can present each photo in its
      // true orientation (portrait/landscape) without cropping or layout jumps.
      width: p.width ?? null,
      height: p.height ?? null,
      // Short-lived signed URLs to watermarked variants only. No IDs/paths leak.
      thumbUrl: `/files/preview-image?token=${signFileToken(p.id, 'thumb', 3600)}`,
      previewUrl: `/files/preview-image?token=${signFileToken(p.id, 'preview', 3600)}`,
      // Whether the digital download is already owned / already in the cart, so
      // the UI can prevent buying the same photo a second time.
      purchased: purchased.has(p.id),
      inCart: inCart.has(p.id),
    });

    // Build the presentation groups:
    //  • one section per child ("<Auftragstitel> – <Name>") for that child's own photos
    //  • a single "Gruppenfotos" section pooling every group/class photo of the
    //    family (across all siblings/orders).
    // When two siblings are linked to the same e-mail, the same group photo can
    // exist once per order (separate uploads/records). We de-duplicate those by
    // their original file name so each group photo shows up exactly once.
    type Group = { id: string; title: string; kind: 'order' | 'group'; photos: unknown[] };
    const orderSections = new Map<string, Group>();
    const groupPhotos: unknown[] = [];
    const seenGroupKeys = new Set<string>();

    for (const p of photos) {
      if (p.is_class_photo) {
        const key = (p.original_filename || '').trim().toLowerCase() || `id:${p.id}`;
        if (seenGroupKeys.has(key)) continue;
        seenGroupKeys.add(key);
        groupPhotos.push(toPublic(p));
        continue;
      }
      const sectionKey = p.child_id ? `child:${p.child_id}` : `event:${p.event_id}`;
      let section = orderSections.get(sectionKey);
      if (!section) {
        const childName = p.child_id ? childNames.get(p.child_id) : '';
        const orderTitle = p.event_name || 'Auftrag';
        const title = childName ? `${orderTitle} – ${childName}` : orderTitle;
        section = { id: sectionKey, title, kind: 'order', photos: [] };
        orderSections.set(sectionKey, section);
      }
      section.photos.push(toPublic(p));
    }

    const groups: Group[] = [...orderSections.values()];
    if (groupPhotos.length > 0) {
      groups.push({ id: 'group-photos', title: 'Gruppenfotos', kind: 'group', photos: groupPhotos });
    }

    res.json({ groups });
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
    // Read the cart (and its line items) BEFORE beginCheckout transitions it
    // from status "cart" to "checkout_started". Otherwise getCart would no
    // longer find a cart and silently create a new, empty one, so the Stripe
    // session would be created without line_items.
    const { shippingAddress } = parse(
      z.object({ shippingAddress: shippingAddressSchema.optional() }),
      req.body ?? {},
    );
    const cart = await getCart(req.parent!.emailId);
    const lines = cart.items.map((i) => ({
      name: `${i.product_name}`,
      amountCents: i.unit_price_cents,
      qty: i.qty,
    }));
    const { orderId } = await beginCheckout(
      req.parent!.emailId,
      shippingAddress ? toShippingAddress(shippingAddress) : undefined,
    );

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
        paid_at: order.paid_at,
        shippingAddress: order.shipping_address,
        items: order.items.map((i) => ({
          productName: i.product_name,
          productType: i.product_type,
          childName: i.child_name,
          fileName: stripExtension(i.original_filename),
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
  reportLimiter,
  attachParent,
  asyncHandler(async (req, res) => {
    const { type, message, email } = parse(
      z.object({
        type: z.enum([
          'wrong_photo',
          'missing_photo',
          'wrong_email',
          'link_problem',
          'purchase_problem',
          'allow_additional_email',
          'other',
        ]),
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
  const hasPrint = order.items.some((i) => i.product_type === 'print');
  try {
    await sendOrderConfirmation(email, order.id, summary, link, {
      hasPrint,
      shippingAddress: order.shipping_address,
    });
  } catch {
    /* non fatal */
  }
}

export { sendConfirmationEmail };
export default router;
