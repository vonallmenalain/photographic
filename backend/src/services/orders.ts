import {
  COL,
  col,
  getById,
  firstOf,
  runQuery,
  setById,
  updateById,
  deleteById,
  deleteWhere,
  nowIso,
} from '../db';
import { newId, randomToken } from '../lib/ids';
import { ApiError } from '../middleware/errorHandler';
import { canEmailSeePhoto } from './access';
import {
  lineTotalCents,
  productAllowedForPhoto,
  productView,
  type ProductDoc,
  type ProductKind,
  type ProductType,
  type ProductView,
} from './products';

export interface CartLine {
  id: string;
  photo_id: string;
  product_id: string;
  product_name: string;
  product_type: ProductType;
  product_kind: ProductKind;
  /** Whether the line includes the digital file (photo prints). */
  includes_digital: boolean;
  qty: number;
  /** Price of the first unit. */
  unit_price_cents: number;
  /** Price of every further unit (null → same as the unit price). */
  additional_price_cents: number | null;
  /** Total of the line with tiered pricing applied. */
  line_total_cents: number;
  storage_key: string;
  ext: string;
}

export interface ShippingAddress {
  first_name: string;
  last_name: string;
  street: string;
  house_no: string;
  zip: string;
  city: string;
}

interface OrderDoc {
  email_id: string;
  status: string;
  currency: string;
  total_cents: number;
  payment_provider?: string;
  payment_ref?: string;
  shipping_address?: ShippingAddress | null;
  created_at: string;
  // Zeitpunkt der erfolgreichen Zahlung (gesetzt in markOrderPaid). Vor der
  // Zahlung nicht vorhanden.
  paid_at?: string | null;
  // Zeitpunkt, an dem die Bestellung auf "Abgeschlossen" gestellt wurde. Bei
  // Bestellungen mit Druckprodukt entspricht das dem Versand der ausgedruckten
  // Bilder. Vor dem Abschluss nicht vorhanden.
  completed_at?: string | null;
  updated_at: string;
}

/**
 * The statuses that make an order a real, customer-facing purchase.
 *
 * `cart` and `checkout_started` are internal stages of the shopping flow: an
 * open cart, and a checkout the parent started but has not paid (they closed
 * the Stripe page, went back, or the payment failed). Neither is a purchase, so
 * neither is ever listed or counted anywhere — not for the parent, not for the
 * admin.
 */
export const REAL_ORDER_STATUSES = ['pending', 'completed', 'cancelled'] as const;

/** Whether an order status is a real purchase rather than an internal stage. */
export function isRealOrder(status: string): boolean {
  return (REAL_ORDER_STATUSES as readonly string[]).includes(status);
}

/** A shipping address is only usable when every field is filled in. */
export function isCompleteAddress(a?: ShippingAddress | null): a is ShippingAddress {
  if (!a) return false;
  return (
    !!a.first_name?.trim() &&
    !!a.last_name?.trim() &&
    !!a.street?.trim() &&
    !!a.house_no?.trim() &&
    !!a.zip?.trim() &&
    !!a.city?.trim()
  );
}

/**
 * Order line as stored in Firestore. Besides the product reference the line
 * carries a snapshot of everything the price and the fulfilment depend on
 * (type, kind, "digital included", unit + additional price), so later changes
 * to the product catalogue never alter existing orders. Older lines only have
 * `unit_price_cents`/`qty` – every reader falls back to the product document
 * and to `unit × qty` for those.
 */
export interface OrderItemDoc {
  order_id: string;
  /**
   * Id of the cart line this order line was copied from (see beginCheckout).
   * Lets a successful payment remove exactly the lines that were bought.
   * Absent on cart lines themselves and on orders from before the copy-on-
   * checkout change.
   */
  cart_item_id?: string | null;
  photo_id: string;
  product_id: string;
  qty: number;
  unit_price_cents: number;
  additional_price_cents?: number | null;
  line_total_cents?: number;
  product_name: string;
  product_type?: string;
  product_kind?: string;
  includes_digital?: number;
  created_at: string;
}

interface PhotoLite {
  storage_key: string;
  ext: string;
  child_id?: string | null;
  is_class_photo?: number;
  original_filename?: string;
}

