import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError, imageUrl } from '../../api/client';
import { Alert, Spinner, TrustNote } from '../../components/common';
import { ProtectedImage } from '../../components/ProtectedImage';
import { useCart } from '../../context/Cart';
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
interface PhotoGroup {
  id: string;
  title: string;
  kind: 'order' | 'group';
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
  const [groups, setGroups] = useState<PhotoGroup[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // Whether the sellable products could be loaded. When this fails (or no
  // product is configured) the photos are still shown, but we explain clearly
  // why the "in den Warenkorb" buttons are missing instead of leaving a silent,
  // broken-looking gallery where nothing can be ordered.
  const [productsFailed, setProductsFailed] = useState(false);
  const [active, setActive] = useState<Photo | null>(null);
  // Digital downloads can only be bought once. Track which photos are already
  // owned or already in the cart so the same photo can't be added twice.
  const [purchasedIds, setPurchasedIds] = useState<Set<string>>(new Set());
  const [cartIds, setCartIds] = useState<Set<string>>(new Set());
  const { refresh: refreshCart } = useCart();

  useEffect(() => {
    (async () => {
      // Load photos and the sellable products independently. Previously both ran
      // in a single Promise.all, so a failing (or empty) product list took the
      // whole gallery down and the parent saw nothing at all. Now the photos
      // always render; the buy controls degrade gracefully with an explanation.
      try {
        const photoRes = await api<{ groups: PhotoGroup[] }>('/api/parent/photos');
        setGroups(photoRes.groups);
        const purchased = new Set<string>();
        const inCart = new Set<string>();
        for (const g of photoRes.groups) {
          for (const p of g.photos) {
            if (p.purchased) purchased.add(p.id);
            if (p.inCart) inCart.add(p.id);
          }
        }
        setPurchasedIds(purchased);
        setCartIds(inCart);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Fotos konnten nicht geladen werden.');
      }

      try {
        const prodRes = await api<{ products: Product[] }>('/api/parent/products');
        setProducts(prodRes.products);
        // A successful response with an empty list means nothing is on sale –
        // treat that the same as a failure so the notice is shown.
        setProductsFailed(prodRes.products.length === 0);
      } catch {
        setProductsFailed(true);
      }

      setLoading(false);
    })();
  }, []);

  const markInCart = (photoId: string) => setCartIds((prev) => new Set(prev).add(photoId));

  if (loading) return <Spinner label="Fotos werden geladen …" />;

  const totalPhotos = groups.reduce((n, g) => n + g.photos.length, 0);

  return (
    <div>
      <div className="row between mb">
        <div>
          <h1>Fotos</h1>
        </div>
      </div>

      {error && <Alert kind="error">{error}</Alert>}

      {/* Ohne verfügbare Produkte gibt es keine „In den Warenkorb"-Knöpfe. Statt
          einer stillen, scheinbar kaputten Galerie erklären wir das und bieten
          den Weg zur Hilfe an, damit sich niemand fragt, warum keine Bestellung
          möglich ist. */}
      {productsFailed && !error && totalPhotos > 0 && (
        <Alert kind="error">
          Der Bestellvorgang ist momentan nicht verfügbar, deshalb fehlen die
          Kauf-Schaltflächen. Bitte versuchen Sie es später erneut oder{' '}
          <Link to="/hilfe">melden Sie sich bei uns</Link>.
        </Alert>
      )}

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

      {groups.map((g) => (
        <section key={g.id} className="gallery-section">
          <div className="gallery-section-head">
            <h2>{g.title}</h2>
            <div className="gallery-section-actions">
              <span className="soft photo-count">
                {g.photos.length} {g.photos.length === 1 ? 'Foto' : 'Fotos'}
              </span>
            </div>
          </div>
          <div className="photo-grid">
            {g.photos.map((p) => {
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
                      refreshCart();
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
            refreshCart();
          }}
          onClose={() => setActive(null)}
        />
      )}
    </div>
  );
}

/**
 * Add-to-cart controls. Used both inline beneath every photo and inside the
 * enlarged preview.
 *
 * The common case – buying the digital download – is a single click on the
 * primary button (no dropdown to operate). Print products are tucked away behind
 * a "weitere Option" toggle so the gallery stays uncluttered with 20+ photos.
 * When no digital product is configured the print picker is shown directly.
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
  const digitalProduct = products.find((p) => p.type === 'digital');
  const printProducts = products.filter((p) => p.type === 'print');

  const [showPrint, setShowPrint] = useState(false);
  const [printId, setPrintId] = useState(printProducts[0]?.id ?? '');
  const [qty, setQty] = useState('1');
  const [adding, setAdding] = useState<'digital' | 'print' | null>(null);
  const [error, setError] = useState('');
  const [added, setAdded] = useState('');

  const qtyNum = Math.min(99, Math.max(1, Math.floor(Number(qty) || 1)));
  // A digital download that is already owned or already in the cart cannot be
  // bought a second time.
  const digitalBlocked = !!digitalProduct && (purchased || inCart);

  const add = async (productId: string, type: string, quantity: number, successMsg: string) => {
    setError('');
    setAdding(type === 'digital' ? 'digital' : 'print');
    try {
      await api('/api/parent/cart', {
        method: 'POST',
        body: { photoId: photo.id, productId, qty: quantity },
      });
      onAdded(photo.id, type);
      if (onClose) {
        onClose();
      } else {
        setAdded(successMsg);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Konnte nicht hinzugefügt werden.');
    } finally {
      setAdding(null);
    }
  };

  const selectedPrint = printProducts.find((p) => p.id === printId);

  return (
    <div className="photo-buy">
      {error && <Alert kind="error">{error}</Alert>}

      {/* Primary action: the digital download as a one-click purchase. */}
      {digitalProduct &&
        (digitalBlocked ? (
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
            onClick={() =>
              add(digitalProduct.id, 'digital', 1, '✓ Download im Warenkorb.')
            }
            disabled={adding !== null}
          >
            {adding === 'digital'
              ? 'Wird hinzugefügt …'
              : `Digital in den Warenkorb · ${formatPrice(digitalProduct.price_cents, digitalProduct.currency)}`}
          </button>
        ))}

      {/* Secondary option: print products behind a lightweight toggle. */}
      {printProducts.length > 0 &&
        (digitalProduct ? (
          <>
            <button
              type="button"
              className="linklike buy-more-toggle"
              aria-expanded={showPrint}
              onClick={() => setShowPrint((v) => !v)}
            >
              {showPrint ? '− Druck-Optionen ausblenden' : '+ Auch als Druck bestellen'}
            </button>
            {showPrint && (
              <PrintPicker
                photoId={photo.id}
                printProducts={printProducts}
                printId={printId}
                setPrintId={setPrintId}
                qty={qty}
                setQty={setQty}
                qtyNum={qtyNum}
                busy={adding === 'print'}
                onAdd={() =>
                  selectedPrint &&
                  add(selectedPrint.id, 'print', qtyNum, '✓ Druck im Warenkorb.')
                }
              />
            )}
          </>
        ) : (
          // No digital product configured → the print picker is the main control.
          <PrintPicker
            photoId={photo.id}
            printProducts={printProducts}
            printId={printId}
            setPrintId={setPrintId}
            qty={qty}
            setQty={setQty}
            qtyNum={qtyNum}
            busy={adding === 'print'}
            onAdd={() =>
              selectedPrint &&
              add(selectedPrint.id, 'print', qtyNum, '✓ Druck im Warenkorb.')
            }
          />
        ))}

      {added && <p className="buy-success">{added}</p>}
    </div>
  );
}

