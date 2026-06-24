import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../../api/client';
import { Alert, Spinner, StatusBadge } from '../../components/common';
import { formatPrice, formatDate } from '../../lib/format';

interface Order {
  id: string;
  email: string;
  status: string;
  currency: string;
  total_cents: number;
  created_at: string;
  payment_provider: string | null;
  payment_ref: string | null;
}
interface Item {
  id: string;
  product_name: string;
  qty: number;
  unit_price_cents: number;
  original_filename: string;
}

const ORDER_STATUSES = [
  'cart',
  'checkout_started',
  'paid',
  'failed',
  'completed',
  'fulfilled',
  'cancelled',
  'refunded',
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
          {ORDER_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      <div className="card">
        <h2>Positionen</h2>
        <table>
          <thead>
            <tr>
              <th>Produkt</th>
              <th>Datei</th>
              <th>Menge</th>
              <th>Preis</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.id}>
                <td>{i.product_name}</td>
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