/** Resolved facts about an order line, using the snapshot first and the product as fallback. */
export interface ResolvedLine {
  type: ProductType;
  kind: ProductKind;
  includes_digital: boolean;
  additional_price_cents: number | null;
  line_total_cents: number;
}

export function resolveLine(
  item: Pick<
    OrderItemDoc,
    | 'qty'
    | 'unit_price_cents'
    | 'additional_price_cents'
    | 'line_total_cents'
    | 'product_type'
    | 'product_kind'
    | 'includes_digital'
  >,
  product: ProductView | null,
): ResolvedLine {
  const type: ProductType =
    item.product_type === 'print' || item.product_type === 'digital'
      ? item.product_type
      : (product?.type ?? 'digital');
  const kind: ProductKind = (
    ['digital', 'photo', 'sticker', 'magnet'].includes(String(item.product_kind ?? ''))
      ? item.product_kind
      : (product?.kind ?? (type === 'digital' ? 'digital' : 'photo'))
  ) as ProductKind;
  const includesDigital =
    item.includes_digital !== undefined
      ? Number(item.includes_digital) === 1
      : (product?.includes_digital ?? false);
  const additional =
    typeof item.additional_price_cents === 'number'
      ? item.additional_price_cents
      : item.additional_price_cents === null
        ? null
        : (product?.additional_price_cents ?? null);
  const lineTotal =
    typeof item.line_total_cents === 'number'
      ? item.line_total_cents
      : lineTotalCents(item.unit_price_cents ?? 0, additional, item.qty ?? 0);
  return {
    type,
    kind,
    includes_digital: type === 'print' && includesDigital,
    additional_price_cents: additional,
    line_total_cents: lineTotal,
  };
}

/** Total of a stored line (tiered) with a `unit × qty` fallback for legacy lines. */
export function itemTotalCents(
  item: Pick<OrderItemDoc, 'qty' | 'unit_price_cents' | 'line_total_cents'>,
): number {
  if (typeof item.line_total_cents === 'number') return item.line_total_cents;
  return (item.unit_price_cents ?? 0) * (item.qty ?? 0);
}

async function loadProduct(productId: string): Promise<ProductView | null> {
  const doc = await getById<ProductDoc>(COL.products, productId);
  return doc ? productView(doc) : null;
}

async function getOrCreateCart(emailId: string): Promise<string> {
  const existing = await firstOf<OrderDoc>(
    col(COL.orders).where('email_id', '==', emailId).where('status', '==', 'cart'),
  );
  if (existing) return existing.id;
  const id = newId('ord');
  await setById(COL.orders, id, {
    email_id: emailId,
    status: 'cart',
    currency: 'chf',
    total_cents: 0,
    created_at: nowIso(),
    updated_at: nowIso(),
  });
  return id;
}

async function itemsForOrder(orderId: string) {
  return runQuery<OrderItemDoc>(col(COL.orderItems).where('order_id', '==', orderId));
}

export async function getCart(
  emailId: string,
): Promise<{ id: string; items: CartLine[]; total_cents: number; currency: string }> {
  const cartId = await getOrCreateCart(emailId);
  const rawItems = await itemsForOrder(cartId);

  const items: CartLine[] = [];
  for (const oi of rawItems) {
    const [product, photo] = await Promise.all([
      loadProduct(oi.product_id),
      getById<PhotoLite>(COL.photos, oi.photo_id),
    ]);
    const line = resolveLine(oi, product);
    items.push({
      id: oi.id,
      photo_id: oi.photo_id,
      product_id: oi.product_id,
      product_name: oi.product_name,
      product_type: line.type,
      product_kind: line.kind,
      includes_digital: line.includes_digital,
      qty: oi.qty,
      unit_price_cents: oi.unit_price_cents,
      additional_price_cents: line.additional_price_cents,
      line_total_cents: line.line_total_cents,
      storage_key: photo?.storage_key ?? '',
      ext: photo?.ext ?? 'jpg',
    });
  }

  const total = items.reduce((sum, i) => sum + i.line_total_cents, 0);
  const order = await getById<OrderDoc>(COL.orders, cartId);
  return { id: cartId, items, total_cents: total, currency: order?.currency ?? 'chf' };
}

/**
 * Whether the e-mail already owns a digital download for this photo. A download
 * grant is created the moment a digital item (or a print that includes the
 * digital file) is paid, so its existence means the photo can already be
 * downloaded under "Bestellungen".
 */
