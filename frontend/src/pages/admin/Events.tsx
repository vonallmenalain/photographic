import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../../api/client';
import { Alert, Spinner, StatusBadge } from '../../components/common';
import { formatDateShort } from '../../lib/format';

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
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () =>
    api<{ events: EventRow[] }>('/api/admin/events', { admin: true })
      .then((r) => setEvents(r.events))
      .finally(() => setLoading(false));

  useEffect(() => {
    load();
  }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api('/api/admin/events', { method: 'POST', admin: true, body: { name } });
      setName('');
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Konnte nicht angelegt werden.');
    } finally {
      setBusy(false);
    }
  };

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
      <h1>Aufträge</h1>
      <div className="card mb">
        {error && <Alert kind="error">{error}</Alert>}
        <form onSubmit={create} className="row">
          <div style={{ flex: 1, minWidth: 220 }}>
            <input
              placeholder="Titel des Auftrags (z. B. Kindergarten Sonnenschein, Klasse 3b)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <button className="btn" disabled={busy || !name.trim()}>
            Auftrag anlegen
          </button>
        </form>
      </div>

      {events.length === 0 ? (
        <p className="muted">Noch keine Aufträge. Lege oben deinen ersten Auftrag an.</p>
      ) : (
        <div className="job-grid">
          {events.map((ev) => (
            <Link key={ev.id} to={ev.id} className="job-card">
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
