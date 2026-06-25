import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError, imageUrl } from '../../api/client';
import { Alert, Spinner, TrustNote } from '../../components/common';
import { ProtectedImage } from '../../components/ProtectedImage';
import { formatPrice } from '../../lib/format';

interface Photo {
  id: string;
  isClassPhoto: boolean;
  width: number | null;
  height: number | null;
  thumbUrl: string;
  previewUrl: string;
  purchased: boolean;
  inCart: boolean;
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

type Feedback = { kind: 'error' | 'success'; msg: string };

export default function Gallery() {
  const [events, setEvents] = useState<EventGroup[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [active, setActive] = useState<Photo | null>(null);
  // Digital downloads can only be bought once. Track which photos are already
  // owned or already in the cart so the same photo can't be added twice.
  const [purchasedIds, setPurchasedIds] = useState<Set<string>>(new Set());
  const [cartIds, setCartIds] = useState<Set<string>>(new Set());
  const [addingId, setAddingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Record<string, Feedback>>({});

  useEffect(() => {
    (async () => {
      try {
        const [photoRes, prodRes] = await Promise.all([
          api<{ events: EventGroup[] }>('/api/parent/photos'),
          api<{ products: Product[] }>('/api/parent/products'),
        ]);
        setEvents(photoRes.events);
        setProducts(prodRes.products);
        const purchased = new Set<string>();
        const inCart = new Set<string>();
        for (const ev of photoRes.events) {
          for (const p of ev.photos) {
            if (p.purchased) purchased.add(p.id);
            if (p.inCart) inCart.add(p.id);
          }
        }
        setPurchasedIds(purchased);
        setCartIds(inCart);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Fotos konnten nicht geladen werden.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const digitalProduct = products.find((p) => p.type === 'digital');

  const markInCart = (photoId: string) => setCartIds((prev) => new Set(prev).add(photoId));

  const quickAdd = async (photo: Photo) => {
    if (!digitalProduct) return;
    setAddingId(photo.id);
    setFeedback((f) => {
      const next = { ...f };
      delete next[photo.id];
      return next;
    });
    try {
      await api('/api/parent/cart', {
        method: 'POST',
        body: { photoId: photo.id, productId: digitalProduct.id, qty: 1 },
      });
      markInCart(photo.id);
      setFeedback((f) => ({ ...f, [photo.id]: { kind: 'success', msg: 'Zum Warenkorb hinzugefügt.' } }));
    } catch (err) {
      setFeedback((f) => ({
        ...f,
        [photo.id]: {
          kind: 'error',
          msg: err instanceof ApiError ? err.message : 'Konnte nicht hinzugefügt werden.',
        },
      }));
    } finally {
      setAddingId(null);
    }
  };

  if (loading) return <Spinner label="Fotos werden geladen …" />;

  const totalPhotos = events.reduce((n, e) => n + e.photos.length, 0);

  return (
    <div>
      <div className="row between mb">
        <div>
          <h1>Fotos</h1>
          <p className="soft" style={{ marginBottom: 0 }}>
            Es sind ausschliesslich Fotos ersichtlich, die Ihrer E-Mail Adresse zugeordnet wurden.
          </p>
        </div>
      </div>

      {error && <Alert kind="error">{error}</Alert>}

      {totalPhotos === 0 && !error && (
        <div className="card">
          <h2>Aktuell sind keine Fotos verfügbar</h2>
          <p className="soft">
            Mögliche Gründe: Die Fotos sind noch nicht freigegeben, die E-Mail-Adresse wurde anders
            geschrieben, oder die Zuordnung fehlt noch. Wir helfen Ihnen gerne weiter.
          </p>
          <Link to="/hilfe" className="btn secondary">
            Problem melden
          </Link>
        </div>
      )}

      {events.map((ev) => (
        <section key={ev.id} className="gallery-section">
          <div className="gallery-section-head">
            <h2>{ev.name}</h2>
            <span className="soft photo-count">
              {ev.photos.length} {ev.photos.length === 1 ? 'Foto' : 'Fotos'}
            </span>
          </div>
          <div className="masonry">
            {ev.photos.map((p) => {
              const purchased = purchasedIds.has(p.id);
              const inCart = cartIds.has(p.id);
              const fb = feedback[p.id];
              const ratio = p.width && p.height ? p.width / p.height : undefined;
              return (
                <figure className="photo-tile" key={p.id}>
                  <div
                    className="photo-media"
                    onClick={() => setActive(p)}
                    role="button"
                    tabIndex={0}
                    aria-label="Foto ansehen und auswählen"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setActive(p);
                      }
                    }}
                  >
                    <ProtectedImage src={p.thumbUrl} ratio={ratio} />
                    <span className="photo-zoom" aria-hidden="true">
                      ⤢ Ansehen
                    </span>

                    {p.isClassPhoto && (
                      <div className="photo-badges">
                        <span className="badge class">Gruppenfoto</span>
                      </div>
                    )}
                    {(purchased || inCart) && (
                      <div className="photo-state">
                        <span className={`pill ${purchased ? 'green' : 'blue'}`}>
                          {purchased ? '✓ Gekauft' : '✓ Im Warenkorb'}
                        </span>
                      </div>
                    )}

                    {digitalProduct && (
                      <div className="photo-actions" onClick={(e) => e.stopPropagation()}>
                        {purchased ? (
                          <Link to="/bestellungen" className="btn on-photo block small">
                            ✓ Bereits gekauft
                          </Link>
                        ) : inCart ? (
                          <Link to="/warenkorb" className="btn on-photo block small">
                            Zum Warenkorb
                          </Link>
                        ) : (
                          <button
                            className="btn block small"
                            onClick={() => quickAdd(p)}
                            disabled={addingId === p.id}
                          >
                            {addingId === p.id ? 'Wird hinzugefügt …' : 'In den Warenkorb'}
                          </button>
                        )}
                      </div>
                    )}

                    {fb && (
                      <div className={`photo-toast ${fb.kind}`} onClick={(e) => e.stopPropagation()}>
                        {fb.msg}
                      </div>
                    )}
                  </div>
                </figure>
              );
            })}
          </div>
        </section>
      ))}

      {totalPhotos > 0 && (
        <TrustNote>
          Vorschaubilder sind aus Datenschutz- und Urheberrechtsgründen mit Wasserzeichen versehen.
          Die hochwertige Originaldatei erhalten Sie erst nach dem Kauf.
        </TrustNote>
      )}

      {active && (
        <Lightbox
          photo={active}
          products={products}
          purchased={purchasedIds.has(active.id)}
          inCart={cartIds.has(active.id)}
          onAdded={(photoId, productType) => {
            if (productType === 'digital') markInCart(photoId);
          }}
          onClose={() => setActive(null)}
        />
      )}
    </div>
  );
}

function Lightbox({
  photo,
  products,
  purchased,
  inCart,
  onAdded,
  onClose,
}: {
  photo: Photo;
  products: Product[];
  purchased: boolean;
  inCart: boolean;
  onAdded: (photoId: string, productType: string) => void;
  onClose: () => void;
}) {
  const [productId, setProductId] = useState(products[0]?.id ?? '');
  const [qty, setQty] = useState('1');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');

  const selectedProduct = products.find((p) => p.id === productId);
  const isPrint = selectedProduct?.type === 'print';
  const isDigital = selectedProduct?.type === 'digital';
  const qtyNum = Math.min(99, Math.max(1, Math.floor(Number(qty) || 1)));

  // A digital download that is already owned or already in the cart cannot be
  // bought a second time.
  const digitalBlocked = isDigital && (purchased || inCart);

  const handleProductChange = (id: string) => {
    setProductId(id);
    setQty('1');
    setError('');
  };

  const addToCart = async () => {
    if (digitalBlocked) return;
    setError('');
    setAdding(true);
    try {
      await api('/api/parent/cart', {
        method: 'POST',
        body: { photoId: photo.id, productId, qty: isPrint ? qtyNum : 1 },
      });
      onAdded(photo.id, selectedProduct?.type ?? '');
      // Close the preview and return to the photo selection right away.
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Konnte nicht hinzugefügt werden.');
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="lightbox" onClick={onClose}>
      <div className="inner" onClick={(e) => e.stopPropagation()}>
        <button className="close" onClick={onClose} aria-label="Schliessen">
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
            <select value={productId} onChange={(e) => handleProductChange(e.target.value)}>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} – {formatPrice(p.price_cents, p.currency)}
                </option>
              ))}
            </select>
          </div>
          {isPrint && (
            <div className="field" style={{ marginBottom: 10 }}>
              <label htmlFor="lb-qty" style={{ display: 'block', marginBottom: 4, fontSize: '0.9rem' }}>
                Menge
              </label>
              <input
                id="lb-qty"
                type="number"
                inputMode="numeric"
                min={1}
                max={99}
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                onBlur={() => setQty(String(qtyNum))}
              />
            </div>
          )}
          {digitalBlocked ? (
            <>
              <Alert kind="info">
                {purchased
                  ? 'Dieses Foto haben Sie bereits als digitalen Download gekauft. Sie finden es unter „Bestellungen“.'
                  : 'Dieses Foto liegt bereits als digitaler Download in Ihrem Warenkorb.'}
              </Alert>
              <Link to={purchased ? '/bestellungen' : '/warenkorb'} className="btn block">
                {purchased ? 'Zu den Bestellungen' : 'Zum Warenkorb'}
              </Link>
            </>
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