function PrintPicker({
  photoId,
  printProducts,
  printId,
  setPrintId,
  qty,
  setQty,
  qtyNum,
  busy,
  onAdd,
}: {
  photoId: string;
  printProducts: Product[];
  printId: string;
  setPrintId: (id: string) => void;
  qty: string;
  setQty: (v: string) => void;
  qtyNum: number;
  busy: boolean;
  onAdd: () => void;
}) {
  const selectedPrint = printProducts.find((p) => p.id === printId) ?? printProducts[0];
  return (
    <>
      <div className="buy-row">
        <select
          value={printId}
          onChange={(e) => setPrintId(e.target.value)}
          aria-label="Druckprodukt auswählen"
        >
          {printProducts.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} – {formatPrice(p.price_cents, p.currency)}
            </option>
          ))}
        </select>
        <input
          id={`qty-${photoId}`}
          className="qty-input"
          type="number"
          inputMode="numeric"
          aria-label="Menge"
          title="Menge"
          min={1}
          max={99}
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          onBlur={() => setQty(String(qtyNum))}
        />
      </div>
      <button type="button" className="btn secondary block small" onClick={onAdd} disabled={busy || !printId}>
        {busy
          ? 'Wird hinzugefügt …'
          : selectedPrint
            ? `Druck in den Warenkorb · ${formatPrice(selectedPrint.price_cents * qtyNum, selectedPrint.currency)}`
            : 'Druck in den Warenkorb'}
      </button>
    </>
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
          alt="Vergrösserte Vorschau des Fotos (mit Wasserzeichen)"
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