export async function hasDigitalPurchase(emailId: string, photoId: string): Promise<boolean> {
  const grant = await firstOf(
    col(COL.downloadGrants)
      .where('email_id', '==', emailId)
      .where('photo_id', '==', photoId),
  );
  return !!grant;
}

/** The lines of a cart that belong to one photo, with their resolved product facts. */
async function cartLinesForPhoto(
  cartId: string,
  photoId: string,
): Promise<{ item: (OrderItemDoc & { id: string }); line: ResolvedLine }[]> {
  const lines = await runQuery<OrderItemDoc>(
    col(COL.orderItems).where('order_id', '==', cartId).where('photo_id', '==', photoId),
  );
  const out: { item: (OrderItemDoc & { id: string }); line: ResolvedLine }[] = [];
  for (const item of lines) {
    const product = await loadProduct(item.product_id);
    out.push({ item, line: resolveLine(item, product) });
  }
  return out;
}

export interface AddToCartResult {
  /**
   * True when a separate "Nur digital" line for the same photo was removed
   * because the print that was just added already includes the digital file.
   */
  removedDigital: boolean;
}

export async function addToCart(
  emailId: string,
  photoId: string,
  productId: string,
  qty = 1,
): Promise<AddToCartResult> {
  if (!(await canEmailSeePhoto(emailId, photoId))) {
    // Do not reveal whether the photo exists.
    throw new ApiError(403, 'Dieses Foto ist für Sie nicht verfügbar.');
  }
  const product = await loadProduct(productId);
  if (!product || !product.active) {
    throw new ApiError(400, 'Dieses Produkt ist nicht verfügbar.');
  }
  // Stickers/magnets are only offered for individual portraits – never for
  // group/class photos (and vice versa for group-only products).
  const photo = await getById<PhotoLite>(COL.photos, photoId);
  const isClassPhoto = Number(photo?.is_class_photo) === 1;
  if (!productAllowedForPhoto(product, isClassPhoto)) {
    throw new ApiError(
      400,
      isClassPhoto
        ? 'Dieses Produkt gibt es nur für Einzelfotos, nicht für Gruppenfotos.'
        : 'Dieses Produkt gibt es nur für Gruppenfotos.',
    );
  }

  const cartId = await getOrCreateCart(emailId);
  const existingLines = await cartLinesForPhoto(cartId, photoId);
  const digitalCovered = existingLines.some(
    ({ line }) => line.type === 'digital' || line.includes_digital,
  );

  // A digital download is unique per photo: it can be bought at most once and
  // never added twice. Block when the photo was already purchased (downloadable
  // under "Bestellungen"), is already in the cart as a download, or is already
  // covered by a print in the cart that includes the digital file.
  if (product.type === 'digital') {
    if (await hasDigitalPurchase(emailId, photoId)) {
      throw new ApiError(
        409,
        'Dieses Foto haben Sie bereits als digitalen Download gekauft. Sie finden es unter „Bestellungen“.',
      );
    }
    if (existingLines.some(({ line }) => line.type === 'digital')) {
      throw new ApiError(
        409,
        'Dieses Foto liegt bereits als digitaler Download in Ihrem Warenkorb.',
      );
    }
    if (digitalCovered) {
      throw new ApiError(
        409,
        'Die digitale Datei dieses Fotos ist im Druck in Ihrem Warenkorb bereits inbegriffen.',
      );
    }
    await setById(COL.orderItems, newId('oi'), {
      order_id: cartId,
      photo_id: photoId,
      product_id: productId,
      qty: 1,
      unit_price_cents: product.price_cents,
      additional_price_cents: null,
      line_total_cents: product.price_cents,
      product_name: product.name,
      product_type: product.type,
      product_kind: product.kind,
      includes_digital: 0,
      created_at: nowIso(),
    });
    await recalcTotal(cartId);
    return { removedDigital: false };
  }

  // Physical products (prints, stickers, magnets) may be ordered in multiples;
  // merge with an existing line of the same photo + product.
  const quantity = Math.max(1, Math.floor(qty));
  const existing = existingLines.find(({ item }) => item.product_id === productId)?.item;
  if (existing) {
    const nextQty = existing.qty + quantity;
    await updateById(COL.orderItems, existing.id, {
      qty: nextQty,
      line_total_cents: lineTotalCents(
        existing.unit_price_cents,
        resolveLine(existing, product).additional_price_cents,
        nextQty,
      ),
    });
  } else {
    await setById(COL.orderItems, newId('oi'), {
      order_id: cartId,
      photo_id: photoId,
      product_id: productId,
      qty: quantity,
      unit_price_cents: product.price_cents,
      additional_price_cents: product.additional_price_cents,
      line_total_cents: lineTotalCents(
        product.price_cents,
        product.additional_price_cents,
        quantity,
      ),
      product_name: product.name,
      product_type: product.type,
      product_kind: product.kind,
      includes_digital: product.includes_digital ? 1 : 0,
      created_at: nowIso(),
    });
  }

  // A print that includes the digital file makes a separate "Nur digital" line
  // of the same photo redundant – drop it so the parent never pays twice.
  let removedDigital = false;
  if (product.includes_digital) {
    for (const { item, line } of existingLines) {
      if (line.type !== 'digital') continue;
      await deleteById(COL.orderItems, item.id);
      removedDigital = true;
    }
  }

  await recalcTotal(cartId);
  return { removedDigital };
}

