import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError, imageUrl } from '../../api/client';
import { Alert, Spinner, TrustNote } from '../../components/common';
import { useCart } from '../../context/Cart';
import { formatPrice } from '../../lib/format';

interface CartItem {
  id: string;
  photoId: string;
  productName: string;
  productType: string;
  qty: number;
  unitPriceCents: number;
  thumbUrl: string;
}
interface CartData {
  total_cents: number;
  currency: string;
  items: CartItem[];
}

interface ShippingForm {
  firstName: string;
  lastName: string;
  street: string;
  houseNo: string;
  zip: string;
  city: string;
}

const EMPTY_ADDRESS: ShippingForm = {
  firstName: '',
  lastName: '',
  street: '',
  houseNo: '',
  zip: '',
  city: '',
};

export default function Cart() {
  const [cart, setCart] = useState<CartData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [qtyDraft, setQtyDraft] = useState<Record<string, string>>({});
  const [address, setAddress] = useState<ShippingForm>(EMPTY_ADDRESS);
  const navigate = useNavigate();
  const { refresh: refreshCart } = useCart();

  const hasPrint = !!cart?.items.some((i) => i.productType === 'print');
  const addressComplete = Object.values(address).every((v) => v.trim().length > 0);

  const load = async () => {
    try {
      const res = await api<{ cart: CartData }>('/api/parent/cart');
      setCart(res.cart);
      setQtyDraft({});
      refreshCart();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Warenkorb konnte nicht geladen werden.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const remove = async (id: string) => {
    await api(`/api/parent/cart/${id}`, { method: 'DELETE' });
    load();
  };

  const commitQty = async (item: CartItem) => {
    const raw = qtyDraft[item.id];
    if (raw === undefined) return;
    const qty = Math.min(99, Math.max(1, Math.floor(Number(raw) || 1)));
    if (qty === item.qty) {
      setQtyDraft((d) => {
        const next = { ...d };
        delete next[item.id];
        return next;
      });
      return;
    }
    try {
      await api(`/api/parent/cart/${item.id}`, { method: 'PATCH', body: { qty } });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Menge konnte nicht geändert werden.');
    }
  };

  const checkout = async () => {
    setError('');
    if (hasPrint && !addressComplete) {
      setError('Bitte füllen Sie alle Felder der Lieferadresse aus, damit wir die Fotos ausdrucken und versenden können.');
      return;
    }
    setBusy(true);
    try {
      const res = await api<{ mode: string; checkoutUrl?: string; orderId: string }>(
        '/api/parent/checkout',
        {
          method: 'POST',
          body: hasPrint ? { shippingAddress: address } : {},
        },
      );
      if (res.mode === 'stripe' && res.checkoutUrl) {
        window.location.href = res.checkoutUrl;
        return;
      }
      // Manual/test flow: confirm directly and go to the order.
      await api('/api/parent/checkout/confirm', { method: 'POST', body: { orderId: res.orderId } });
      navigate(`/bestellung/${res.orderId}?status=success`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Kauf konnte nicht gestartet werden.');
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Spinner />;

  return (
    <div className="narrow" style={{ margin: '0 auto' }}>
      <h1>Warenkorb</h1>
      {error && <Alert kind="error">{error}</Alert>}

      {!cart || cart.items.length === 0 ? (
        <div className="card center">
          <p className="soft">Der Warenkorb ist leer.</p>
          <Link to="/galerie" className="btn">
            Zur Galerie
          </Link>
        </div>
      ) : (
        <>
          <div className="card">
            <ul className="list-reset">
              {cart.items.map((item) => (
                <li key={item.id} className="line-item">
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
                    {item.productType === 'digital' ? (
                      <div className="muted" style={{ fontSize: '0.85rem' }}>
                        Digitaler Download
                      </div>
                    ) : (
                      <div
                        className="muted"
                        style={{ fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}
                      >
                        <label htmlFor={`qty-${item.id}`}>Menge</label>
                        <input
                          id={`qty-${item.id}`}
                          type="number"
                          inputMode="numeric"
                          min={1}
                          max={99}
                          value={qtyDraft[item.id] ?? String(item.qty)}
                          onChange={(e) =>
                            setQtyDraft((d) => ({ ...d, [item.id]: e.target.value }))
                          }
                          onBlur={() => commitQty(item)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                          }}
                          style={{ width: 64, padding: '4px 8px' }}
                        />
                      </div>
                    )}
                  </div>
                  <div className="li-price">
                    {formatPrice(item.unitPriceCents * item.qty, cart.currency)}
                  </div>
                  <button className="btn ghost small li-action" onClick={() => remove(item.id)}>
                    Entfernen
                  </button>
                </li>
              ))}
            </ul>
            <div className="row between" style={{ marginTop: 16 }}>
              <span className="soft">Gesamt</span>
              <strong style={{ fontSize: '1.2rem' }}>
                {formatPrice(cart.total_cents, cart.currency)}
              </strong>
            </div>
          </div>

          {hasPrint && (
            <div className="card mt">
              <h2 style={{ marginTop: 0, fontSize: '1.1rem' }}>Lieferadresse für ausgedruckte Fotos</h2>
              <p className="muted" style={{ fontSize: '0.85rem', marginTop: 0 }}>
                Ihre Bestellung enthält Fotos zum Ausdrucken. Bitte geben Sie an, wohin wir die
                gedruckten Fotos senden dürfen. Der Versand erfolgt in ca. 3–4 Wochen.
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                <AddressField
                  label="Vorname"
                  value={address.firstName}
                  onChange={(v) => setAddress((a) => ({ ...a, firstName: v }))}
                  autoComplete="given-name"
                />
                <AddressField
                  label="Name"
                  value={address.lastName}
                  onChange={(v) => setAddress((a) => ({ ...a, lastName: v }))}
                  autoComplete="family-name"
                />
                <AddressField
                  label="Strasse"
                  value={address.street}
                  onChange={(v) => setAddress((a) => ({ ...a, street: v }))}
                  autoComplete="address-line1"
                  grow
                />
                <AddressField
                  label="Nr."
                  value={address.houseNo}
                  onChange={(v) => setAddress((a) => ({ ...a, houseNo: v }))}
                  width={90}
                />
                <AddressField
                  label="PLZ"
                  value={address.zip}
                  onChange={(v) => setAddress((a) => ({ ...a, zip: v }))}
                  autoComplete="postal-code"
                  width={110}
                />
                <AddressField
                  label="Ort"
                  value={address.city}
                  onChange={(v) => setAddress((a) => ({ ...a, city: v }))}
                  autoComplete="address-level2"
                  grow
                />
              </div>
            </div>
          )}

          <button
            className="btn block mt"
            onClick={checkout}
            disabled={busy || (hasPrint && !addressComplete)}
          >
            {busy ? 'Einen Moment …' : 'Kauf abschliessen'}
          </button>

          <div style={{ marginTop: 18 }}>
            <TrustNote>
              Der Kauf ist nur mit Ihrer bestätigten E-Mail-Adresse möglich. Nach dem Kauf erhalten
              Sie eine Bestätigung und – bei digitalen Produkten – Ihre Download-Dateien.
            </TrustNote>
          </div>
        </>
      )}
    </div>
  );
}

function AddressField({
  label,
  value,
  onChange,
  autoComplete,
  width,
  grow,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete?: string;
  width?: number;
  grow?: boolean;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: grow ? '1 1 160px' : '0 0 auto' }}>
      <label style={{ fontSize: '0.82rem' }}>{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        style={{ width: width ?? (grow ? '100%' : 150), padding: '6px 8px' }}
      />
    </div>
  );
}
