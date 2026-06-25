import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../../api/client';
import { Alert, Spinner, StatusBadge } from '../../components/common';
import { AdminThumb } from '../../components/AdminThumb';
import { formatPrice, formatDate } from '../../lib/format';

interface ShippingAddress {
  first_name: string;
  last_name: string;
  street: string;
  house_no: string;
  zip: string;
  city: string;
}
interface Order {
  id: string;
  email: string;
  status: string;
  currency: string;
  total_cents: number;
  created_at: string;
  payment_provider: string | null;
  payment_ref: string | null;
  shipping_address?: ShippingAddress | null;
}
interface Item {
  id: string;
  photo_id: string;
  product_name: string;
  product_type?: string;
  qty: number;
  unit_price_cents: number;
  original_filename: string;
}

const ORDER_STATUS_OPTIONS = [
  { value: 'pending', label: 'Pendent (Druck offen)' },
  { value: 'completed', label: 'Abgeschlossen' },
  { value: 'cancelled', label: 'Storniert' },
] as const;

export default function AdminOrderDetail() {
  const { id } = useParams();
  const [order, setOrder] = useState<Order | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () =>
    api<{ order: Order; items: Item[] }>(`/api/admin/orders/${id}`, { admin: true })
      .then((r) => {
        setOrder(r.order);
        setItems(r.items);
      })
      .finally(() => setLoading(false));

  useEffect(() => {
    load();
  }, [id]);

  if (loading) return <Spinner />;
  if (!order) return <Alert kind="error">Bestellung nicht gefunden.</Alert>;

  const setStatus = async (status: string) => {
    await api(`/api/admin/orders/${id}`, { method: 'PATCH', admin: true, body: { status } });
    load();
  };

  const printItems = items.filter((i) => i.product_type === 'print');

  return (
    <div>
      <p>
        <Link to="/admin/orders">← Alle Bestellungen</Link>
      </p>
      <div className="row between">
        <h1 style={{ marginBottom: 4 }}>Bestellung</h1>
        <StatusBadge status={order.status} />
      </div>
      <p className="muted">
        {order.email} · {formatDate(order.created_at)}
        {order.payment_provider ? ` · Zahlung: ${order.payment_provider}` : ''}
      </p>

      <div className="card mb">
        <label>Status ändern</label>
        <select value={order.status} onChange={(e) => setStatus(e.target.value)} style={{ width: 260 }}>
          {!ORDER_STATUS_OPTIONS.some((s) => s.value === order.status) && (
            <option value={order.status}>{order.status}</option>
          )}
          {ORDER_STATUS_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <p className="muted" style={{ fontSize: '0.82rem', marginTop: 8, marginBottom: 0 }}>
          „Pendent“ heißt: ein Druckprodukt muss noch versendet werden. Setze auf „Abgeschlossen“,
          sobald der Druck raus ist. „Storniert“ wird ausschließlich manuell vergeben.
        </p>
      </div>

      {order.shipping_address && (
        <div className="card mb">
          <h2>Lieferadresse</h2>
          <div style={{ lineHeight: 1.6 }}>
            {order.shipping_address.first_name} {order.shipping_address.last_name}
            <br />
            {order.shipping_address.street} {order.shipping_address.house_no}
            <br />
            {order.shipping_address.zip} {order.shipping_address.city}
          </div>
        </div>
      )}

      {printItems.length > 0 && (
        <div className="card mb">
          <h2>Zum Ausdrucken</h2>
          <p className="muted" style={{ fontSize: '0.82rem' }}>
            Diese Positionen enthalten ein Druckprodukt und müssen versendet werden.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
            {printItems.map((i) => (
              <div key={i.id} style={{ width: 140 }}>
                <AdminThumb photoId={i.photo_id} size={140} />
                <div className="muted" style={{ fontSize: '0.78rem', marginTop: 6 }} title={i.original_filename}>
                  {i.qty}× {i.product_name}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <h2>Positionen</h2>
        <table>
          <thead>
            <tr>
              <th>Produkt</th>
              <th>Art</th>
              <th>Datei</th>
              <th>Menge</th>
              <th>Preis</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.id}>
                <td>{i.product_name}</td>
                <td>{i.product_type === 'print' ? 'Druck' : 'Digital'}</td>
                <td className="muted">{i.original_filename}</td>
                <td>{i.qty}</td>
                <td>{formatPrice(i.unit_price_cents * i.qty, order.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="row between mt">
          <span className="soft">Gesamt</span>
          <strong>{formatPrice(order.total_cents, order.currency)}</strong>
        </div>
      </div>
    </div>
  );
}
