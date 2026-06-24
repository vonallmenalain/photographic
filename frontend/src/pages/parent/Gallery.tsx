import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError, imageUrl } from '../../api/client';
import { Alert, Spinner, TrustNote } from '../../components/common';
import { ProtectedImage } from '../../components/ProtectedImage';
import { formatPrice } from '../../lib/format';

interface Photo {
  id: string;
  isClassPhoto: boolean;
  thumbUrl: string;
  previewUrl: string;
}
interface EventGroup {
  id: string;
  name: string;
  photos: Photo[];
}
interface Product {
  id: string;
  name: string;
  description: string;
  type: string;
  price_cents: number;
  currency: string;
}

export default function Gallery() {
  const [events, setEvents] = useState<EventGroup[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [active, setActive] = useState<Photo | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [photoRes, prodRes] = await Promise.all([
          api<{ events: EventGroup[] }>('/api/parent/photos'),
          api<{ products: Product[] }>('/api/parent/products'),
        ]);
        setEvents(photoRes.events);
        setProducts(prodRes.products);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Fotos konnten nicht geladen werden.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <Spinner label="Deine Fotos werden geladen …" />;

  const totalPhotos = events.reduce((n, e) => n + e.photos.length, 0);

  return (
    <div>
      <div className="row between mb">
        <div>
          <h1>Deine Fotos</h1>
          <p className="soft" style={{ marginBottom: 0 }}>
            Du siehst ausschließlich Fotos, die deiner E-Mail-Adresse zugeordnet wurden.
          </p>
        </div>
      </div>

      {error && <Alert kind="error">{error}</Alert>}

      {totalPhotos === 0 && !error && (
        <div className="card">
          <h2>Aktuell sind keine Fotos verfügbar</h2>
          <p className="soft">
            Mögliche Gründe: Die Fotos sind noch nicht freigegeben, deine E-Mail-Adresse wurde anders
            geschrieben, oder die Zuordnung fehlt noch. Wir helfen dir gerne weiter.
          </p>
          <Link to="/hilfe" className="btn secondary">
            Problem melden
          </Link>
        </div>
      )}

      {events.map((ev) => (
        <section key={ev.id} style={{ marginBottom: 32 }}>
          <h2>{ev.name}</h2>
          <div className="grid">
            {ev.photos.map((p) => (
              <div className="photo-card" key={p.id}>
                <div onClick={() => setActive(p)} style={{ cursor: 'zoom-in' }}>
                  <ProtectedImage src={p.thumbUrl} />
                </div>
                <div className="body">
                  {p.isClassPhoto && <span className="badge class">Gruppen-/Klassenfoto</span>}
                  <button className="btn secondary small" onClick={() => setActive(p)}>
                    Ansehen &amp; auswählen
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}

      {totalPhotos > 0 && (
        <TrustNote>
          Vorschaubilder sind aus Datenschutz- und Urheberrechtsgründen mit Wasserzeichen versehen.
          Die hochwertige Originaldatei erhältst du erst nach dem Kauf.
        </TrustNote>
      )}

      {active && (
        <Lightbox photo={active} products={products} onClose={() => setActive(null)} />
      )}
    </div>
  );
}

function Lightbox({
  photo,
  products,
  onClose,
}: {
  photo: Photo;
  products: Product[];
  onClose: () => void;
}) {
  const [productId, setProductId] = useState(products[0]?.id ?? '');
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(false);
  const [error, setError] = useState('');

  const addToCart = async () => {
    setError('');
    setAdding(true);
    try {
      await api('/api/parent/cart', { method: 'POST', body: { photoId: photo.id, productId } });
      setAdded(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Konnte nicht hinzugefügt werden.');
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="lightbox" onClick={onClose}>
      <div className="inner" onClick={(e) => e.stopPropagation()}>
        <button className="close" onClick={onClose} aria-label="Schließen">
          ×
        </button>
        <img
          src={imageUrl(photo.previewUrl)}
          alt="Vorschau"
          draggable={false}
          onContextMenu={(e) => e.preventDefault()}
        />
        <div className="lb-actions" style={{ flexDirection: 'column', alignItems: 'stretch', maxWidth: 420, margin: '14px auto 0' }}>
          {error && <Alert kind="error">{error}</Alert>}
          <div className="field" style={{ marginBottom: 10 }}>
            <select value={productId} onChange={(e) => setProductId(e.target.value)}>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} – {formatPrice(p.price_cents, p.currency)}
                </option>
              ))}
            </select>
          </div>
          {added ? (
            <div style={{ display: 'flex', gap: 10 }}>
              <Link to="/warenkorb" className="btn block">
                Zum Warenkorb
              </Link>
              <button className="btn secondary" onClick={() => setAdded(false)}>
                Weiter
              </button>
            </div>
          ) : (
            <button className="btn block" onClick={addToCart} disabled={adding || !productId}>
              {adding ? 'Wird hinzugefügt …' : 'In den Warenkorb'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
