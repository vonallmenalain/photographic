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
            Zu den Fotos
          </Link>
        </div>
      ) : (
        <div className="card orders-card">
          <ul className="order-tile-list list-reset">
            {orders.map((o) => (
              // Die ganze Kachel ist klickbar – ein Klick auf Datum, Status,
              // Summe oder daneben öffnet die Detailansicht. Der „Details“-Link
              // bleibt als sichtbarer Hinweis erhalten. Auf schmalen Bildschirmen
              // brechen Status, Summe und Details in eine eigene Zeile um, statt
              // sich neben das Datum zu quetschen.
              <li key={o.id}>
                <div
                  className="order-tile clickable-row"
                  role="link"
                  tabIndex={0}
                  onClick={() => navigate(`/bestellung/${o.id}`)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') navigate(`/bestellung/${o.id}`);
                  }}
                >
                  {/* Zahlungsdatum (paid_at). Vor der Zahlung gibt es kein
                      sinnvolles Datum. Enthält die Bestellung ausgedruckte
                      Bilder und ist sie abgeschlossen, wird zusätzlich das
                      Versanddatum (completed_at) angezeigt. */}
                  <div className="order-tile-date">
                    {o.paid_at ? formatDate(o.paid_at) : '—'}
                    {o.has_print && o.completed_at && (
                      <span className="muted"> – Bilder versandt am {formatDate(o.completed_at)}</span>
                    )}
                  </div>
                  <div className="order-tile-meta">
                    <StatusBadge status={o.status} />
                    <span className="order-tile-price">
                      {formatPrice(o.total_cents, o.currency)}
                    </span>
                    <Link
                      to={`/bestellung/${o.id}`}
                      className="order-tile-details"
                      onClick={(e) => e.stopPropagation()}
                    >
                      Details
                    </Link>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
