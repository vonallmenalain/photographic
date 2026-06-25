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

export interface CartLine {
  id: string;
  photo_id: string;
  product_id: string;
  product_name: string;
  product_type: string;
  qty: number;
  unit_price_cents: number;
  storage_key: string;
  ext: string;
}

interface OrderDoc {
  email_id: string;
  status: string;
  currency: string;
  total_cents: number;
  payment_provider?: string;
  payment_ref?: string;
  created_at: string;
  updated_at: string;
}

interface OrderItemDoc {
  order_id: string;
  photo_id: string;
  product_id: string;
  qty: number;
  unit_price_cents: number;
  product_name: string;
  created_at: string;
}

interface ProductDoc {
  name: string;
  type: string;
  price_cents: number;
  active: number;
}

interface PhotoLite {
  storage_key: string;
  ext: string;
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
      getById<ProductDoc>(COL.products, oi.product_id),
      getById<PhotoLite>(COL.photos, oi.photo_id),
    ]);
    items.push({
      id: oi.id,
      photo_id: oi.photo_id,
      product_id: oi.product_id,
      product_name: oi.product_name,
      product_type: product?.type ?? 'digital',
      qty: oi.qty,
      unit_price_cents: oi.unit_price_cents,
      storage_key: photo?.storage_key ?? '',
      ext: photo?.ext ?? 'jpg',
    });
  }

  const total = items.reduce((sum, i) => sum + i.unit_price_cents * i.qty, 0);
  const order = await getById<OrderDoc>(COL.orders, cartId);
  return { id: cartId, items, total_cents: total, currency: order?.currency ?? 'chf' };
}

export async function addToCart(
  emailId: string,
  photoId: string,
  productId: string,
  qty = 1,
): Promise<void> {
  if (!(await canEmailSeePhoto(emailId, photoId))) {
    // Do not reveal whether the photo exists.
    throw new ApiError(403, 'Dieses Foto ist für dich nicht verfügbar.');
  }
  const product = await getById<ProductDoc>(COL.products, productId);
  if (!product || product.active !== 1) {
    throw new ApiError(400, 'Dieses Produkt ist nicht verfügbar.');
  }

  const cartId = await getOrCreateCart(emailId);
  const existing = await firstOf<OrderItemDoc>(
    col(COL.orderItems)
      .where('order_id', '==', cartId)
      .where('photo_id', '==', photoId)
      .where('product_id', '==', productId),
  );
  if (existing) {
    await updateById(COL.orderItems, existing.id, { qty: existing.qty + qty });
  } else {
    await setById(COL.orderItems, newId('oi'), {
      order_id: cartId,
      photo_id: photoId,
      product_id: productId,
      qty,
      unit_price_cents: product.price_cents,
      product_name: product.name,
      created_at: nowIso(),
    });
  }
  await recalcTotal(cartId);
}

export async function updateCartItemQty(
  emailId: string,
  itemId: string,
  qty: number,
): Promise<void> {
  const cartId = await getOrCreateCart(emailId);
  const item = await getById<OrderItemDoc>(COL.orderItems, itemId);
  if (!item || item.order_id !== cartId) {
    throw new ApiError(404, 'Dieser Artikel ist nicht in deinem Warenkorb.');
  }
  await updateById(COL.orderItems, itemId, { qty });
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
  const total = items.reduce((sum, i) => sum + i.unit_price_cents * i.qty, 0);
  await updateById(COL.orders, orderId, { total_cents: total, updated_at: nowIso() });
}

/** Transitions the cart into a real order ready for payment. */
export async function beginCheckout(
  emailId: string,
): Promise<{ orderId: string; total_cents: number; currency: string }> {
  const cart = await getCart(emailId);
  if (cart.items.length === 0) throw new ApiError(400, 'Dein Warenkorb ist leer.');
  await updateById(COL.orders, cart.id, { status: 'checkout_started', updated_at: nowIso() });
  return { orderId: cart.id, total_cents: cart.total_cents, currency: cart.currency };
}

/** Marks an order paid and creates download grants for digital items. */
export async function markOrderPaid(orderId: string, provider: string, ref: string): Promise<void> {
  const order = await getById<OrderDoc>(COL.orders, orderId);
  if (!order) return;
  if (order.status === 'paid' || order.status === 'completed' || order.status === 'fulfilled') return;

  await updateById(COL.orders, orderId, {
    status: 'paid',
    payment_provider: provider,
    payment_ref: ref,
    updated_at: nowIso(),
  });

  const items = await itemsForOrder(orderId);
  for (const item of items) {
    const product = await getById<ProductDoc>(COL.products, item.product_id);
    if (!product || product.type !== 'digital') continue;
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

  await updateById(COL.orders, orderId, { status: 'completed', updated_at: nowIso() });
}

export interface OrderDetail {
  id: string;
  status: string;
  currency: string;
  total_cents: number;
  created_at: string;
  items: {
    photo_id: string;
    product_name: string;
    product_type: string;
    qty: number;
    unit_price_cents: number;
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
      getById<ProductDoc>(COL.products, oi.product_id),
      getById<PhotoLite>(COL.photos, oi.photo_id),
      firstOf<{ token: string }>(
        col(COL.downloadGrants)
          .where('order_id', '==', orderId)
          .where('photo_id', '==', oi.photo_id),
      ),
    ]);
    items.push({
      photo_id: oi.photo_id,
      product_name: oi.product_name,
      product_type: product?.type ?? 'digital',
      qty: oi.qty,
      unit_price_cents: oi.unit_price_cents,
      storage_key: photo?.storage_key ?? '',
      ext: photo?.ext ?? 'jpg',
      download_token: grant?.token ?? null,
    });
  }

  return {
    id: order.id,
    status: order.status,
    currency: order.currency,
    total_cents: order.total_cents,
    created_at: order.created_at,
    items,
  };
}

export async function listOrdersForEmail(
  emailId: string,
): Promise<{ id: string; status: string; total_cents: number; currency: string; created_at: string }[]> {
  const orders = await runQuery<OrderDoc>(col(COL.orders).where('email_id', '==', emailId));
  return orders
    .filter((o) => o.status !== 'cart')
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map((o) => ({
      id: o.id,
      status: o.status,
      total_cents: o.total_cents,
      currency: o.currency,
      created_at: o.created_at,
    }));
}
