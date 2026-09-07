import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../../api/client';
import { Alert, Modal, SendToSelfCheckbox, Spinner, StatusBadge } from '../../components/common';
import { AdminThumb } from '../../components/AdminThumb';
import { formatPrice, formatDate, formatDateShort, productKindLabel } from '../../lib/format';
import { SummaryStat } from './EventAnalyticsPanel';

interface PrintItem {
  photo_id: string;
  product_name: string;
  kind?: string;
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
  /** Auftrag (Schule/Klasse) der Bestellung – vom Backend aus den Fotos abgeleitet. */
  event_id?: string | null;
  event_name?: string;
  /** Weitere Aufträge, falls eine Bestellung Fotos aus mehreren Aufträgen enthält. */
  other_event_names?: string[];
  /** Kinder, deren Fotos in der Bestellung vorkommen. */
  child_names?: string[];
  /** Vom Backend vorberechneter Freitext-Index (alles in Kleinbuchstaben). */
  search_text?: string;
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
  product_kind?: string;
  includes_digital?: number;
  qty: number;
  unit_price_cents: number;
  additional_price_cents?: number | null;
  line_total_cents?: number;
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

type SortKey = 'recent' | 'name_asc' | 'orders_desc' | 'revenue_desc';

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'recent', label: 'Neueste Bestellung zuerst' },
  { value: 'name_asc', label: 'Auftrag A–Z' },
  { value: 'orders_desc', label: 'Meiste Bestellungen zuerst' },
  { value: 'revenue_desc', label: 'Höchster Umsatz zuerst' },
];

/** Sammelkachel für Bestellungen, deren Fotos zu keinem Auftrag mehr gehören. */
const NO_EVENT_KEY = '__none__';
const NO_EVENT_LABEL = 'Ohne Auftrag';

const STORAGE = {
  filter: 'admin_orders_filter',
  search: 'admin_orders_search',
  event: 'admin_orders_event',
  sort: 'admin_orders_sort',
  collapsed: 'admin_orders_collapsed',
};

/** Kleiner Helfer: Auswahl für die Dauer der Sitzung merken (pro Browser-Tab). */
function readStored(key: string, fallback = ''): string {
  try {
    return sessionStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}
function writeStored(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    /* privater Modus o. ä. – die Auswahl wird dann einfach nicht gemerkt */
  }
}

function initialFilter(): Filter {
  const stored = readStored(STORAGE.filter);
  return stored === 'print' || stored === 'pending' || stored === 'all' ? stored : 'all';
}
function initialSort(): SortKey {
  const stored = readStored(STORAGE.sort);
  return SORT_OPTIONS.some((o) => o.value === stored) ? (stored as SortKey) : 'recent';
}
function initialCollapsed(): Set<string> {
  const stored = readStored(STORAGE.collapsed);
  return new Set(stored ? stored.split('\n').filter(Boolean) : []);
}

/** Ein Auftrag (Schule/Klasse) mit allen zugehörigen Bestellungen. */
interface OrderGroup {
  key: string;
  name: string;
  orders: OrderRow[];
  /** Anzahl pendenter Bestellungen – das, was noch zu tun ist. */
  pending: number;
  /** Anzahl Bestellungen mit Druckprodukt (Fotos, Sticker, Magnete). */
  print: number;
  /** Umsatz ohne stornierte Bestellungen. */
  revenue_cents: number;
  currency: string;
  /** Zeitpunkt der neuesten Bestellung des Auftrags. */
  latest: string;
}

/**
 * Fasst die Bestellungen zu Kacheln je Auftrag zusammen. Eine Bestellung trägt
 * selbst keinen Auftrag – das Backend leitet ihn aus den bestellten Fotos ab.
 */
