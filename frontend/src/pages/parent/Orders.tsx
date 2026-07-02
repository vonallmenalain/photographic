import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import { Spinner, StatusBadge } from '../../components/common';
import { formatPrice, formatDate } from '../../lib/format';

interface OrderRow {
  id: string;
  status: string;
  total_cents: number;
  currency: string;
  created_at: string;
  paid_at: string | null;
  completed_at: string | null;
  has_print: boolean;
}

export default function Orders() {
  const navigate = useNavigate();
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<{ orders: OrderRow[] }>('/api/parent/orders')
      .then((r) => setOrders(r.orders))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Spinner />;

  return (
    <div className="narrow-wide" style={{ margin: '0 auto' }}>
      <h1>Bestellungen</h1>
      {orders.length === 0 ? (
        <div className="card center">
          <p className="soft">Es sind noch keine Bestellungen vorhanden.</p>
          <Link to="/galerie" className="btn">
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
                // Die ganze Zeile ist klickbar – ein Klick auf Datum, Status,
                // Summe oder daneben öffnet die Detailansicht. Der „Details“-Link
                // bleibt als sichtbarer Hinweis erhalten.
                <tr
                  key={o.id}
                  className="clickable-row"
                  onClick={() => navigate(`/bestellung/${o.id}`)}
                >
                  {/* Zahlungsdatum (paid_at). Vor der Zahlung gibt es kein
                      sinnvolles Datum. Enthält die Bestellung ausgedruckte
                      Bilder und ist sie abgeschlossen, wird zusätzlich das
                      Versanddatum (completed_at) angezeigt. */}
                  <td>
                    {o.paid_at ? formatDate(o.paid_at) : '—'}
                    {o.has_print && o.completed_at && (
                      <span className="muted" style={{ whiteSpace: 'nowrap' }}>
                        {' '}
                        – Bilder versandt am {formatDate(o.completed_at)}
                      </span>
                    )}
                  </td>
                  <td>
                    <StatusBadge status={o.status} />
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {formatPrice(o.total_cents, o.currency)}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <Link
                      to={`/bestellung/${o.id}`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      Details
                    </Link>
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