/** Photo ids the e-mail already owns as a digital download (download grants). */
export async function purchasedDigitalPhotoIds(emailId: string): Promise<Set<string>> {
  const grants = await runQuery<{ photo_id: string }>(
    col(COL.downloadGrants).where('email_id', '==', emailId),
  );
  return new Set(grants.map((g) => g.photo_id));
}

export interface CartPhotoState {
  /** Number of cart lines for the photo (any product). */
  lines: number;
  /** Whether the digital file is covered: a download line or a print that includes it. */
  digital: boolean;
}

/** Per photo: what is currently in the e-mail's cart. */
export async function cartPhotoStates(emailId: string): Promise<Map<string, CartPhotoState>> {
  const out = new Map<string, CartPhotoState>();
  const cart = await firstOf<OrderDoc>(
    col(COL.orders).where('email_id', '==', emailId).where('status', '==', 'cart'),
  );
  if (!cart) return out;
  const lines = await runQuery<OrderItemDoc>(
    col(COL.orderItems).where('order_id', '==', cart.id),
  );
  const productCache = new Map<string, ProductView | null>();
  for (const line of lines) {
    let product = productCache.get(line.product_id);
    if (product === undefined) {
      product = await loadProduct(line.product_id);
      productCache.set(line.product_id, product);
    }
    const resolved = resolveLine(line, product);
    const state = out.get(line.photo_id) ?? { lines: 0, digital: false };
    state.lines += 1;
    if (resolved.type === 'digital' || resolved.includes_digital) state.digital = true;
    out.set(line.photo_id, state);
  }
  return out;
}

/** Photo ids whose digital file is covered by the cart (download or print incl. digital). */
export async function cartDigitalPhotoIds(emailId: string): Promise<Set<string>> {
  const states = await cartPhotoStates(emailId);
  return new Set([...states.entries()].filter(([, s]) => s.digital).map(([id]) => id));
}

export async function updateCartItemQty(
  emailId: string,
  itemId: string,
  qty: number,
): Promise<void> {
  const cartId = await getOrCreateCart(emailId);
  const item = await getById<OrderItemDoc>(COL.orderItems, itemId);
  if (!item || item.order_id !== cartId) {
    throw new ApiError(404, 'Dieser Artikel ist nicht in Ihrem Warenkorb.');
  }
  const product = await loadProduct(item.product_id);
  const line = resolveLine(item, product);
  // Digital downloads exist exactly once per photo – the quantity is fixed.
  const nextQty = line.type === 'digital' ? 1 : Math.max(1, Math.floor(qty));
  await updateById(COL.orderItems, itemId, {
    qty: nextQty,
    line_total_cents: lineTotalCents(item.unit_price_cents, line.additional_price_cents, nextQty),
  });
  await recalcTotal(cartId);
}

export async function removeFromCart(emailId: string, itemId: string): Promise<void> {
  const cartId = await getOrCreateCart(emailId);
  const item = await getById<OrderItemDoc>(COL.orderItems, itemId);
  if (item && item.order_id === cartId) {
    await deleteById(COL.orderItems, itemId);
  }
  await recalcTotal(cartId);
}

