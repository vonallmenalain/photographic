import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError, imageUrl } from '../../api/client';
import { Alert, Spinner, TrustNote } from '../../components/common';
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

export default function Cart() {
  const [cart, setCart] = useState<CartData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [qtyDraft, setQtyDraft] = useState<Record<string, string>>({});
  const navigate = useNavigate();

  const load = async () => {
    try {
      const res = await api<{ cart: CartData }>('/api/parent/cart');
      setCart(res.cart);
      setQtyDraft({});
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
    setBusy(true);
    try {
      const res = await api<{ mode: string; checkoutUrl?: string; orderId: string }>(
        '/api/parent/checkout',
        { method: 'POST' },
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
                <li
                  key={item.id}
                  style={{
                    display: 'flex',
                    gap: 14,
                    alignItems: 'center',
                    padding: '12px 0',
                    borderBottom: '1px solid var(--border)',
                  }}
                >
                  <img
                    src={imageUrl(item.thumbUrl)}
                    alt=""
                    width={64}
                    height={64}
                    style={{ borderRadius: 8, objectFit: 'cover' }}
                    draggable={false}
                  />
                  <div style={{ flex: 1 }}>
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
                  <div style={{ fontWeight: 600 }}>
                    {formatPrice(item.unitPriceCents * item.qty, cart.currency)}
                  </div>
                  <button className="btn ghost small" onClick={() => remove(item.id)}>
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

          <button className="btn block mt" onClick={checkout} disabled={busy}>
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
