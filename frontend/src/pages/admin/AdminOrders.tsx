import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../../api/client';
import { Alert, Modal, SendToSelfCheckbox, Spinner, StatusBadge } from '../../components/common';
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

interface ShippingAddress {
  first_name: string;
  last_name: string;
  street: string;
  house_no: string;
  zip: string;
  city: string;
}
interface DetailItem {
  id: string;
  photo_id: string;
  product_name: string;
  product_type?: string;
  qty: number;
  unit_price_cents: number;
  original_filename: string;
}
interface OrderDetail {
  order: {
    id: string;
    email: string;
    status: string;
    currency: string;
    total_cents: number;
    created_at: string;
    payment_provider: string | null;
    payment_ref: string | null;
    shipping_address?: ShippingAddress | null;
  };
  items: DetailItem[];
}

const STATUS_OPTIONS = [
  { value: 'pending', label: 'Pendent' },
  { value: 'completed', label: 'Abgeschlossen' },
  { value: 'cancelled', label: 'Storniert' },
] as const;

type Filter = 'all' | 'print' | 'pending';

const FILTER_STORAGE_KEY = 'admin_orders_filter';

function initialFilter(): Filter {
  const stored = sessionStorage.getItem(FILTER_STORAGE_KEY);
  return stored === 'print' || stored === 'pending' || stored === 'all' ? stored : 'all';
}