export async function clearCart(emailId: string): Promise<void> {
  const cartId = await getOrCreateCart(emailId);
  await deleteWhere(col(COL.orderItems).where('order_id', '==', cartId));
  await recalcTotal(cartId);
}

async function recalcTotal(orderId: string): Promise<void> {
  const items = await itemsForOrder(orderId);
  const total = items.reduce((sum, i) => sum + itemTotalCents(i), 0);
  await updateById(COL.orders, orderId, { total_cents: total, updated_at: nowIso() });
}

/**
 * Snapshots the cart into a new order that is ready for payment.
 *
 * The cart is **copied, not consumed**: it keeps its own document and lines for
 * the whole payment. Going back from the payment page therefore leaves the
 * warenkorb exactly as it was, and only a successful payment empties the bought
 * lines out of it (see markOrderPaid). Copying also freezes what is being paid
 * for — editing the cart while the Stripe page is open can no longer change the
 * order Stripe is charging for.
 */
export async function beginCheckout(
  emailId: string,
  shippingAddress?: ShippingAddress | null,
): Promise<{ orderId: string; total_cents: number; currency: string }> {
  const cart = await getCart(emailId);
  if (cart.items.length === 0) throw new ApiError(400, 'Ihr Warenkorb ist leer.');

  // Orders containing a physical product (print, sticker sheet, magnet set)
  // require a complete delivery address so it can be shipped. Digital-only
  // orders never need one.
  const hasPrint = cart.items.some((i) => i.product_type === 'print');
  let address: ShippingAddress | null = null;
  if (hasPrint) {
    if (!isCompleteAddress(shippingAddress)) {
      throw new ApiError(
        400,
        'Für Fotos zum Ausdrucken wird eine vollständige Lieferadresse benötigt.',
      );
    }
    address = normalizeAddress(shippingAddress);
  } else if (isCompleteAddress(shippingAddress)) {
    address = normalizeAddress(shippingAddress);
  }

  const now = nowIso();
  const orderId = newId('ord');
  await setById(COL.orders, orderId, {
    email_id: emailId,
    status: 'checkout_started',
    currency: cart.currency,
    total_cents: cart.total_cents,
    shipping_address: address,
    created_at: now,
    updated_at: now,
  });

  // `cart_item_id` remembers where each line came from, so the payment removes
  // exactly what was bought and anything added afterwards stays in the cart.
  for (const line of cart.items) {
    await setById(COL.orderItems, newId('oi'), {
      order_id: orderId,
      cart_item_id: line.id,
      photo_id: line.photo_id,
      product_id: line.product_id,
      qty: line.qty,
      unit_price_cents: line.unit_price_cents,
      additional_price_cents: line.additional_price_cents,
      line_total_cents: line.line_total_cents,
      product_name: line.product_name,
      product_type: line.product_type,
      product_kind: line.product_kind,
      includes_digital: line.includes_digital ? 1 : 0,
      created_at: now,
    });
  }

  return { orderId, total_cents: cart.total_cents, currency: cart.currency };
}

/**
 * Removes the cart lines a paid order was built from. Called once the payment
 * succeeded — until then the cart stays untouched, so an abandoned checkout
 * costs the parent nothing. Lines added after the checkout started carry a
 * different id and survive.
 */
async function clearPurchasedCartLines(
  emailId: string,
  orderItems: OrderItemDoc[],
): Promise<void> {
  const sourceIds = orderItems
    .map((i) => i.cart_item_id)
    .filter((id): id is string => typeof id === 'string' && !!id);
  if (sourceIds.length === 0) return;

  const cart = await firstOf<OrderDoc>(
    col(COL.orders).where('email_id', '==', emailId).where('status', '==', 'cart'),
  );
  if (!cart) return;

  let removed = 0;
  for (const id of sourceIds) {
    const item = await getById<OrderItemDoc>(COL.orderItems, id);
    // Only ever touch lines that are still in this parent's own cart.
    if (!item || item.order_id !== cart.id) continue;
    await deleteById(COL.orderItems, id);
    removed += 1;
  }
  if (removed > 0) await recalcTotal(cart.id);
}

function normalizeAddress(a: ShippingAddress): ShippingAddress {
  return {
    first_name: a.first_name.trim(),
    last_name: a.last_name.trim(),
    street: a.street.trim(),
    house_no: a.house_no.trim(),
    zip: a.zip.trim(),
    city: a.city.trim(),
  };
}

