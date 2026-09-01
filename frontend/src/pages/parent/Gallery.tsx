import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError, imageUrl } from '../../api/client';
import { Alert, Spinner, TrustNote } from '../../components/common';
import { ProtectedImage } from '../../components/ProtectedImage';
import { ProductMockup, hasMockup } from '../../components/ProductMockups';
import { useCart } from '../../context/Cart';
import { formatPrice, hasTieredPrice, lineTotalCents } from '../../lib/format';

interface Photo {
  id: string;
  isClassPhoto: boolean;
  width: number | null;
  height: number | null;
  thumbUrl: string;
  previewUrl: string;
  purchased: boolean;
  inCart: boolean;
  digitalInCart: boolean;
}
interface PhotoGroup {
  id: string;
  title: string;
  kind: 'order' | 'group';
  photos: Photo[];
}
interface Product {
  id: string;
  code: string;
  name: string;
  description: string;
  type: 'digital' | 'print';
  kind: 'digital' | 'photo' | 'sticker' | 'magnet';
  price_cents: number;
  additional_price_cents: number | null;
  includes_digital: boolean;
  scope: 'all' | 'portrait' | 'group';
  currency: string;
}

/** What the gallery knows about a photo's purchase/cart state (kept up to date locally). */
interface PhotoState {
  /** The digital file was already bought (download available under "Bestellungen"). */
  purchased: boolean;
  /** Anything for this photo is in the cart. */
  inCart: boolean;
  /** The digital file is covered by the cart: a download line or a print that includes it. */
  digitalInCart: boolean;
}

/** Products that may be ordered for a photo (stickers/magnets: portraits only). */
function productsForPhoto(products: Product[], isClassPhoto: boolean): Product[] {
  return products.filter((p) =>
    p.scope === 'portrait' ? !isClassPhoto : p.scope === 'group' ? isClassPhoto : true,
  );
}

/** The "Nur digital" download cannot be bought twice: blocked when owned or covered by the cart. */
function isBlocked(product: Product, state: PhotoState): boolean {
  return product.type === 'digital' && (state.purchased || state.digitalInCart);
}

function firstSelectable(products: Product[], state: PhotoState): string {
  return products.find((p) => !isBlocked(p, state))?.id ?? products[0]?.id ?? '';
}

/** Short facts shown beneath a product name (what is included, tiered price). */
function productHints(p: Product): string[] {
  const hints: string[] = [];
  if (p.type === 'digital') hints.push('Download in voller Auflösung');
  if (p.includes_digital) hints.push('digitale Datei inbegriffen');
  if (p.type === 'print' && !p.includes_digital) hints.push('ohne digitale Datei');
  if (hasTieredPrice(p.price_cents, p.additional_price_cents)) {
    hints.push(`jedes weitere ${formatPrice(p.additional_price_cents ?? 0, p.currency)}`);
  }
  if (p.type === 'print') hints.push('wird per Post versandt');
  return hints;
}

