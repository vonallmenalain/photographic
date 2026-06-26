import { useEffect, useState } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { api, API_BASE, imageUrl } from '../../api/client';
import { Alert, Spinner, StatusBadge } from '../../components/common';
import { formatPrice, formatDate } from '../../lib/format';

interface Item {
  productName: string;
  productType: string;
  childName: string | null;
  qty: number;
  unitPriceCents: number;
  thumbUrl: string;
  downloadUrl: string | null;
}
interface Order {
  id: string;
  status: string;
  currency: string;
  total_cents: number;
  created_at: string;
  items: Item[];
}

export default function OrderDetail() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const justPaid = params.get('status') === 'success';
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api<{ order: Order }>(`/api/parent/orders/${id}`)
      .then((r) => setOrder(r.order))
      .catch(() => setError('Bestellung konnte nicht geladen werden.'))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <Spinner />;
  if (error || !order)
    return (
      <div className="narrow" style={{ margin: '0 auto' }}>
        <Alert kind="error">{error || 'Bestellung nicht gefunden.'}</Alert>
        <Link to="/bestellungen" className="btn secondary">
          Zu den Bestellungen
        </Link>
      </div>
    );

  const isDone = ['completed', 'pending'].includes(order.status);

  return (
    <div className="narrow" style={{ margin: '0 auto' }}>
      {justPaid && isDone && (
        <Alert kind="success">
          Vielen Dank! Ihre Bestellung war erfolgreich. Eine Bestätigung wurde an Ihre
          E-Mail-Adresse gesendet.
        </Alert>
      )}
      <div className="row between">
        <h1 style={{ marginBottom: 4 }}>Bestellung</h1>
        <StatusBadge status={order.status} />
      </div>
      <p className="muted">{formatDate(order.created_at)}</p>

      <div className="card">
        <ul className="list-reset">
          {order.items.map((item, i) => (
            <li key={i} className="line-item">
              <img
                src={imageUrl(item.thumbUrl)}
                alt=""
                width={64}
                height={64}
                style={{ borderRadius: 8, objectFit: 'cover' }}
                draggable={false}
              />
              <div className="li-main">
                <strong>{item.productName}</strong>
                <div className="muted" style={{ fontSize: '0.85rem' }}>
                  Menge {item.qty}
                </div>
              </div>
              <div className="li-price">
                {formatPrice(item.unitPriceCents * item.qty, order.currency)}
              </div>
            </li>
          ))}
        </ul>
        <div className="row between" style={{ marginTop: 16 }}>
          <span className="soft">Gesamt</span>
          <strong style={{ fontSize: '1.2rem' }}>
            {formatPrice(order.total_cents, order.currency)}
          </strong>
        </div>
      </div>

      {isDone && (
        <div className="card">
          <h2>Downloads</h2>
          {order.items.some((i) => i.downloadUrl) ? (
            <ul className="list-reset">
              {order.items
                .filter((i) => i.downloadUrl)
                .map((i, idx) => (
                  <li key={idx} style={{ marginBottom: 10 }}>
                    <DownloadLink
                      url={i.downloadUrl!}
                      thumbUrl={i.thumbUrl}
                      label={i.childName || i.productName}
                    />
                  </li>
                ))}
            </ul>
          ) : (
            <p className="soft">
              Ihre Bestellung enthält gedruckte Produkte. Wir bereiten den Druckauftrag vor und
              melden uns bei Ihnen.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function DownloadLink({ url, thumbUrl, label }: { url: string; thumbUrl: string; label: string }) {
  // Downloads require the parent session cookie; a plain link sends it because
  // the file route is same-origin to the API and uses credentials via browser.
  return (
    <a
      className="btn secondary"
      href={`${API_BASE}${url}`}
      rel="noreferrer"
      style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}
    >
      <img
        src={imageUrl(thumbUrl)}
        alt=""
        width={40}
        height={40}
        style={{ borderRadius: 6, objectFit: 'cover' }}
        draggable={false}
      />
      <span>{label}</span>
      <span aria-hidden="true">⬇︎</span>
    </a>
  );
}