function buildGroups(orders: OrderRow[]): OrderGroup[] {
  const groups = new Map<string, OrderGroup>();
  for (const o of orders) {
    const key = o.event_id || NO_EVENT_KEY;
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        name: o.event_name || NO_EVENT_LABEL,
        orders: [],
        pending: 0,
        print: 0,
        revenue_cents: 0,
        currency: o.currency || 'chf',
        latest: o.created_at,
      };
      groups.set(key, group);
    }
    group.orders.push(o);
    if (o.status === 'pending') group.pending += 1;
    if (o.has_print) group.print += 1;
    // Stornierte Bestellungen zählen nicht zum Umsatz.
    if (o.status !== 'cancelled') group.revenue_cents += o.total_cents;
    if (String(o.created_at) > String(group.latest)) group.latest = o.created_at;
  }
  return [...groups.values()];
}

/**
 * Bestellübersicht des Adminbereichs, gruppiert nach Auftrag (Schule/Klasse):
 * je Auftrag eine Kachel mit den Eckwerten (Bestellungen, Druck, Umsatz), darin
 * die einzelnen Bestellungen zum Aufklappen. Oben lässt sich nach Auftrag,
 * E-Mail-Adresse oder Kind suchen, gezielt ein einzelner Auftrag auswählen und
 * die Reihenfolge der Kacheln bestimmen.
 */
