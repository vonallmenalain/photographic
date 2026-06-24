import { getDb } from '../db';
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

function getOrCreateCart(emailId: string): string {
  const db = getDb();
  const existing = db
    .prepare("SELECT id FROM orders WHERE email_id = ? AND status = 'cart' LIMIT 1")
    .get(emailId) as { id: string } | undefined;
  if (existing) return existing.id;
  const id = newId('ord');
  db.prepare("INSERT INTO orders (id, email_id, status) VALUES (?, ?, 'cart')").run(id, emailId);
  return id;
}

export function getCart(emailId: string): { id: string; items: CartLine[]; total_cents: number; currency: string } {
  const db = getDb();
  const cartId = getOrCreateCart(emailId);
  const items = db
    .prepare(
      `SELECT oi.id, oi.photo_id, oi.product_id, oi.product_name, oi.qty, oi.unit_price_cents,
              p.type AS product_type, ph.storage_key, ph.ext
       FROM order_items oi
       JOIN products p ON p.id = oi.product_id
       JOIN photos ph ON ph.id = oi.photo_id
       WHERE oi.order_id = ?`,
    )
    .all(cartId) as CartLine[];
  const total = items.reduce((sum, i) => sum + i.unit_price_cents * i.qty, 0);
  const currency = (db.prepare('SELECT currency FROM orders WHERE id = ?').get(cartId) as { currency: string }).currency;
  return { id: cartId, items, total_cents: total, currency };
}

export function addToCart(emailId: string, photoId: string, productId: string, qty = 1): void {
  const db = getDb();
  if (!canEmailSeePhoto(emailId, photoId)) {
    // Do not reveal whether the photo exists.
    throw new ApiError(403, 'Dieses Foto ist für dich nicht verfügbar.');
  }
  const product = db
    .prepare('SELECT id, name, price_cents FROM products WHERE id = ? AND active = 1')
    .get(productId) as { id: string; name: string; price_cents: number } | undefined;
  if (!product) throw new ApiError(400, 'Dieses Produkt ist nicht verfügbar.');

  const cartId = getOrCreateCart(emailId);
  const existing = db
    .prepare('SELECT id, qty FROM order_items WHERE order_id = ? AND photo_id = ? AND product_id = ?')
    .get(cartId, photoId, productId) as { id: string; qty: number } | undefined;
  if (existing) {
    db.prepare('UPDATE order_items SET qty = qty + ? WHERE id = ?').run(qty, existing.id);
  } else {
    db.prepare(
      `INSERT INTO order_items (id, order_id, photo_id, product_id, qty, unit_price_cents, product_name)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(newId('oi'), cartId, photoId, productId, qty, product.price_cents, product.name);
  }
  recalcTotal(cartId);
}

export function removeFromCart(emailId: string, itemId: string): void {
  const db = getDb();
  const cartId = getOrCreateCart(emailId);
  db.prepare('DELETE FROM order_items WHERE id = ? AND order_id = ?').run(itemId, cartId);
  recalcTotal(cartId);
}

export function clearCart(emailId: string): void {
  const db = getDb();
  const cartId = getOrCreateCart(emailId);
  db.prepare('DELETE FROM order_items WHERE order_id = ?').run(cartId);
  recalcTotal(cartId);
}

function recalcTotal(orderId: string): void {
  const db = getDb();
  const row = db
    .prepare('SELECT COALESCE(SUM(unit_price_cents * qty),0) AS t FROM order_items WHERE order_id = ?')
    .get(orderId) as { t: number };
  db.prepare("UPDATE orders SET total_cents = ?, updated_at = datetime('now') WHERE id = ?").run(
    row.t,
    orderId,
  );
}

/** Transitions the cart into a real order ready for payment. */
export function beginCheckout(emailId: string): { orderId: string; total_cents: number; currency: string } {
  const db = getDb();
  const cart = getCart(emailId);
  if (cart.items.length === 0) throw new ApiError(400, 'Dein Warenkorb ist leer.');
  db.prepare("UPDATE orders SET status = 'checkout_started', updated_at = datetime('now') WHERE id = ?").run(
    cart.id,
  );
  return { orderId: cart.id, total_cents: cart.total_cents, currency: cart.currency };
}

/** Marks an order paid and creates download grants for digital items. */
export function markOrderPaid(orderId: string, provider: string, ref: string): void {
  const db = getDb();
  const order = db.prepare('SELECT id, email_id, status FROM orders WHERE id = ?').get(orderId) as
    | { id: string; email_id: string; status: string }
    | undefined;
  if (!order) return;
  if (order.status === 'paid' || order.status === 'completed' || order.status === 'fulfilled') return;

  const tx = db.transaction(() => {
    db.prepare(
      "UPDATE orders SET status = 'paid', payment_provider = ?, payment_ref = ?, updated_at = datetime('now') WHERE id = ?",
    ).run(provider, ref, orderId);

    const items = db
      .prepare(
        `SELECT oi.photo_id, p.type FROM order_items oi
         JOIN products p ON p.id = oi.product_id WHERE oi.order_id = ?`,
      )
      .all(orderId) as { photo_id: string; type: string }[];

    for (const item of items) {
      if (item.type !== 'digital') continue;
      const exists = db
        .prepare('SELECT 1 FROM download_grants WHERE order_id = ? AND photo_id = ?')
        .get(orderId, item.photo_id);
      if (exists) continue;
      db.prepare(
        `INSERT INTO download_grants (id, order_id, email_id, photo_id, token)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(newId('dg'), orderId, order.email_id, item.photo_id, randomToken(24));
    }
    db.prepare("UPDATE orders SET status = 'completed', updated_at = datetime('now') WHERE id = ?").run(
      orderId,
    );
  });
  tx();
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

export function getOrderForEmail(emailId: string, orderId: string): OrderDetail | null {
  const db = getDb();
  const order = db
    .prepare('SELECT id, status, currency, total_cents, created_at FROM orders WHERE id = ? AND email_id = ?')
    .get(orderId, emailId) as Omit<OrderDetail, 'items'> | undefined;
  if (!order) return null;
  const items = db
    .prepare(
      `SELECT oi.photo_id, oi.product_name, p.type AS product_type, oi.qty, oi.unit_price_cents,
              ph.storage_key, ph.ext,
              (SELECT token FROM download_grants dg WHERE dg.order_id = oi.order_id AND dg.photo_id = oi.photo_id LIMIT 1) AS download_token
       FROM order_items oi
       JOIN products p ON p.id = oi.product_id
       JOIN photos ph ON ph.id = oi.photo_id
       WHERE oi.order_id = ?`,
    )
    .all(orderId) as OrderDetail['items'];
  return { ...order, items };
}

export function listOrdersForEmail(emailId: string): { id: string; status: string; total_cents: number; currency: string; created_at: string }[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT id, status, total_cents, currency, created_at FROM orders
       WHERE email_id = ? AND status != 'cart' ORDER BY created_at DESC`,
    )
    .all(emailId) as { id: string; status: string; total_cents: number; currency: string; created_at: string }[];
}
