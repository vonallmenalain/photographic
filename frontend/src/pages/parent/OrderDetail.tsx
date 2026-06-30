import { useEffect, useState } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { api, API_BASE, imageUrl } from '../../api/client';
import { Alert, Spinner, StatusBadge } from '../../components/common';
import { formatPrice, formatDate } from '../../lib/format';

interface Item {
  productName: string;
  productType: string;
  childName: string | null;
  fileName: string;
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
  paid_at: string | null;
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
  const downloadableItems = order.items.filter((i) => i.downloadUrl);
  const hasDownloads = downloadableItems.length > 0;
  const onlyPrints = isDone && !hasDownloads;

  // Löst die Downloads aller digitalen Bilder nacheinander aus. Jeder Link
  // benötigt das Eltern-Session-Cookie (wird vom Browser automatisch
  // mitgeschickt, da die Datei-Route same-origin ist). Ein kleiner zeitlicher
  // Versatz sorgt dafür, dass der Browser alle Dateien zuverlässig speichert.
  const downloadAll = () => {
    downloadableItems.forEach((item, idx) => {
      window.setTimeout(() => {
        const a = document.createElement('a');
        a.href = `${API_BASE}${item.downloadUrl}`;
        a.rel = 'noreferrer';
        document.body.appendChild(a);
        a.click();
        a.remove();
      }, idx * 600);
    });
  };

  return (
    <div className="narrow" style={{ margin: '0 auto' }}>
      {justPaid && isDone && (
        <Alert kind="success">
          <div>
            Vielen Dank! Ihre Bestellung war erfolgreich. Eine Bestätigung wurde an Ihre
            E-Mail-Adresse gesendet.
          </div>
          {hasDownloads && (
            <button
              type="button"
              className="btn small"
              style={{ marginTop: 10 }}
              onClick={downloadAll}
            >
              ⬇︎ Alle digitalen Bilder herunterladen
            </button>
          )}
        </Alert>
      )}
      <div className="row between">
        <h1 style={{ marginBottom: 4 }}>Bestellung</h1>
        <StatusBadge status={order.status} />
      </div>
      {/* Vor der Zahlung gibt es kein sinnvolles Datum – erst die Zahlung
          (paid_at) wird angezeigt. */}
      {order.paid_at && <p className="muted">{formatDate(order.paid_at)}</p>}

      <div className="card">
        {/* Sammel-Download direkt oben in der Bestellung, sobald mehr als ein
            digitales Bild gekauft wurde. */}
        {isDone && downloadableItems.length > 1 && (
          <button
            type="button"
            className="btn small"
            style={{ marginBottom: 14, display: 'inline-flex', alignItems: 'center', gap: 8 }}
            onClick={downloadAll}
          >
            <DownloadIcon />
            Alle digitalen Bilder herunterladen
          </button>
        )}

        <div className="list-reset">
          {order.items.map((item, i) => {
            // Bezahlte, digitale Produkte werden zu einer anklickbaren
            // Download-Zeile. Ein Klick auf die ganze Zeile lädt das Bild herunter.
            const downloadable = isDone && item.downloadUrl;
            const label = item.childName || item.fileName || item.productName;
            const price = formatPrice(item.unitPriceCents * item.qty, order.currency);
            const thumb = (
              <img
                src={imageUrl(item.thumbUrl)}
                alt={`Vorschau: ${label}`}
                width={64}
                height={64}
                style={{ borderRadius: 8, objectFit: 'cover' }}
                draggable={false}
              />
            );

            if (downloadable) {
              return (
                <a
                  key={i}
                  className="line-item line-item-download"
                  href={`${API_BASE}${item.downloadUrl}`}
                  rel="noreferrer"
                  title="Bild herunterladen"
                >
                  {thumb}
                  <div className="li-main">
                    <strong>Download – {label}</strong>
                    <div className="muted" style={{ fontSize: '0.85rem' }}>
                      Digitales Bild (hohe Auflösung)
                    </div>
                  </div>
                  <span className="li-download-icon" aria-hidden="true">
                    <DownloadIcon />
                  </span>
                  <div className="li-price">{price}</div>
                </a>
              );
            }

            return (
              <div key={i} className="line-item">
                {thumb}
                <div className="li-main">
                  <strong>{item.productName}</strong>
                  {/* Digitale Downloads gibt es pro Foto genau einmal – eine Menge
                      ist hier nicht sinnvoll. Nur bei Druckprodukten anzeigen. */}
                  {item.productType !== 'digital' && (
                    <div className="muted" style={{ fontSize: '0.85rem' }}>
                      Menge {item.qty}
                    </div>
                  )}
                </div>
                <div className="li-price">{price}</div>
              </div>
            );
          })}
        </div>
        <div className="row between" style={{ marginTop: 16 }}>
          <span className="soft">Gesamt</span>
          <strong style={{ fontSize: '1.2rem' }}>
            {formatPrice(order.total_cents, order.currency)}
          </strong>
        </div>
      </div>

      {onlyPrints && (
        <p className="soft">
          Ihre Bestellung enthält gedruckte Produkte. Wir bereiten den Druckauftrag vor und
          melden uns bei Ihnen.
        </p>
      )}
    </div>
  );
}

/** Schlichtes Download-Symbol (Pfeil nach unten in einen Ablagekorb). */
function DownloadIcon() {
  return (
    <svg
      width={18}
      height={18}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}
