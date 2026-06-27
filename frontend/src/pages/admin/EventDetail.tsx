import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../../api/client';
import { Alert, Spinner, StatusBadge } from '../../components/common';
import { EventAnalyticsPanel, type EventAnalytics } from './EventAnalyticsPanel';

/**
 * Detail view of a *finished* Auftrag (published or archived). It is read-only:
 * it shows the order status and its evaluation (the former "Auswertung") –
 * revenue, buyers, the daily chart and the reminder tooling.
 *
 * An Auftrag that is still being captured ("In Bearbeitung" = draft) is not
 * shown here; it is edited in the guided "Aufträge erfassen" wizard, so we
 * redirect there. To edit a finished order again, the photographer presses
 * "Bearbeiten", which sets the status back to "In Bearbeitung" and reopens the
 * wizard.
 */
export default function EventDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [ev, setEv] = useState<EventAnalytics | null>(null);
  const [currency, setCurrency] = useState('chf');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setError('');
    try {
      const res = await api<{ event: EventAnalytics; currency: string }>(
        `/api/admin/events/${id}/analytics`,
        { admin: true },
      );
      // Orders still in capture are edited in the wizard, not shown here.
      if (res.event.status === 'draft') {
        navigate(`/admin/import?eventId=${id}`, { replace: true });
        return;
      }
      setEv(res.event);
      setCurrency(res.currency || 'chf');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Auftrag konnte nicht geladen werden.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Re-open the order for editing: set it back to "In Bearbeitung" (draft) and
  // continue in the capture wizard.
  const edit = async () => {
    if (!ev) return;
    if (
      !confirm(
        'Zum Bearbeiten wird der Auftrag auf „In Bearbeitung“ gesetzt und ist für Eltern vorübergehend nicht mehr sichtbar, bis er erneut veröffentlicht wird. Fortfahren?',
      )
    )
      return;
    setBusy(true);
    setError('');
    try {
      await api(`/api/admin/events/${id}`, { method: 'PATCH', admin: true, body: { status: 'draft' } });
      navigate(`/admin/import?eventId=${id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Aktion fehlgeschlagen.');
      setBusy(false);
    }
  };

  const deleteEvent = async () => {
    if (
      !confirm(
        'Diesen Auftrag wirklich löschen? Alle Fotos, Kinder und Zuordnungen dieses Auftrags werden unwiderruflich entfernt.',
      )
    )
      return;
    try {
      await api(`/api/admin/events/${id}`, { method: 'DELETE', admin: true });
      navigate('/admin/events');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Auftrag konnte nicht gelöscht werden.');
    }
  };

  if (loading) return <Spinner />;
  if (!ev) return <Alert kind="error">{error || 'Auftrag nicht gefunden.'}</Alert>;

  return (
    <div>
      <p>
        <Link to="/admin/events">← Alle Aufträge</Link>
      </p>
      <div className="row between">
        <h1 style={{ marginBottom: 4 }}>{ev.name}</h1>
        <div className="row" style={{ gap: 10, alignItems: 'center' }}>
          <StatusBadge status={ev.status} />
          <button className="btn secondary" onClick={edit} disabled={busy}>
            Bearbeiten
          </button>
        </div>
      </div>
      <p className="soft" style={{ marginTop: 0 }}>
        Dieser Auftrag ist vollständig erfasst – hier siehst du die Auswertung (Umsatz, Bestellungen
        und Erinnerungen). Zum Ändern auf „Bearbeiten“ klicken: Der Auftrag wird dann auf „In
        Bearbeitung“ gesetzt und wieder unter „Aufträge erfassen“ geöffnet.
      </p>

      {error && <Alert kind="error">{error}</Alert>}

      <div className="card mb">
        <EventAnalyticsPanel ev={ev} currency={currency} onReload={load} />
      </div>

      <div className="card mb" style={{ marginTop: 16, borderColor: 'var(--danger, #e5484d)' }}>
        <div className="row between">
          <div>
            <h2 style={{ marginBottom: 4 }}>Auftrag löschen</h2>
            <p className="muted" style={{ fontSize: '0.82rem', margin: 0 }}>
              Entfernt den Auftrag samt aller Fotos, Kinder und Zuordnungen. Dies kann nicht
              rückgängig gemacht werden.
            </p>
          </div>
          <button className="btn danger" onClick={deleteEvent}>
            Auftrag löschen
          </button>
        </div>
      </div>
    </div>
  );
}