/**
 * Marks an order as paid and creates download grants for every line that
 * carries the digital file: "Nur digital" downloads as well as photo prints
 * that include the digital file.
 *
 * The order's final status is reduced to the simplified life cycle used across
 * the admin tools:
 *   - `pending`   – the order contains a physical product that still has to be
 *                   produced/shipped (auto-set on payment, can later be moved
 *                   to `completed` by hand).
 *   - `completed` – purely digital orders are done the moment they are paid.
 *   - `cancelled` – only ever set manually.
 */
export async function markOrderPaid(orderId: string, provider: string, ref: string): Promise<void> {
  const order = await getById<OrderDoc>(COL.orders, orderId);
  if (!order) {
    // A payment without an order to book it on must never pass silently: it
    // means money was taken and nothing was unlocked.
    // eslint-disable-next-line no-console
    console.error(
      `[orders] payment for unknown order ${orderId} (provider=${provider}, ref=${ref}) — ` +
        'nothing was unlocked, handle this manually.',
    );
    return;
  }
  // Already in a final state – nothing to do.
  if (isRealOrder(order.status)) return;

  const items = await itemsForOrder(orderId);
  let hasPrint = false;
  for (const item of items) {
    const product = await loadProduct(item.product_id);
    const line = resolveLine(item, product);
    if (line.type === 'print') hasPrint = true;
    const grantsDigital = line.type === 'digital' || line.includes_digital;
    if (!grantsDigital) continue;
    const grant = await firstOf(
      col(COL.downloadGrants)
        .where('order_id', '==', orderId)
        .where('photo_id', '==', item.photo_id),
    );
    if (grant) continue;
    await setById(COL.downloadGrants, newId('dg'), {
      order_id: orderId,
      email_id: order.email_id,
      photo_id: item.photo_id,
      token: randomToken(24),
      downloads: 0,
      expires_at: null,
      created_at: nowIso(),
    });
  }

  // Orders that include a physical product land in "Pendent" until it is
  // sent; purely digital orders are immediately "Abgeschlossen".
  const now = nowIso();
  await updateById(COL.orders, orderId, {
    status: hasPrint ? 'pending' : 'completed',
    payment_provider: provider,
    payment_ref: ref,
    paid_at: now,
    // Rein digitale Bestellungen sind sofort abgeschlossen – der
    // Abschlusszeitpunkt entspricht dann der Zahlung.
    completed_at: hasPrint ? null : now,
    updated_at: now,
  });

  // The payment went through, so what was bought may now leave the cart.
  await clearPurchasedCartLines(order.email_id, items);
}

export interface OrderDetail {
  id: string;
  status: string;
  currency: string;
  total_cents: number;
  created_at: string;
  paid_at: string | null;
  completed_at: string | null;
  shipping_address: ShippingAddress | null;
  items: {
    photo_id: string;
    product_name: string;
    product_type: ProductType;
    product_kind: ProductKind;
    includes_digital: boolean;
    child_name: string | null;
    original_filename: string;
    qty: number;
    unit_price_cents: number;
    additional_price_cents: number | null;
    line_total_cents: number;
    storage_key: string;
    ext: string;
    download_token: string | null;
  }[];
}

export async function getOrderForEmail(emailId: string, orderId: string): Promise<OrderDetail | null> {
  const order = await getById<OrderDoc>(COL.orders, orderId);
  if (!order || order.email_id !== emailId) return null;

  const rawItems = await itemsForOrder(orderId);
  const items: OrderDetail['items'] = [];
  for (const oi of rawItems) {
    const [product, photo, grant] = await Promise.all([
      loadProduct(oi.product_id),
      getById<PhotoLite>(COL.photos, oi.photo_id),
      firstOf<{ token: string }>(
        col(COL.downloadGrants)
          .where('order_id', '==', orderId)
          .where('photo_id', '==', oi.photo_id),
      ),
    ]);
    const line = resolveLine(oi, product);
    const child = photo?.child_id
      ? await getById<{ name: string }>(COL.children, photo.child_id)
      : null;
    // The download belongs to every line that carries the digital file – the
    // "Nur digital" download as well as a print that includes it.
    const carriesDigital = line.type === 'digital' || line.includes_digital;
    items.push({
      photo_id: oi.photo_id,
      product_name: oi.product_name,
      product_type: line.type,
      product_kind: line.kind,
      includes_digital: line.includes_digital,
      child_name: child?.name ?? null,
      original_filename: photo?.original_filename ?? '',
      qty: oi.qty,
      unit_price_cents: oi.unit_price_cents,
      additional_price_cents: line.additional_price_cents,
      line_total_cents: line.line_total_cents,
      storage_key: photo?.storage_key ?? '',
      ext: photo?.ext ?? 'jpg',
      download_token: carriesDigital ? (grant?.token ?? null) : null,
    });
  }

  return {
    id: order.id,
    status: order.status,
    currency: order.currency,
    total_cents: order.total_cents,
    created_at: order.created_at,
    paid_at: order.paid_at ?? null,
    completed_at: completedAt(order),
    shipping_address: order.shipping_address ?? null,
    items,
  };
}

