import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import { Spinner, StatusBadge } from '../../components/common';
import { formatPrice, formatDate } from '../../lib/format';

interface OrderRow {
  id: string;
  email: string;
  status: string;
  total_cents: number;
  currency: string;
  created_at: string;
}

export default function AdminOrders() {
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<{ orders: OrderRow[] }>('/api/admin/orders', { admin: true })
      .then((r) => setOrders(r.orders))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Spinner />;

  return (
    <div>
      <h1>Bestellungen</h1>
      <div className="card">
        {orders.length === 0 ? (
          <p className="muted">Noch keine Bestellungen.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Datum</th>
                <th>E-Mail</th>
                <th>Status</th>
                <th>Summe</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id}>
                  <td>{formatDate(o.created_at)}</td>
                  <td>{o.email}</td>
                  <td>
                    <StatusBadge status={o.status} />
                  </td>
                  <td>{formatPrice(o.total_cents, o.currency)}</td>
                  <td>
                    <Link to={o.id}>Details</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
