import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../../api/client';
import { Alert, Spinner, StatusBadge } from '../../components/common';
import { formatDateShort } from '../../lib/format';

// Note: new orders are no longer created here. Capturing a new Auftrag (data
// import → photos → publish → invite) now happens in the guided "Aufträge
// erfassen" wizard. This page is purely the list of existing orders.

interface EventRow {
  id: string;
  name: string;
  status: string;
  photo_count: number;
  child_count: number;
  email_count: number;
  expires_at: string | null;
  created_at: string;
}

export default function Events() {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = () =>
    api<{ events: EventRow[] }>('/api/admin/events', { admin: true })
      .then((r) => setEvents(r.events))
      .finally(() => setLoading(false));

  useEffect(() => {
    load();
  }, []);

  const remove = async (e: React.MouseEvent, ev: EventRow) => {
    e.preventDefault();
    e.stopPropagation();
    if (
      !confirm(
        `Auftrag „${ev.name}“ wirklich löschen? Alle Fotos, Kinder und Zuordnungen werden unwiderruflich entfernt.`,
      )
    )
      return;
    setError('');
    try {
      await api(`/api/admin/events/${ev.id}`, { method: 'DELETE', admin: true });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Auftrag konnte nicht gelöscht werden.');
    }
  };

  if (loading) return <Spinner />;

  return (
    <div>
      <div className="row between">
        <h1 style={{ marginBottom: 4 }}>Aufträge</h1>
        <Link to="/admin/import" className="btn">
          + Auftrag erfassen
        </Link>
      </div>
      <p className="soft" style={{ marginTop: 0 }}>
        Übersicht aller Aufträge. Einen neuen Auftrag legst du über{' '}
        <Link to="/admin/import">Aufträge erfassen</Link> an – dort wirst du Schritt für Schritt
        durch Daten, Fotos, Veröffentlichung und Versand geführt. Aufträge mit dem Status{' '}
        <strong>„In Bearbeitung“</strong> öffnen sich beim Anklicken wieder in der Erfassung;
        fertige Aufträge zeigen ihre Auswertung.
      </p>

      {error && <Alert kind="error">{error}</Alert>}

      {events.length === 0 ? (
        <p className="muted">
          Noch keine Aufträge. Erfasse deinen ersten Auftrag über{' '}
          <Link to="/admin/import">Aufträge erfassen</Link>.
        </p>
      ) : (
        <div className="job-grid">
          {events.map((ev) => (
            <Link
              key={ev.id}
              // Orders still in capture ("In Bearbeitung" = draft) reopen in the
              // guided wizard; finished orders open their read-only detail view.
              to={ev.status === 'draft' ? `/admin/import?eventId=${ev.id}` : ev.id}
              className="job-card"
            >
              <div className="job-card-head">
                <strong className="job-card-title" title={ev.name}>
                  {ev.name}
                </strong>
                <StatusBadge status={ev.status} />
              </div>

              <div className="job-card-stats">
                <div className="job-stat">
                  <span className="job-stat-num">{ev.photo_count}</span>
                  <span className="job-stat-lbl">Fotos</span>
                </div>
                <div className="job-stat">
                  <span className="job-stat-num">{ev.child_count}</span>
                  <span className="job-stat-lbl">Kinder</span>
                </div>
                <div className="job-stat">
                  <span className="job-stat-num">{ev.email_count}</span>
                  <span className="job-stat-lbl">E-Mails</span>
                </div>
              </div>

              <div className="job-card-foot">
                <span className="muted" style={{ fontSize: '0.78rem' }}>
                  {ev.expires_at ? `Verfügbar bis ${formatDateShort(ev.expires_at)}` : 'Ohne Ablaufdatum'}
                </span>
                <button
                  className="btn ghost small"
                  style={{ color: 'var(--danger)' }}
                  onClick={(e) => remove(e, ev)}
                >
                  Löschen
                </button>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
