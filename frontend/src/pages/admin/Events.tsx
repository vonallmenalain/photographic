import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../../api/client';
import { Alert, Spinner, StatusBadge } from '../../components/common';
import { formatPrice } from '../../lib/format';
import {
  EventAnalyticsPanel,
  OrderableUntilStat,
  SummaryStat,
  type EventAnalytics,
} from './EventAnalyticsPanel';
import { PhotoOverviewModal } from './PhotoOverviewModal';

// Note: new orders are no longer created here. Capturing a new Auftrag (data
// import → photos → publish) happens in the guided "Aufträge erfassen" wizard.
// This page lists the existing orders as full-width, expandable rows: collapsed
// they show the key figures plus a status dropdown (and, while "In Bearbeitung",
// an "Auftrag bearbeiten" button); expanded they reveal the full evaluation
// (the former "Auswertung").

interface EventRow {
  id: string;
  name: string;
  status: string;
  photo_count: number;
  child_count: number;
  email_count: number;
  email_verified: number;
  order_count: number;
  revenue_cents: number;
  // Summe aller versendeten Einladungen + Erinnerungen (reminders-Sammlung).
  reminder_count: number;
  expires_at: string | null;
  created_at: string;
}

export default function Events() {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [currency, setCurrency] = useState('chf');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = () =>
    api<{ events: EventRow[]; currency: string }>('/api/admin/events', { admin: true })
      .then((r) => {
        setEvents(r.events);
        setCurrency(r.currency || 'chf');
      })
      .finally(() => setLoading(false));

  useEffect(() => {
    load();
  }, []);

  if (loading) return <Spinner />;

  return (
    <div>
      <h1 style={{ marginBottom: 16 }}>Aufträge</h1>

      {error && <Alert kind="error">{error}</Alert>}

      {events.length === 0 ? (
        <p className="muted">
          Noch keine Aufträge. Erfasse deinen ersten Auftrag über{' '}
          <Link to="/admin/import">Aufträge erfassen</Link>.
        </p>
      ) : (
        <div className="order-list">
          {events.map((ev) => (
            <EventCard
              key={ev.id}
              ev={ev}
              currency={currency}
              expanded={expandedId === ev.id}
              onToggle={() => setExpandedId((cur) => (cur === ev.id ? null : ev.id))}
              onChanged={load}
              onError={setError}
            />
          ))}
        </div>
      )}
    </div>
  );
}

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: 'draft', label: 'In Bearbeitung' },
  { value: 'published', label: 'Veröffentlicht' },
  { value: 'archived', label: 'Archiviert' },
];

