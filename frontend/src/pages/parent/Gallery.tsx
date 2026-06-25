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

  const markInCart = (photoId: string) => setCartIds((prev) => new Set(prev).add(photoId));

  if (loading) return <Spinner label="Fotos werden geladen …" />;

  const totalPhotos = events.reduce((n, e) => n + e.photos.length, 0);

  return (
    <div>
      <div className="row between mb">
        <div>
          <h1>Fotos</h1>
        </div>
        <Link to="/galerie" className="btn secondary small">
          ✨ Galerie-Vorschau
        </Link>
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
          <div className="photo-grid">
            {ev.photos.map((p) => {
              const purchased = purchasedIds.has(p.id);
              const inCart = cartIds.has(p.id);
              return (
                <figure className="photo-tile" key={p.id}>
                  <div
                    className="photo-media"
                    onClick={() => setActive(p)}
                    role="button"
                    tabIndex={0}
                    aria-label="Foto vergrössern"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setActive(p);
                      }
                    }}
                  >
                    {/* Uniform, centre-cropped tiles: every photo takes up the
                        same amount of space and is shown from its centre. */}
                    <ProtectedImage src={p.thumbUrl} cover />
                    <span className="photo-zoom" aria-hidden="true">
                      ⤢ Ansehen
                    </span>

                    {(purchased || inCart) && (
                      <div className="photo-state">
                        <span className={`pill ${purchased ? 'green' : 'blue'}`}>
                          {purchased ? '✓ Gekauft' : '✓ Im Warenkorb'}
                        </span>
                      </div>
                    )}
                  </div>

                  <PhotoControls
                    photo={p}
                    products={products}
                    purchased={purchased}
                    inCart={inCart}
                    onAdded={(photoId, productType) => {
                      if (productType === 'digital') markInCart(photoId);
                    }}
                  />
                </figure>
              );
            })}
          </div>
        </section>
      ))}

      {totalPhotos > 0 && (
        <TrustNote>
          Vorschaubilder sind mit Wasserzeichen versehen. Die hochwertige Originaldatei erhalten Sie
          erst nach dem Kauf.
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

/**
 * Product picker + add-to-cart controls. Used both inline beneath every photo
 * and inside the enlarged preview. The product dropdown defaults to the digital
 * download; choosing a print product reveals the quantity field.
 */
function PhotoControls({
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
  onClose?: () => void;
}) {
  const defaultId = (products.find((p) => p.type === 'digital') ?? products[0])?.id ?? '';
  const [productId, setProductId] = useState(defaultId);
  const [qty, setQty] = useState('1');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const [added, setAdded] = useState(false);

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
    setAdded(false);
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
      if (onClose) {
        onClose();
      } else {
        setAdded(true);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Konnte nicht hinzugefügt werden.');
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="photo-buy">
      {error && <Alert kind="error">{error}</Alert>}
      {/* Product select and quantity share one row. Showing the quantity field
          for prints therefore never changes the tile's height, so no other
          photo shifts position when the product is switched. */}
      <div className="buy-row">
        <select
          value={productId}
          onChange={(e) => handleProductChange(e.target.value)}
          aria-label="Produkt auswählen"
        >
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} – {formatPrice(p.price_cents, p.currency)}
            </option>
          ))}
        </select>
        {isPrint && (
          <input
            id={`qty-${photo.id}`}
            className="qty-input"
            type="number"
            inputMode="numeric"
            aria-label="Menge"
            title="Menge"
            min={1}
            max={99}
            value={qty}
            onChange={(e) => {
              setQty(e.target.value);
              setAdded(false);
            }}
            onBlur={() => setQty(String(qtyNum))}
          />
        )}
      </div>
      {digitalBlocked ? (
        <>
          <Alert kind="info">
            {purchased
              ? 'Dieses Foto haben Sie bereits als digitalen Download gekauft.'
              : 'Dieses Foto liegt bereits als digitaler Download in Ihrem Warenkorb.'}
          </Alert>
          <Link to={purchased ? '/bestellungen' : '/warenkorb'} className="btn block small">
            {purchased ? 'Zu den Bestellungen' : 'Zum Warenkorb'}
          </Link>
        </>
      ) : (
        <button
          className="btn block small"
          onClick={addToCart}
          disabled={adding || !productId}
        >
          {adding ? 'Wird hinzugefügt …' : 'Zum Warenkorb hinzufügen'}
        </button>
      )}
      {added && !digitalBlocked && <p className="buy-success">✓ Zum Warenkorb hinzugefügt.</p>}
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
        <div
          className="lb-actions"
          style={{ flexDirection: 'column', alignItems: 'stretch', maxWidth: 420, margin: '14px auto 0' }}
        >
          <PhotoControls
            photo={photo}
            products={products}
            purchased={purchased}
            inCart={inCart}
            onAdded={onAdded}
            onClose={onClose}
          />
        </div>
      </div>
    </div>
  );
}
