import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import { Spinner, StatusBadge } from '../../components/common';
import { formatPrice, formatDate } from '../../lib/format';

interface OrderRow {
  id: string;
  status: string;
  total_cents: number;
  currency: string;
  created_at: string;
}

export default function Orders() {
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<{ orders: OrderRow[] }>('/api/parent/orders')
      .then((r) => setOrders(r.orders))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Spinner />;

  return (
    <div className="narrow" style={{ margin: '0 auto' }}>
      <h1>Bestellungen</h1>
      {orders.length === 0 ? (
        <div className="card center">
          <p className="soft">Es sind noch keine Bestellungen vorhanden.</p>
          <Link to="/galerie/fotos" className="btn">
            Zur Galerie
          </Link>
        </div>
      ) : (
        <div className="card">
          <table>
            <thead>
              <tr>
                <th>Datum</th>
                <th>Status</th>
                <th>Summe</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id}>
                  <td>{formatDate(o.created_at)}</td>
                  <td>
                    <StatusBadge status={o.status} />
                  </td>
                  <td>{formatPrice(o.total_cents, o.currency)}</td>
                  <td>
                    <Link to={`/bestellung/${o.id}`}>Details</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