function EventCard({
  ev,
  currency,
  expanded,
  onToggle,
  onChanged,
  onError,
}: {
  ev: EventRow;
  currency: string;
  expanded: boolean;
  onToggle: () => void;
  onChanged: () => Promise<void>;
  onError: (msg: string) => void;
}) {
  const navigate = useNavigate();
  const [analytics, setAnalytics] = useState<EventAnalytics | null>(null);
  const [detailCurrency, setDetailCurrency] = useState(currency);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showPhotos, setShowPhotos] = useState(false);

  const loadDetail = async () => {
    setLoadingDetail(true);
    try {
      const res = await api<{ event: EventAnalytics; currency: string }>(
        `/api/admin/events/${ev.id}/analytics`,
        { admin: true },
      );
      setAnalytics(res.event);
      setDetailCurrency(res.currency || currency);
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Auswertung konnte nicht geladen werden.');
    } finally {
      setLoadingDetail(false);
    }
  };

  useEffect(() => {
    if (expanded && !analytics && !loadingDetail) void loadDetail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded]);

  const changeStatus = async (status: string) => {
    if (status === ev.status) return;
    // Leaving "Veröffentlicht" removes the gallery from the parents' view.
    if (ev.status === 'published' && status !== 'published') {
      if (
        !confirm(
          'Der Auftrag wird damit für die Eltern nicht mehr sichtbar, bis er erneut veröffentlicht wird. Fortfahren?',
        )
      )
        return;
    }
    onError('');
    setBusy(true);
    try {
      await api(`/api/admin/events/${ev.id}`, { method: 'PATCH', admin: true, body: { status } });
      await onChanged();
      if (expanded) await loadDetail();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Status konnte nicht geändert werden.');
    } finally {
      setBusy(false);
    }
  };

  const edit = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigate(`/admin/import?eventId=${ev.id}`);
  };

  const remove = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (
      !confirm(
        `Auftrag „${ev.name}“ wirklich löschen? Alle Fotos, Kinder und Zuordnungen werden unwiderruflich entfernt.`,
      )
    )
      return;
    onError('');
    try {
      await api(`/api/admin/events/${ev.id}`, { method: 'DELETE', admin: true });
      await onChanged();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Auftrag konnte nicht gelöscht werden.');
    }
  };

  // Die gesamte Kopfzeile (weisser Bereich + graue Kacheln) toggelt den Auftrag.
  // Interaktive Bedienelemente (Status-Auswahl, Buttons) stoppen die Weitergabe,
  // damit ein Klick auf sie den Auftrag nicht versehentlich auf-/zuklappt.
  const handleHeadKeyDown = (e: React.KeyboardEvent) => {
    // Nur auslösen, wenn der Kopf selbst fokussiert ist – nicht, wenn ein
    // Bedienelement (z. B. das Status-Auswahlfeld) den Tastendruck erhält.
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onToggle();
    }
  };

  return (
    <div className={`order-row${expanded ? ' expanded' : ''}`}>
      <div
        className="order-row-head"
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onClick={onToggle}
        onKeyDown={handleHeadKeyDown}
      >
        <div className="order-row-bar">
          <span className="order-row-toggle">
            <span className="order-row-chevron" aria-hidden>
              {expanded ? '▾' : '▸'}
            </span>
            <span className="order-row-title" title={ev.name}>
              {ev.name}
            </span>
            <StatusBadge status={ev.status} />
          </span>

          <div className="order-row-actions" onClick={(e) => e.stopPropagation()}>
            <select
              value={ev.status}
              disabled={busy}
              onChange={(e) => changeStatus(e.target.value)}
              aria-label="Status ändern"
              title="Status des Auftrags ändern"
            >
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <button
              className="btn secondary small"
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setShowPhotos(true);
              }}
              title="Alle Fotos und E-Mail-Adressen dieses Auftrags zur Kontrolle anzeigen"
            >
              Fotos
            </button>
            {ev.status === 'draft' && (
              <button className="btn secondary small" type="button" onClick={edit} disabled={busy}>
                Auftrag bearbeiten
              </button>
            )}
            <button
              className="btn ghost small"
              type="button"
              style={{ color: 'var(--danger)' }}
              onClick={remove}
              disabled={busy}
            >
              Löschen
            </button>
          </div>
        </div>

        <div className="order-row-stats">
          <SummaryStat label="Kinder" value={String(ev.child_count)} />
          <SummaryStat label="Bestellungen" value={String(ev.order_count)} />
          <SummaryStat
            label="Verifizierte E-Mails"
            value={`${ev.email_verified} von ${ev.email_count}`}
          />
          <SummaryStat label="Umsatz" value={formatPrice(ev.revenue_cents, currency)} />
          <SummaryStat label="Einladungen + Erinnerungen" value={String(ev.reminder_count)} />
          <OrderableUntilStat
            eventId={ev.id}
            status={ev.status}
            expiresAt={ev.expires_at}
            onReload={() => {
              void onChanged();
              if (expanded) void loadDetail();
            }}
          />
        </div>
      </div>

      {expanded && (
        <div className="order-row-detail">
          {loadingDetail && !analytics ? (
            <Spinner />
          ) : analytics ? (
            <EventAnalyticsPanel
              ev={analytics}
              currency={detailCurrency}
              onReload={loadDetail}
              showSummary={false}
            />
          ) : (
            <p className="muted">Auswertung konnte nicht geladen werden.</p>
          )}
        </div>
      )}

      {showPhotos && (
        <PhotoOverviewModal
          eventId={ev.id}
          eventName={ev.name}
          onClose={() => setShowPhotos(false)}
        />
      )}
    </div>
  );
}