/**
 * Abschlusszeitpunkt einer Bestellung. Neuere Bestellungen speichern ihn direkt
 * in `completed_at`. Für bereits abgeschlossene Bestellungen aus der Zeit vor
 * diesem Feld fällt der Wert auf `updated_at` zurück – das ist der Zeitpunkt der
 * letzten Statusänderung und damit die beste verfügbare Näherung an den
 * Versandzeitpunkt.
 */
function completedAt(order: OrderDoc): string | null {
  if (order.completed_at) return order.completed_at;
  return order.status === 'completed' ? order.updated_at ?? null : null;
}

export async function listOrdersForEmail(
  emailId: string,
): Promise<
  {
    id: string;
    status: string;
    total_cents: number;
    currency: string;
    created_at: string;
    paid_at: string | null;
    completed_at: string | null;
    has_print: boolean;
  }[]
> {
  const orders = (await runQuery<OrderDoc>(col(COL.orders).where('email_id', '==', emailId)))
    .filter((o) => isRealOrder(o.status))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));

  return Promise.all(
    orders.map(async (o) => ({
      id: o.id,
      status: o.status,
      total_cents: o.total_cents,
      currency: o.currency,
      created_at: o.created_at,
      paid_at: o.paid_at ?? null,
      completed_at: completedAt(o),
      has_print: await orderHasPrint(o.id),
    })),
  );
}

/**
 * How long an unpaid checkout is kept before it is treated as abandoned.
 *
 * Comfortably beyond both the 24 h lifetime of a Stripe Checkout session and
 * Stripe's webhook retry window, so a payment can no longer arrive for an order
 * that is removed here.
 */
const ABANDONED_CHECKOUT_DAYS = 7;

/**
 * Deletes checkouts that were started but never paid, together with their
 * lines. Every click on "Zur Zahlung" snapshots the cart into its own order;
 * the ones the parent never paid are drafts that would otherwise pile up in
 * Firestore forever. Paid orders are never touched — only `checkout_started`
 * without a payment qualifies.
 *
 * Returns the number of removed orders.
 */
export async function sweepAbandonedCheckouts(): Promise<number> {
  const cutoff = new Date(Date.now() - ABANDONED_CHECKOUT_DAYS * 24 * 60 * 60 * 1000).toISOString();
  // Filtering the date in code keeps this to a single-field query, so no
  // composite Firestore index is needed.
  const stale = (
    await runQuery<OrderDoc>(col(COL.orders).where('status', '==', 'checkout_started'))
  ).filter((o) => !o.paid_at && String(o.created_at ?? '') < cutoff);

  for (const order of stale) {
    await deleteWhere(col(COL.orderItems).where('order_id', '==', order.id));
    await deleteById(COL.orders, order.id);
  }
  if (stale.length > 0) {
    // eslint-disable-next-line no-console
    console.log(`[orders] removed ${stale.length} abandoned checkout(s) older than ${ABANDONED_CHECKOUT_DAYS} days`);
  }
  return stale.length;
}

/** Whether an order contains at least one physical product (Druck, Sticker, Magnete). */
export async function orderHasPrint(orderId: string): Promise<boolean> {
  const items = await itemsForOrder(orderId);
  if (items.length === 0) return false;
  for (const item of items) {
    if (item.product_type === 'print') return true;
    if (item.product_type === 'digital') continue;
    const product = await loadProduct(item.product_id);
    if (product?.type === 'print') return true;
  }
  return false;
}