export default function Gallery() {
  const [groups, setGroups] = useState<PhotoGroup[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // Whether the sellable products could be loaded. When this fails (or no
  // product is configured) the photos are still shown, but we explain clearly
  // why the order controls are missing instead of leaving a silent,
  // broken-looking gallery where nothing can be ordered.
  const [productsFailed, setProductsFailed] = useState(false);
  const [active, setActive] = useState<Photo | null>(null);
  // Per-photo purchase/cart state. Seeded from the server and updated locally
  // whenever something is added, so the controls react instantly (e.g. the
  // download option is greyed out once a print that includes it is in the cart).
  const [states, setStates] = useState<Record<string, PhotoState>>({});
  const { refresh: refreshCart } = useCart();

  useEffect(() => {
    (async () => {
      // Load photos and the sellable products independently. A failing (or
      // empty) product list must never take the whole gallery down: the photos
      // always render; the buy controls degrade gracefully with an explanation.
      try {
        const photoRes = await api<{ groups: PhotoGroup[] }>('/api/parent/photos');
        setGroups(photoRes.groups);
        const next: Record<string, PhotoState> = {};
        for (const g of photoRes.groups) {
          for (const p of g.photos) {
            next[p.id] = {
              purchased: !!p.purchased,
              inCart: !!p.inCart,
              digitalInCart: !!p.digitalInCart,
            };
          }
        }
        setStates(next);
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

  const stateOf = (p: Photo): PhotoState =>
    states[p.id] ?? { purchased: p.purchased, inCart: p.inCart, digitalInCart: p.digitalInCart };

  const onAdded = (photoId: string, product: Product) => {
    setStates((prev) => {
      const cur = prev[photoId] ?? { purchased: false, inCart: false, digitalInCart: false };
      return {
        ...prev,
        [photoId]: {
          ...cur,
          inCart: true,
          digitalInCart: cur.digitalInCart || product.type === 'digital' || product.includes_digital,
        },
      };
    });
    refreshCart();
  };

  if (loading) return <Spinner label="Fotos werden geladen …" />;

  const totalPhotos = groups.reduce((n, g) => n + g.photos.length, 0);
  const portraitOnlyProducts = products.filter((p) => p.scope === 'portrait');

  return (
    <div>
      <div className="row between mb">
        <div>
          <h1>Fotos</h1>
        </div>
      </div>

      {error && <Alert kind="error">{error}</Alert>}

      {/* Ohne verfügbare Produkte gibt es keine Bestell-Schaltflächen. Statt
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

      {totalPhotos > 0 && products.length > 0 && <PriceLegend products={products} />}

      {groups.map((g) => {
        const isGroupSection = g.kind === 'group';
        return (
          <section key={g.id} className="gallery-section">
            <div className="gallery-section-head">
              <h2>{g.title}</h2>
              <div className="gallery-section-actions">
                <span className="soft photo-count">
                  {g.photos.length} {g.photos.length === 1 ? 'Foto' : 'Fotos'}
                </span>
              </div>
            </div>
            {isGroupSection && portraitOnlyProducts.length > 0 && (
              <p className="soft gallery-section-note">
                Gruppenfotos gibt es als Druck oder als digitale Datei – Sticker und Magnete nur
                für Einzelfotos.
              </p>
            )}
            <div className="photo-grid">
              {g.photos.map((p) => {
                const state = stateOf(p);
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

                      {(state.purchased || state.inCart) && (
                        <div className="photo-state">
                          {state.purchased && <span className="pill green">✓ Download gekauft</span>}
                          {state.inCart && <span className="pill blue">✓ Im Warenkorb</span>}
                        </div>
                      )}
                    </div>

                    <PhotoControls
                      photo={p}
                      products={productsForPhoto(products, p.isClassPhoto)}
                      state={state}
                      onAdded={onAdded}
                    />
                  </figure>
                );
              })}
            </div>
          </section>
        );
      })}

      {totalPhotos > 0 && (
        <TrustNote>
          Vorschaubilder sind mit Wasserzeichen versehen. Die hochwertige Originaldatei erhalten Sie
          erst nach dem Kauf – bei jedem Druck (13×18 / 20×30 cm) ist sie inbegriffen.
        </TrustNote>
      )}

      {active && (
        <Lightbox
          photo={active}
          products={productsForPhoto(products, active.isClassPhoto)}
          state={stateOf(active)}
          onAdded={onAdded}
          onClose={() => setActive(null)}
        />
      )}
    </div>
  );
}

/**
 * Compact, collapsible overview of everything that can be ordered and what it
 * costs, so parents see the whole price list once instead of piecing it
 * together photo by photo.
 */
function PriceLegend({ products }: { products: Product[] }) {
  return (
    <details className="price-legend card">
      <summary>Produkte &amp; Preise im Überblick</summary>
      <ul>
        {products.map((p) => {
          const hints = productHints(p);
          if (p.scope === 'portrait') hints.push('nur für Einzelfotos');
          return (
            <li key={p.id}>
              <strong>{p.name}</strong> – {formatPrice(p.price_cents, p.currency)}
              {hints.length > 0 && <span className="soft"> · {hints.join(' · ')}</span>}
            </li>
          );
        })}
      </ul>
      <p className="soft price-legend-note">
        Preise pro Foto. Die digitale Datei ist bei jedem Druck inbegriffen – Sie müssen sie nicht
        zusätzlich bestellen.
      </p>
    </details>
  );
}

/**
 * Order controls beneath every photo (and inside the enlarged preview).
 *
 * All products are listed as one clearly labelled option list – no dropdown to
 * open first – with the price at the right and a short line underneath saying
 * what is included ("digitale Datei inbegriffen", "jedes weitere 4.-", …).
 * Selecting a sticker or magnet product shows a mockup of the finished product
 * built from the parent's own (watermarked) photo. One button adds the chosen
 * product with the chosen quantity and shows the resulting price.
 */
function PhotoControls({
  photo,
  products,
  state,
  onAdded,
  large = false,
}: {
  photo: Photo;
  products: Product[];
  state: PhotoState;
  onAdded: (photoId: string, product: Product) => void;
  /** Larger mockup (used inside the enlarged preview). */
  large?: boolean;
}) {
  const [selectedId, setSelectedId] = useState(() => firstSelectable(products, state));
  const [qtyText, setQtyText] = useState('1');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // Keep the selection valid: when the chosen option becomes unavailable (e.g.
  // the download was just added, or the product list changed) fall back to the
  // first selectable product.
  useEffect(() => {
    const current = products.find((p) => p.id === selectedId);
    if (!current || isBlocked(current, state)) {
      setSelectedId(firstSelectable(products, state));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, state.purchased, state.digitalInCart]);

  const selected = products.find((p) => p.id === selectedId) ?? null;
  const qty = Math.min(99, Math.max(1, Math.floor(Number(qtyText) || 1)));
  const isDigital = selected?.type === 'digital';
  const effectiveQty = isDigital ? 1 : qty;
  const total = selected
    ? lineTotalCents(selected.price_cents, selected.additional_price_cents, effectiveQty)
    : 0;
  const currency = selected?.currency ?? products[0]?.currency ?? 'chf';

  const select = (p: Product) => {
    if (isBlocked(p, state)) return;
    setSelectedId(p.id);
    setError('');
    setNotice('');
  };

  const changeQty = (next: number) => setQtyText(String(Math.min(99, Math.max(1, next))));

  const add = async () => {
    if (!selected) return;
    setError('');
    setNotice('');
    setBusy(true);
    try {
      const res = await api<{ ok: boolean; removedDigital?: boolean }>('/api/parent/cart', {
        method: 'POST',
        body: { photoId: photo.id, productId: selected.id, qty: effectiveQty },
      });
      onAdded(photo.id, selected);
      setQtyText('1');
      setNotice(
        res.removedDigital
          ? '✓ Im Warenkorb. Der separate Download wurde entfernt – die digitale Datei ist im Druck bereits inbegriffen.'
          : `✓ ${effectiveQty > 1 ? `${effectiveQty}× ` : ''}${selected.name} im Warenkorb.`,
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Konnte nicht hinzugefügt werden.');
    } finally {
      setBusy(false);
    }
  };

  if (products.length === 0) return null;

  return (
    <div className={`photo-buy${large ? ' large' : ''}`}>
      {error && <Alert kind="error">{error}</Alert>}

      <div className="product-options" role="radiogroup" aria-label="Produkt wählen">
        {products.map((p) => {
          const blocked = isBlocked(p, state);
          const checked = p.id === selectedId && !blocked;
          const hints = blocked
            ? [state.purchased ? 'bereits gekauft – siehe Bestellungen' : 'bereits im Warenkorb bzw. im Druck inbegriffen']
            : productHints(p);
          return (
            <button
              type="button"
              key={p.id}
              role="radio"
              aria-checked={checked}
              aria-disabled={blocked || undefined}
              className={`product-option${checked ? ' selected' : ''}${blocked ? ' blocked' : ''}`}
              onClick={() => select(p)}
            >
              <span className="product-option-radio" aria-hidden="true" />
              <span className="product-option-main">
                <span className="product-option-name">{p.name}</span>
                <span className="product-option-sub">
                  {hints.map((h, i) => (
                    <span key={h} className={h === 'digitale Datei inbegriffen' ? 'incl' : undefined}>
                      {i > 0 ? ' · ' : ''}
                      {h === 'digitale Datei inbegriffen' ? '✓ ' : ''}
                      {h}
                    </span>
                  ))}
                </span>
              </span>
              <span className="product-option-price">{formatPrice(p.price_cents, p.currency)}</span>
            </button>
          );
        })}
      </div>

      {selected && (
        <div className="product-detail">
          {hasMockup(selected.kind) && (
            <div className="product-mockup-wrap">
              <ProductMockup
                kind={selected.kind}
                src={photo.thumbUrl}
                className={large ? 'mock-large' : undefined}
              />
              <p className="product-mockup-note">
                Unverbindliche Vorschau mit Ihrem Foto – das Wasserzeichen erscheint nur hier, nicht
                auf dem fertigen Produkt. Ausschnitt und Farben können leicht abweichen.
              </p>
            </div>
          )}

          {!isDigital && (
            <div className="qty-row">
              <span className="qty-label" id={`qty-label-${photo.id}`}>
                Menge
              </span>
              <div className="qty-stepper" role="group" aria-labelledby={`qty-label-${photo.id}`}>
                <button
                  type="button"
                  onClick={() => changeQty(qty - 1)}
                  disabled={qty <= 1 || busy}
                  aria-label="Menge verringern"
                >
                  −
                </button>
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={99}
                  value={qtyText}
                  onChange={(e) => setQtyText(e.target.value)}
                  onBlur={() => setQtyText(String(qty))}
                  aria-label="Menge"
                />
                <button
                  type="button"
                  onClick={() => changeQty(qty + 1)}
                  disabled={qty >= 99 || busy}
                  aria-label="Menge erhöhen"
                >
                  +
                </button>
              </div>
              {qty > 1 && hasTieredPrice(selected.price_cents, selected.additional_price_cents) && (
                <span className="qty-hint">
                  1× {formatPrice(selected.price_cents, currency)} + {qty - 1}×{' '}
                  {formatPrice(selected.additional_price_cents ?? 0, currency)}
                </span>
              )}
            </div>
          )}

          <button type="button" className="btn block" onClick={add} disabled={busy}>
            {busy ? 'Wird hinzugefügt …' : `In den Warenkorb · ${formatPrice(total, currency)}`}
          </button>
        </div>
      )}

      {notice && <p className="buy-success">{notice}</p>}

      {state.inCart && (
        <Link to="/warenkorb" className="linklike buy-cart-link">
          Zum Warenkorb
        </Link>
      )}
    </div>
  );
}

function Lightbox({
  photo,
  products,
  state,
  onAdded,
  onClose,
}: {
  photo: Photo;
  products: Product[];
  state: PhotoState;
  onAdded: (photoId: string, product: Product) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const previewSrc = useMemo(() => imageUrl(photo.previewUrl), [photo.previewUrl]);

  return (
    <div className="lightbox" onClick={onClose}>
      <div className="inner" onClick={(e) => e.stopPropagation()}>
        <button className="close" onClick={onClose} aria-label="Schliessen">
          ×
        </button>
        <img
          src={previewSrc}
          alt="Vergrösserte Vorschau des Fotos (mit Wasserzeichen)"
          draggable={false}
          onContextMenu={(e) => e.preventDefault()}
        />
        <div className="lb-actions lb-actions-buy">
          <PhotoControls photo={photo} products={products} state={state} onAdded={onAdded} large />
        </div>
      </div>
    </div>
  );
}