export default function AdminOrders() {
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  // Default to "Alle" so digital-only orders are never hidden behind a filter,
  // and remember the admin's last choice for the rest of the session.
  const [filter, setFilterState] = useState<Filter>(initialFilter);
  const setFilter = (f: Filter) => {
    writeStored(STORAGE.filter, f);
    setFilterState(f);
  };
  const [collapsed, setCollapsedState] = useState<Set<string>>(initialCollapsed);
  const setCollapsed = (next: Set<string>) => {
    writeStored(STORAGE.collapsed, [...next].join('\n'));
    setCollapsedState(next);
  };
  const [search, setSearchState] = useState(() => readStored(STORAGE.search));
  const setSearch = (value: string) => {
    writeStored(STORAGE.search, value);
    setSearchState(value);
  };
  const [eventFilter, setEventFilterState] = useState(() => readStored(STORAGE.event, 'all'));
  const setEventFilter = (value: string) => {
    writeStored(STORAGE.event, value);
    setEventFilterState(value);
    // Wer gezielt einen Auftrag auswählt, will dessen Bestellungen sehen – auch
    // wenn die Kachel zuvor eingeklappt war.
    if (value !== 'all' && collapsed.has(value)) {
      const next = new Set(collapsed);
      next.delete(value);
      setCollapsed(next);
    }
  };
  const [sort, setSortState] = useState<SortKey>(initialSort);
  const setSort = (value: SortKey) => {
    writeStored(STORAGE.sort, value);
    setSortState(value);
  };
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [details, setDetails] = useState<Record<string, OrderDetail>>({});
  const [loadingDetail, setLoadingDetail] = useState<Record<string, boolean>>({});
  const [shippingOrder, setShippingOrder] = useState<OrderRow | null>(null);
  // Zu löschende Bestellung – das Popup fragt vor dem endgültigen Entfernen nach.
  const [deletingOrder, setDeletingOrder] = useState<OrderRow | null>(null);
  // Rückmeldung zur letzten Aktion (Versandbestätigung bzw. Löschen).
  const [notice, setNotice] = useState('');

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

  /**
   * Räumt eine gelöschte Bestellung aus dem lokalen Zustand. Die Liste reagiert
   * damit sofort; `load()` holt anschliessend den Serverstand nach, damit Kachel,
   * Umsatz und Zähler auch dann stimmen, wenn nebenher bestellt wurde.
   */
  const removeFromList = (id: string) => {
    setOrders((prev) => prev.filter((o) => o.id !== id));
    setDetails((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setExpanded((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    load();
  };

  // Auswahlliste der Aufträge: immer aus ALLEN Bestellungen, damit sie beim
  // Tippen in der Suche nicht unter den Fingern wegspringt.
  const eventOptions = useMemo(() => {
    const counts = new Map<string, { name: string; count: number }>();
    for (const o of orders) {
      const key = o.event_id || NO_EVENT_KEY;
      const entry = counts.get(key);
      if (entry) entry.count += 1;
      else counts.set(key, { name: o.event_name || NO_EVENT_LABEL, count: 1 });
    }
    return [...counts.entries()]
      .map(([key, v]) => ({ key, ...v }))
      .sort((a, b) => {
        // "Ohne Auftrag" bleibt am Ende der Liste.
        if (a.key === NO_EVENT_KEY) return 1;
        if (b.key === NO_EVENT_KEY) return -1;
        return a.name.localeCompare(b.name);
      });
  }, [orders]);

  // Suche + Auftragsauswahl (ohne Statusfilter) – Grundlage für die Zähler an
  // den Statusknöpfen, damit diese zur aktuellen Auswahl passen.
  const searched = useMemo(() => {
    // Suchbegriff in Wörter zerlegen: So findet „müller anna“ auch „Anna Müller“.
    const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return orders.filter((o) => {
      if (eventFilter !== 'all' && (o.event_id || NO_EVENT_KEY) !== eventFilter) return false;
      if (terms.length) {
        const haystack = `${o.search_text ?? ''} ${o.email} ${o.event_name ?? ''} ${o.id}`.toLowerCase();
        if (!terms.every((t) => haystack.includes(t))) return false;
      }
      return true;
    });
  }, [orders, search, eventFilter]);

  const counts = useMemo(
    () => ({
      all: searched.length,
      print: searched.filter((o) => o.has_print).length,
      pending: searched.filter((o) => o.status === 'pending').length,
    }),
    [searched],
  );

  const groups = useMemo(() => {
    const filtered = searched.filter((o) => {
      if (filter === 'print') return o.has_print;
      if (filter === 'pending') return o.status === 'pending';
      return true;
    });
    const list = buildGroups(filtered);
    return list.sort((a, b) => {
      // Die Sammelkachel "Ohne Auftrag" steht immer zuletzt.
      if (a.key === NO_EVENT_KEY) return 1;
      if (b.key === NO_EVENT_KEY) return -1;
      switch (sort) {
        case 'name_asc':
          return a.name.localeCompare(b.name);
        case 'orders_desc':
          return b.orders.length - a.orders.length || a.name.localeCompare(b.name);
        case 'revenue_desc':
          return b.revenue_cents - a.revenue_cents || a.name.localeCompare(b.name);
        case 'recent':
        default:
          return String(b.latest).localeCompare(String(a.latest));
      }
    });
  }, [searched, filter, sort]);

  const visibleCount = useMemo(
    () => groups.reduce((sum, g) => sum + g.orders.length, 0),
    [groups],
  );

  const hasFilters = search.trim() !== '' || eventFilter !== 'all' || filter !== 'all';
  const resetFilters = () => {
    setSearch('');
    setEventFilter('all');
    setFilter('all');
  };

  const toggleGroup = (key: string) => {
    const next = new Set(collapsed);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setCollapsed(next);
  };
  const allCollapsed = groups.length > 0 && groups.every((g) => collapsed.has(g.key));
  const toggleAllGroups = () => {
    if (allCollapsed) {
      const next = new Set(collapsed);
      for (const g of groups) next.delete(g.key);
      setCollapsed(next);
    } else {
      const next = new Set(collapsed);
      for (const g of groups) next.add(g.key);
      setCollapsed(next);
    }
  };

  if (loading) return <Spinner />;

  return (
    <div>
      <div className="orders-toolbar">
        <h1 className="orders-toolbar-title">Bestellungen</h1>
        {orders.length > 0 && (
          <div className="orders-toolbar-controls">
            <input
              type="search"
              className="orders-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Auftrag, Schule, E-Mail oder Kind suchen …"
              aria-label="Bestellungen durchsuchen"
            />
            <select
              value={eventFilter}
              onChange={(e) => setEventFilter(e.target.value)}
              aria-label="Nach Auftrag filtern"
              title="Nur einen Auftrag anzeigen"
            >
              <option value="all">Alle Aufträge ({eventOptions.length})</option>
              {eventOptions.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.name} ({o.count})
                </option>
              ))}
            </select>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              aria-label="Aufträge sortieren"
              title="Sortierung der Auftrags-Kacheln"
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <p className="soft">
        Alle bestätigten Bestellungen – zusammengefasst zu einer Kachel je Auftrag (Schule bzw.
        Klasse). Klicke auf eine Kachel, um die Bestellungen des Auftrags zu sehen, und auf eine
        Bestellung, um alle Details aufzuklappen. Den Status kannst du direkt hier anpassen; mit
        „Löschen“ entfernst du eine Bestellung – etwa eine Testbestellung – endgültig aus der
        Übersicht.
      </p>

      {notice && <Alert kind="success">{notice}</Alert>}

      <div className="card mb">
        <div className="row between" style={{ gap: 8, flexWrap: 'wrap' }}>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
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
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {hasFilters && (
              <button type="button" className="btn ghost small" onClick={resetFilters}>
                Filter zurücksetzen
              </button>
            )}
            {groups.length > 1 && (
              <button type="button" className="btn ghost small" onClick={toggleAllGroups}>
                {allCollapsed ? 'Alle Aufträge ausklappen' : 'Alle Aufträge einklappen'}
              </button>
            )}
          </div>
        </div>
      </div>

      {orders.length === 0 ? (
        <p className="muted">Noch keine Bestellungen.</p>
      ) : groups.length === 0 ? (
        <p className="muted">
          Keine Bestellungen für diese Auswahl.{' '}
          {hasFilters && (
            <button type="button" className="btn ghost small" onClick={resetFilters}>
              Filter zurücksetzen
            </button>
          )}
        </p>
      ) : (
        <>
          <p className="muted" style={{ fontSize: '0.82rem', marginTop: 0 }}>
            {groups.length} {groups.length === 1 ? 'Auftrag' : 'Aufträge'} · {visibleCount}{' '}
            {visibleCount === 1 ? 'Bestellung' : 'Bestellungen'}
          </p>
          <div className="order-list">
            {groups.map((g) => (
              <EventOrderGroup
                key={g.key}
                group={g}
                open={!collapsed.has(g.key)}
                onToggle={() => toggleGroup(g.key)}
                expanded={expanded}
                details={details}
                loadingDetail={loadingDetail}
                onToggleOrder={toggle}
                onStatus={setStatus}
                onShip={(o) => {
                  setNotice('');
                  setShippingOrder(o);
                }}
                onDelete={(o) => {
                  setNotice('');
                  setDeletingOrder(o);
                }}
              />
            ))}
          </div>
        </>
      )}

      {shippingOrder && (
        <ShippingConfirmationModal
          order={shippingOrder}
          onClose={() => setShippingOrder(null)}
          onSent={(message) => {
            setShippingOrder(null);
            setNotice(message);
            // Der Versand setzt die Bestellung serverseitig auf „Abgeschlossen“ –
            // Liste neu laden, damit der Status sofort stimmt.
            load();
          }}
        />
      )}

      {deletingOrder && (
        <DeleteOrderModal
          order={deletingOrder}
          onClose={() => setDeletingOrder(null)}
          onDeleted={(message) => {
            const id = deletingOrder.id;
            setDeletingOrder(null);
            setNotice(message);
            removeFromList(id);
          }}
        />
      )}
    </div>
  );
}

/**
 * Eine Kachel je Auftrag: Kopfzeile mit den Eckwerten des Auftrags, darunter –
 * aufgeklappt – alle Bestellungen dieses Auftrags.
 */
function EventOrderGroup({
  group,
  open,
  onToggle,
  expanded,
  details,
  loadingDetail,
  onToggleOrder,
  onStatus,
  onShip,
  onDelete,
}: {
  group: OrderGroup;
  open: boolean;
  onToggle: () => void;
  expanded: Record<string, boolean>;
  details: Record<string, OrderDetail>;
  loadingDetail: Record<string, boolean>;
  onToggleOrder: (id: string) => void;
  onStatus: (id: string, status: string) => void;
  onShip: (order: OrderRow) => void;
  onDelete: (order: OrderRow) => void;
}) {
  // Nur auslösen, wenn die Kopfzeile selbst fokussiert ist – nicht, wenn ein
  // Bedienelement darin (z. B. der Link zum Auftrag) den Tastendruck erhält.
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onToggle();
    }
  };

  return (
    <div className={`order-row${open ? ' expanded' : ''}`}>
      <div
        className="order-row-head"
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={onToggle}
        onKeyDown={handleKeyDown}
      >
        <div className="order-row-bar">
          <span className="order-row-toggle">
            <span className="order-row-chevron" aria-hidden>
              {open ? '▾' : '▸'}
            </span>
            <span className="order-row-title" title={group.name}>
              {group.name}
            </span>
            {group.pending > 0 && <span className="badge amber">{group.pending} pendent</span>}
          </span>
          {group.key !== NO_EVENT_KEY && (
            <div className="order-row-actions" onClick={(e) => e.stopPropagation()}>
              <Link
                className="btn secondary small"
                to={`/admin/events/${group.key}`}
                title="Auswertung dieses Auftrags öffnen"
              >
                Auftrag ansehen
              </Link>
            </div>
          )}
        </div>

        <div className="order-row-stats">
          <SummaryStat label="Bestellungen" value={String(group.orders.length)} />
          <SummaryStat label="Mit Druck" value={String(group.print)} />
          <SummaryStat label="Umsatz" value={formatPrice(group.revenue_cents, group.currency)} />
          <SummaryStat label="Neueste Bestellung" value={formatDateShort(group.latest)} />
        </div>
      </div>

      {open && (
        <div className="order-row-detail">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {group.orders.map((o) => (
              <OrderCard
                key={o.id}
                order={o}
                open={!!expanded[o.id]}
                detail={details[o.id]}
                loadingDetail={!!loadingDetail[o.id]}
                onToggle={() => onToggleOrder(o.id)}
                onStatus={(status) => onStatus(o.id, status)}
                onShip={() => onShip(o)}
                onDelete={() => onDelete(o)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Eine einzelne Bestellung innerhalb einer Auftrags-Kachel. */
function OrderCard({
  order,
  open,
  detail,
  loadingDetail,
  onToggle,
  onStatus,
  onShip,
  onDelete,
}: {
  order: OrderRow;
  open: boolean;
  detail?: OrderDetail;
  loadingDetail: boolean;
  onToggle: () => void;
  onStatus: (status: string) => void;
  onShip: () => void;
  onDelete: () => void;
}) {
  const children = order.child_names ?? [];
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggle();
          }
        }}
        className="row between"
        style={{ alignItems: 'flex-start', padding: 14, cursor: 'pointer', gap: 10 }}
      >
        <div style={{ minWidth: 0 }}>
          <div className="row" style={{ gap: 10, alignItems: 'center' }}>
            <StatusBadge status={order.status} />
            {order.has_print && <span className="badge class">Druck</span>}
            <strong style={{ wordBreak: 'break-all' }}>{order.email}</strong>
          </div>
          <div className="muted" style={{ fontSize: '0.82rem', marginTop: 4 }}>
            {formatDate(order.created_at)} · {order.item_count} Position(en) ·{' '}
            {formatPrice(order.total_cents, order.currency)}
            {children.length > 0 && ` · ${children.join(', ')}`}
          </div>
          {order.other_event_names && order.other_event_names.length > 0 && (
            <div className="muted" style={{ fontSize: '0.78rem', marginTop: 2 }}>
              Enthält auch Fotos aus: {order.other_event_names.join(', ')}
            </div>
          )}
        </div>
        <div
          className="row"
          style={{ gap: 10, alignItems: 'center' }}
          onClick={(e) => e.stopPropagation()}
        >
          {order.has_print && (
            <button type="button" className="btn secondary small" onClick={onShip}>
              Versandbestätigung schicken
            </button>
          )}
          <select
            value={order.status}
            onChange={(e) => onStatus(e.target.value)}
            style={{ width: 170 }}
            aria-label="Status der Bestellung ändern"
          >
            {!STATUS_OPTIONS.some((s) => s.value === order.status) && (
              <option value={order.status}>{order.status}</option>
            )}
            {STATUS_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn ghost small danger"
            onClick={onDelete}
            title="Bestellung endgültig löschen (z. B. eine Testbestellung)"
          >
            Löschen
          </button>
          <Chevron open={open} onClick={onToggle} />
        </div>
      </div>

      {open && (
        <div style={{ padding: 14, paddingTop: 0, borderTop: '1px solid var(--border)' }}>
          <OrderDetailBody loading={loadingDetail && !detail} detail={detail} />
        </div>
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
            Diese Positionen (Fotos, Sticker, Magnete) müssen produziert und versendet werden.
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
                <td>
                  {productKindLabel(i.product_kind, i.product_type)}
                  {i.includes_digital === 1 ? ' + Digital' : ''}
                </td>
                <td className="muted">{i.original_filename}</td>
                <td>{i.qty}</td>
                <td>
                  {formatPrice(
                    typeof i.line_total_cents === 'number'
                      ? i.line_total_cents
                      : i.unit_price_cents * i.qty,
                    order.currency,
                  )}
                </td>
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

/**
 * Sicherheitsabfrage vor dem endgültigen Löschen einer Bestellung. Gedacht in
 * erster Linie für Testbestellungen: „Storniert“ oder „Abgeschlossen“ blenden
 * eine Bestellung nicht aus, hier verschwindet sie wirklich. Gelöscht werden
 * die Bestellung, ihre Positionen und die zugehörigen Download-Freigaben –
 * Fotos, Kinder und E-Mail-Adressen bleiben bestehen.
 */
function DeleteOrderModal({
  order,
  onClose,
  onDeleted,
}: {
  order: OrderRow;
  onClose: () => void;
  onDeleted: (msg: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const remove = async () => {
    setBusy(true);
    setError('');
    try {
      await api(`/api/admin/orders/${order.id}`, { method: 'DELETE', admin: true });
      onDeleted(`Bestellung von ${order.email} wurde gelöscht.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Bestellung konnte nicht gelöscht werden.');
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Bestellung löschen"
      width={560}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>
            Abbrechen
          </button>
          <button type="button" className="btn danger" onClick={remove} disabled={busy}>
            {busy ? 'Wird gelöscht …' : 'Endgültig löschen'}
          </button>
        </>
      }
    >
      {error && <Alert kind="error">{error}</Alert>}
      <p style={{ fontSize: '0.92rem', lineHeight: 1.6, marginTop: 0 }}>
        Diese Bestellung wird mit allen Positionen unwiderruflich entfernt und verschwindet aus der
        Übersicht, aus dem Umsatz und aus den Auswertungen. Auch die Download-Freigaben werden
        gelöscht – bereits gekaufte Digitalfotos kann diese Adresse danach nicht mehr herunterladen.
        Fotos, Kinder und E-Mail-Adressen bleiben unverändert bestehen.
      </p>
      <div
        style={{
          border: '1px solid var(--border)',
          borderRadius: 10,
          padding: '12px 14px',
        }}
      >
        <div className="row" style={{ gap: 10, alignItems: 'center' }}>
          <StatusBadge status={order.status} />
          {order.has_print && <span className="badge class">Druck</span>}
          <strong style={{ wordBreak: 'break-all' }}>{order.email}</strong>
        </div>
        <div className="muted" style={{ fontSize: '0.82rem', marginTop: 4 }}>
          {formatDate(order.created_at)} · {order.item_count} Position(en) ·{' '}
          {formatPrice(order.total_cents, order.currency)}
        </div>
      </div>
    </Modal>
  );
}

interface ShippingMeta {
  adminEmail: string;
  devLogOnly: boolean;
}

/**
 * Versand-Popup für die Versandbestätigung einer einzelnen Bestellung. Zeigt nur
 * die zur angeklickten Bestellung gehörende Adresse. Nach erfolgreichem Versand
 * wird die Bestellung serverseitig automatisch auf „Abgeschlossen“ gesetzt.
 * Optional geht eine Kopie an das eigene Admin-Konto.
 */
function ShippingConfirmationModal({
  order,
  onClose,
  onSent,
}: {
  order: OrderRow;
  onClose: () => void;
  onSent: (msg: string) => void;
}) {
  const [meta, setMeta] = useState<ShippingMeta | null>(null);
  const [sendToSelf, setSendToSelf] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api<ShippingMeta>('/api/admin/orders/shipping-meta', { admin: true })
      .then(setMeta)
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : 'Angaben konnten nicht geladen werden.'),
      )
      .finally(() => setLoading(false));
  }, []);

  const send = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await api<{
        sent: number;
        failed: number;
        total: number;
        sentToSelf: boolean;
        statusChanged: boolean;
        devLogOnly: boolean;
      }>(`/api/admin/orders/${order.id}/send-shipping-confirmation`, {
        method: 'POST',
        admin: true,
        body: { sendToSelf },
      });
      const self = res.sentToSelf ? ' Eine Kopie wurde an dich gesendet.' : '';
      const status = res.statusChanged ? ' Die Bestellung wurde auf „Abgeschlossen“ gesetzt.' : '';
      const note = res.devLogOnly
        ? ' Hinweis: Kein SMTP konfiguriert – die E-Mail wurde nur ins Server-Log geschrieben.'
        : '';
      if (res.sent > 0) {
        onSent(`Versandbestätigung an ${order.email} gesendet.${status}${self}${note}`);
      } else if (res.sentToSelf) {
        onSent(`Versandbestätigung wurde nur an dich gesendet.${note}`);
      } else {
        onSent(`Die Versandbestätigung konnte nicht zugestellt werden.${note}`);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Versand fehlgeschlagen.');
      setBusy(false);
    }
  };

  const canSend = !loading && !busy;

  return (
    <Modal
      title="Versandbestätigung schicken"
      width={560}
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
        Die Versandbestätigung informiert die Eltern, dass ihre bestellten Fotos heute verschickt
        wurden. Sie wird an die zu dieser Bestellung gehörende Adresse gesendet. Anschliessend wird
        die Bestellung automatisch auf „Abgeschlossen“ gesetzt.
      </p>
      <div
        style={{
          border: '1px solid var(--border)',
          borderRadius: 10,
          padding: '12px 14px',
          marginBottom: 12,
        }}
      >
        <div className="muted" style={{ fontSize: '0.78rem' }}>
          Empfängeradresse
        </div>
        <strong style={{ wordBreak: 'break-all' }}>{order.email || '—'}</strong>
      </div>
      {loading ? (
        <p className="muted">Angaben werden geladen …</p>
      ) : meta ? (
        <>
          <SendToSelfCheckbox
            checked={sendToSelf}
            onChange={setSendToSelf}
            adminEmail={meta.adminEmail}
          />
          {meta.devLogOnly && (
            <p className="muted" style={{ fontSize: '0.8rem', marginTop: 8, marginBottom: 0 }}>
              Achtung: Kein SMTP konfiguriert – die E-Mail landet nur im Server-Log.
            </p>
          )}
        </>
      ) : null}
    </Modal>
  );
}
