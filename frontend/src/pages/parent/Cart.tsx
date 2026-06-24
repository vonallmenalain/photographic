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
  const navigate = useNavigate();

  const load = async () => {
    try {
      const res = await api<{ cart: CartData }>('/api/parent/cart');
      setCart(res.cart);
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
          <p className="soft">Dein Warenkorb ist leer.</p>
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
                    <div className="muted" style={{ fontSize: '0.85rem' }}>
                      {item.productType === 'digital'
                        ? 'Digitaler Download'
                        : `Druck · Menge ${item.qty}`}
                    </div>
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
            {busy ? 'Einen Moment …' : 'Kauf abschließen'}
          </button>

          <div style={{ marginTop: 18 }}>
            <TrustNote>
              Der Kauf ist nur mit deiner bestätigten E-Mail-Adresse möglich. Nach dem Kauf erhältst
              du eine Bestätigung und – bei digitalen Produkten – deine Download-Dateien.
            </TrustNote>
          </div>
        </>
      )}
    </div>
  );
}