export default function AdminOrders() {
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  // Default to "Alle" so digital-only orders are never hidden behind a filter,
  // and remember the admin's last choice for the rest of the session.
  const [filter, setFilterState] = useState<Filter>(initialFilter);
  const setFilter = (f: Filter) => {
    sessionStorage.setItem(FILTER_STORAGE_KEY, f);
    setFilterState(f);
  };
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [details, setDetails] = useState<Record<string, OrderDetail>>({});
  const [loadingDetail, setLoadingDetail] = useState<Record<string, boolean>>({});
  const [showShipping, setShowShipping] = useState(false);
  const [shippingMsg, setShippingMsg] = useState('');

  const load = () =>
    api<{ orders: OrderRow[] }>('/api/admin/orders', { admin: true })
      .then((r) => setOrders(r.orders))
      .finally(() => setLoading(false));

  useEffect(() => {
    load();
  }, []);

  const fetchDetail = async (id: string) => {
    if (details[id] || loadingDetail[id]) return;
    setLoadingDetail((p) => ({ ...p, [id]: true }));
    try {
      const r = await api<OrderDetail>(`/api/admin/orders/${id}`, { admin: true });
      setDetails((p) => ({ ...p, [id]: r }));
    } finally {
      setLoadingDetail((p) => ({ ...p, [id]: false }));
    }
  };

  const toggle = (id: string) => {
    setExpanded((p) => {
      const next = !p[id];
      if (next) void fetchDetail(id);
      return { ...p, [id]: next };
    });
  };

  const setStatus = async (id: string, status: string) => {
    // Optimistic update so the list reacts instantly.
    setOrders((prev) => prev.map((o) => (o.id === id ? { ...o, status } : o)));
    setDetails((prev) => {
      const d = prev[id];
      if (!d) return prev;
      return { ...prev, [id]: { ...d, order: { ...d.order, status } } };
    });
    await api(`/api/admin/orders/${id}`, { method: 'PATCH', admin: true, body: { status } });
    // Refresh the cached detail so the table reflects any derived changes.
    setDetails((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    if (expanded[id]) void fetchDetail(id);
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
        Alle bestätigten Bestellungen. Klicke auf eine Bestellung, um alle Details aufzuklappen. Den
        Status kannst du direkt hier anpassen. Mit den Filtern kannst du gezielt nur Bestellungen mit
        Druckprodukt oder pendente Bestellungen anzeigen.
      </p>

      {shippingMsg && <Alert kind="success">{shippingMsg}</Alert>}

      <div className="card mb">
        <div className="row" style={{ gap: 8 }}>
          <FilterButton active={filter === 'all'} onClick={() => setFilter('all')}>
            Alle ({counts.all})
          </FilterButton>
          <FilterButton active={filter === 'print'} onClick={() => setFilter('print')}>
            Nur mit Druck ({counts.print})
          </FilterButton>
          <FilterButton active={filter === 'pending'} onClick={() => setFilter('pending')}>
            Pendent ({counts.pending})
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
            {filtered.map((o) => {
              const isOpen = !!expanded[o.id];
              return (
                <div
                  key={o.id}
                  style={{
                    border: '1px solid var(--border)',
                    borderRadius: 12,
                    overflow: 'hidden',
                  }}
                >
                  <div
                    role="button"
                    tabIndex={0}
                    aria-expanded={isOpen}
                    onClick={() => toggle(o.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        toggle(o.id);
                      }
                    }}
                    className="row between"
                    style={{ alignItems: 'flex-start', padding: 14, cursor: 'pointer', gap: 10 }}
                  >
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
                    <div
                      className="row"
                      style={{ gap: 10, alignItems: 'center' }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {o.has_print && (
                        <button
                          type="button"
                          className="btn secondary small"
                          onClick={() => {
                            setShippingMsg('');
                            setShowShipping(true);
                          }}
                        >
                          Versandbestätigung schicken
                        </button>
                      )}
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
                      <Chevron open={isOpen} onClick={() => toggle(o.id)} />
                    </div>
                  </div>

                  {isOpen && (
                    <div
                      style={{
                        padding: 14,
                        paddingTop: 0,
                        borderTop: '1px solid var(--border)',
                        marginTop: 0,
                      }}
                    >
                      <OrderDetailBody
                        loading={!!loadingDetail[o.id] && !details[o.id]}
                        detail={details[o.id]}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {showShipping && (
        <ShippingConfirmationModal
          onClose={() => setShowShipping(false)}
          onSent={(message) => {
            setShowShipping(false);
            setShippingMsg(message);
          }}
        />
      )}
    </div>
  );
}

function OrderDetailBody({ loading, detail }: { loading: boolean; detail?: OrderDetail }) {
  if (loading || !detail) return <Spinner />;
  const { order, items } = detail;
  const printItems = items.filter((i) => i.product_type === 'print');
  const address = order.shipping_address;

  return (
    <div style={{ paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 16 }}>
      {address ? (
        <div>
          <h3 style={{ margin: '0 0 6px' }}>Lieferadresse</h3>
          <div style={{ fontSize: '0.9rem', lineHeight: 1.5 }}>
            {address.first_name} {address.last_name}
            <br />
            {address.street} {address.house_no}
            <br />
            {address.zip} {address.city}
          </div>
        </div>
      ) : order.payment_provider ? (
        <p className="muted" style={{ fontSize: '0.82rem', margin: 0 }}>
          Zahlung: {order.payment_provider}
        </p>
      ) : null}

      {printItems.length > 0 && (
        <div>
          <h3 style={{ margin: '0 0 6px' }}>Zum Ausdrucken</h3>
          <p className="muted" style={{ fontSize: '0.82rem', marginTop: 0 }}>
            Diese Positionen enthalten ein Druckprodukt und müssen versendet werden.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
            {printItems.map((i) => (
              <div key={i.id} style={{ width: 120 }}>
                <AdminThumb photoId={i.photo_id} size={120} />
                <div
                  className="muted"
                  style={{ fontSize: '0.74rem', marginTop: 6 }}
                  title={i.original_filename}
                >
                  {i.qty}× {i.product_name}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <h3 style={{ margin: '0 0 6px' }}>Positionen</h3>
        <table>
          <thead>
            <tr>
              <th>Produkt</th>
              <th>Art</th>
              <th>Datei</th>
              <th>Menge</th>
              <th>Preis</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.id}>
                <td>{i.product_name}</td>
                <td>{i.product_type === 'print' ? 'Druck' : 'Digital'}</td>
                <td className="muted">{i.original_filename}</td>
                <td>{i.qty}</td>
                <td>{formatPrice(i.unit_price_cents * i.qty, order.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="row between mt">
          <span className="soft">Gesamt</span>
          <strong>{formatPrice(order.total_cents, order.currency)}</strong>
        </div>
      </div>
    </div>
  );
}

function Chevron({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className="btn ghost small"
      aria-label={open ? 'Einklappen' : 'Ausklappen'}
      onClick={onClick}
      style={{ padding: '4px 8px', lineHeight: 1, display: 'inline-flex', alignItems: 'center' }}
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ transition: 'transform 0.18s ease', transform: open ? 'rotate(180deg)' : 'none' }}
      >
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </button>
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

interface PrintRecipient {
  id: string;
  email: string;
  name: string;
  status: string;
  verified: boolean;
}
interface PrintRecipients {
  emails: PrintRecipient[];
  adminEmail: string;
  devLogOnly: boolean;
}

/**
 * Versand-Popup für die Versandbestätigung der ausgedruckten Fotos. Zeigt alle
 * (aktiven) Eltern-Adressen, die ein Druckprodukt bestellt haben – standard-
 * mässig sind alle ausgewählt. Aufbau analog zum Erinnerungs-Popup unter
 * „Aufträge“. Optional geht eine Kopie an das eigene Admin-Konto.
 */
function ShippingConfirmationModal({
  onClose,
  onSent,
}: {
  onClose: () => void;
  onSent: (msg: string) => void;
}) {
  const [data, setData] = useState<PrintRecipients | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sendToSelf, setSendToSelf] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api<PrintRecipients>('/api/admin/orders/print-recipients', { admin: true })
      .then((r) => {
        setData(r);
        // Standardmässig sind alle Druck-Besteller ausgewählt.
        setSelected(new Set(r.emails.map((e) => e.id)));
      })
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : 'Empfänger konnten nicht ermittelt werden.'),
      )
      .finally(() => setLoading(false));
  }, []);

  const emails = data?.emails ?? [];

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const allChecked = emails.length > 0 && selected.size === emails.length;
  const toggleAll = () => setSelected(allChecked ? new Set() : new Set(emails.map((e) => e.id)));

  const send = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await api<{
        sent: number;
        failed: number;
        total: number;
        sentToSelf: boolean;
        devLogOnly: boolean;
      }>('/api/admin/orders/send-shipping-confirmation', {
        method: 'POST',
        admin: true,
        body: { emailIds: Array.from(selected), sendToSelf },
      });
      const extra = res.failed > 0 ? ` ${res.failed} konnten nicht zugestellt werden.` : '';
      const self = res.sentToSelf ? ' Eine Kopie wurde an dich gesendet.' : '';
      const note = res.devLogOnly
        ? ' Hinweis: Kein SMTP konfiguriert – die E-Mails wurden nur ins Server-Log geschrieben.'
        : '';
      onSent(
        `Versandbestätigung an ${res.sent} von ${res.total} Adresse(n) gesendet.${extra}${self}${note}`,
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Versand fehlgeschlagen.');
      setBusy(false);
    }
  };

  const canSend = !loading && !busy && (selected.size > 0 || sendToSelf);
  const hasAny = emails.length > 0;

  return (
    <Modal
      title="Versandbestätigung schicken"
      width={680}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>
            Abbrechen
          </button>
          <button type="button" className="btn" onClick={send} disabled={!canSend}>
            {busy ? 'Wird gesendet …' : 'Jetzt senden'}
          </button>
        </>
      }
    >
      {error && <Alert kind="error">{error}</Alert>}
      <p style={{ fontSize: '0.92rem', lineHeight: 1.6, marginTop: 0 }}>
        Die Versandbestätigung informiert die Eltern, dass ihre ausgedruckten Fotos heute verschickt
        wurden. Standardmässig sind alle Adressen ausgewählt, die ein Produkt zum Ausdrucken bestellt
        haben.
      </p>
      {loading ? (
        <p className="muted">Empfänger werden ermittelt …</p>
      ) : !hasAny ? (
        <Alert kind="error">Es gibt noch keine Bestellungen mit einem Druckprodukt.</Alert>
      ) : data ? (
        <>
          <div className="row between" style={{ marginBottom: 6 }}>
            <strong style={{ fontSize: '0.85rem' }}>
              {selected.size} von {emails.length} ausgewählt
            </strong>
            <button type="button" className="btn ghost small" onClick={toggleAll}>
              {allChecked ? 'Alle abwählen' : 'Alle auswählen'}
            </button>
          </div>
          <div
            style={{
              maxHeight: 340,
              overflow: 'auto',
              border: '1px solid var(--border)',
              borderRadius: 10,
            }}
          >
            <table className="dispatch-table">
              <thead>
                <tr>
                  <th>E-Mail-Adresse</th>
                  <th style={{ textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      checked={allChecked}
                      onChange={toggleAll}
                      aria-label="Alle auswählen"
                      style={{ width: 'auto', margin: 0 }}
                    />
                  </th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {emails.map((e) => (
                  <tr key={e.id} onClick={() => toggle(e.id)} style={{ cursor: 'pointer' }}>
                    <td className="dispatch-email">{e.email}</td>
                    <td style={{ textAlign: 'center' }}>
                      <input
                        type="checkbox"
                        checked={selected.has(e.id)}
                        onChange={() => toggle(e.id)}
                        onClick={(ev) => ev.stopPropagation()}
                        style={{ width: 'auto', margin: 0 }}
                      />
                    </td>
                    <td>
                      {e.verified ? (
                        <span className="badge green">Bestätigt</span>
                      ) : (
                        <span className="badge amber">Nicht bestätigt</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <SendToSelfCheckbox
            checked={sendToSelf}
            onChange={setSendToSelf}
            adminEmail={data.adminEmail}
          />
          {data.devLogOnly && (
            <p className="muted" style={{ fontSize: '0.8rem', marginTop: 8, marginBottom: 0 }}>
              Achtung: Kein SMTP konfiguriert – die E-Mails landen nur im Server-Log.
            </p>
          )}
        </>
      ) : null}
    </Modal>
  );
}
