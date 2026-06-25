import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import { Spinner, StatusBadge } from '../../components/common';
import { AdminThumb } from '../../components/AdminThumb';
import { formatPrice, formatDate } from '../../lib/format';

interface PrintItem {
  photo_id: string;
  product_name: string;
  qty: number;
  child_name: string | null;
}
interface OrderRow {
  id: string;
  email: string;
  status: string;
  total_cents: number;
  currency: string;
  created_at: string;
  item_count: number;
  has_print: boolean;
  print_items: PrintItem[];
}

const STATUS_OPTIONS = [
  { value: 'pending', label: 'Pendent' },
  { value: 'completed', label: 'Abgeschlossen' },
  { value: 'cancelled', label: 'Storniert' },
] as const;

type Filter = 'all' | 'print' | 'pending';

export default function AdminOrders() {
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('print');

  const load = () =>
    api<{ orders: OrderRow[] }>('/api/admin/orders', { admin: true })
      .then((r) => setOrders(r.orders))
      .finally(() => setLoading(false));

  useEffect(() => {
    load();
  }, []);

  const setStatus = async (id: string, status: string) => {
    // Optimistic update so the list reacts instantly.
    setOrders((prev) => prev.map((o) => (o.id === id ? { ...o, status } : o)));
    await api(`/api/admin/orders/${id}`, { method: 'PATCH', admin: true, body: { status } });
    load();
  };

  const filtered = useMemo(() => {
    if (filter === 'print') return orders.filter((o) => o.has_print);
    if (filter === 'pending') return orders.filter((o) => o.status === 'pending');
    return orders;
  }, [orders, filter]);

  const counts = useMemo(
    () => ({
      all: orders.length,
      print: orders.filter((o) => o.has_print).length,
      pending: orders.filter((o) => o.status === 'pending').length,
    }),
    [orders],
  );

  if (loading) return <Spinner />;

  return (
    <div>
      <h1>Bestellungen</h1>
      <p className="soft">
        Im Fokus stehen Bestellungen mit einem Produkt zum Ausdrucken. Du kannst den Status direkt
        hier anpassen.
      </p>

      <div className="card mb">
        <div className="row" style={{ gap: 8 }}>
          <FilterButton active={filter === 'print'} onClick={() => setFilter('print')}>
            Nur mit Druck ({counts.print})
          </FilterButton>
          <FilterButton active={filter === 'pending'} onClick={() => setFilter('pending')}>
            Pendent ({counts.pending})
          </FilterButton>
          <FilterButton active={filter === 'all'} onClick={() => setFilter('all')}>
            Alle ({counts.all})
          </FilterButton>
        </div>
      </div>

      <div className="card">
        {filtered.length === 0 ? (
          <p className="muted">
            {filter === 'all' ? 'Noch keine Bestellungen.' : 'Keine Bestellungen für diesen Filter.'}
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {filtered.map((o) => (
              <div
                key={o.id}
                style={{
                  border: '1px solid var(--border)',
                  borderRadius: 12,
                  padding: 14,
                }}
              >
                <div className="row between" style={{ alignItems: 'flex-start' }}>
                  <div style={{ minWidth: 0 }}>
                    <div className="row" style={{ gap: 10, alignItems: 'center' }}>
                      <StatusBadge status={o.status} />
                      {o.has_print && <span className="badge class">Druck</span>}
                      <strong style={{ wordBreak: 'break-all' }}>{o.email}</strong>
                    </div>
                    <div className="muted" style={{ fontSize: '0.82rem', marginTop: 4 }}>
                      {formatDate(o.created_at)} · {o.item_count} Position(en) ·{' '}
                      {formatPrice(o.total_cents, o.currency)}
                    </div>
                  </div>
                  <div className="row" style={{ gap: 10 }}>
                    <select
                      value={o.status}
                      onChange={(e) => setStatus(o.id, e.target.value)}
                      style={{ width: 170 }}
                    >
                      {!STATUS_OPTIONS.some((s) => s.value === o.status) && (
                        <option value={o.status}>{o.status}</option>
                      )}
                      {STATUS_OPTIONS.map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                    <Link className="btn ghost small" to={o.id}>
                      Details
                    </Link>
                  </div>
                </div>

                {o.status === 'pending' && o.print_items.length > 0 && (
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: 12,
                      marginTop: 12,
                      paddingTop: 12,
                      borderTop: '1px solid var(--border)',
                    }}
                  >
                    {o.print_items.map((it) => (
                      <div key={it.photo_id} style={{ width: 96 }}>
                        <AdminThumb photoId={it.photo_id} size={96} />
                        <div className="muted" style={{ fontSize: '0.72rem', marginTop: 4 }}>
                          {it.qty}× {it.product_name}
                          {it.child_name ? ` · ${it.child_name}` : ''}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function FilterButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button className={`btn small ${active ? '' : 'ghost'}`} onClick={onClick} type="button">
      {children}
    </button>
  );
}
