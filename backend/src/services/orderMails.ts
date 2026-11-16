import { config } from '../config';
import {
  buildOrderConfirmationEmail,
  sendOrderConfirmation,
  type BuiltMail,
  type OrderConfirmationData,
} from '../lib/email';
import { mailThumbnail } from '../lib/images';
import { stripExtension } from '../lib/names';
import type { OrderDetail } from './orders';

/**
 * E-Mails rund um eine Bestellung: die Bestellbestätigung nach der Zahlung und
 * der Link der Versandbestätigung. Versand und Vorschau im Adminbereich bauen
 * die E-Mail mit denselben Funktionen auf – die Vorschau zeigt also genau, was
 * die Eltern erhalten.
 */

/** Link zur Bestellung in der App (Button der Bestellbestätigung). */
export function orderLink(orderId: string): string {
  return `${config.publicAppUrl}/bestellung/${orderId}`;
}

/** „Zu meinen Fotos“ der Versandbestätigung führt direkt zu den Bestellungen, nicht zur Galerie. */
export function shippingConfirmationLink(): string {
  return `${config.publicAppUrl}/bestellungen`;
}

/** Stellt aus einer Bestellung die Angaben der Bestellbestätigung zusammen (inkl. Miniaturbilder). */
async function orderConfirmationData(order: OrderDetail): Promise<OrderConfirmationData> {
  // Jedes Foto nur einmal verkleinern, auch wenn es mehrfach bestellt wurde.
  const thumbs = new Map<string, Promise<Buffer | null>>();
  const thumbFor = (photoId: string, storageKey: string) => {
    let thumb = thumbs.get(photoId);
    if (!thumb) {
      thumb = mailThumbnail(storageKey).catch(() => null);
      thumbs.set(photoId, thumb);
    }
    return thumb;
  };

  const items = await Promise.all(
    order.items.map(async (i) => ({
      photoId: i.photo_id,
      productName: i.product_name,
      productType: i.product_type,
      productKind: i.product_kind,
      includesDigital: i.includes_digital,
      qty: i.qty,
      lineTotalCents: i.line_total_cents,
      label: i.child_name || stripExtension(i.original_filename),
      image: await thumbFor(i.photo_id, i.storage_key),
    })),
  );

  return {
    currency: order.currency,
    orderedAt: order.paid_at ?? order.created_at,
    subtotalCents: order.subtotal_cents,
    shippingFeeCents: order.shipping_fee_cents,
    totalCents: order.total_cents,
    items,
    shippingAddress: order.shipping_address,
    link: orderLink(order.id),
  };
}

/**
 * Schickt die Bestellbestätigung. Ein Fehler beim Versand ist nicht kritisch:
 * Die Bestellung ist bezahlt und freigeschaltet, der Fehler landet im
 * Zustellprotokoll (siehe sendMail).
 */
export async function sendConfirmationEmail(email: string, order: OrderDetail): Promise<void> {
  try {
    await sendOrderConfirmation(email, await orderConfirmationData(order));
  } catch {
    /* non fatal */
  }
}

/** Bestellbestätigung für die Vorschau im Adminbereich – Bilder direkt im HTML. */
export async function buildOrderConfirmationPreview(order: OrderDetail): Promise<BuiltMail> {
  const { subject, html, text } = await buildOrderConfirmationEmail(
    await orderConfirmationData(order),
    'inline',
  );
  return { subject, html, text };
}
