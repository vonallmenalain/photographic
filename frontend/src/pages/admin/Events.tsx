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

  const remove = async (ev: EventRow) => {
    if (
      !confirm(
        `Event „${ev.name}“ wirklich löschen? Alle Fotos, Kinder und Zuordnungen werden unwiderruflich entfernt.`,
      )
    )
      return;
    setError('');
    try {
      await api(`/api/admin/events/${ev.id}`, { method: 'DELETE', admin: true });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Event konnte nicht gelöscht werden.');
    }
  };

  if (loading) return <Spinner />;

  return (
    <div>
      <h1>Events / Foto-Sets</h1>
      <div className="card mb">
        {error && <Alert kind="error">{error}</Alert>}
        <form onSubmit={create} className="row">
          <div style={{ flex: 1, minWidth: 220 }}>
            <input
              placeholder="Name des Events (z. B. Kindergarten Sonnenschein, Klasse 3b)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <button className="btn" disabled={busy || !name.trim()}>
            Event anlegen
          </button>
        </form>
      </div>

      {events.length === 0 ? (
        <p className="muted">Noch keine Events. Lege oben dein erstes Foto-Set an.</p>
      ) : (
        <div className="card">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Status</th>
                <th>Fotos</th>
                <th>Kinder</th>
                <th>Verfügbar bis</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {events.map((ev) => (
                <tr key={ev.id}>
                  <td>
                    <Link to={ev.id}>
                      <strong>{ev.name}</strong>
                    </Link>
                  </td>
                  <td>
                    <StatusBadge status={ev.status} />
                  </td>
                  <td>{ev.photo_count}</td>
                  <td>{ev.child_count}</td>
                  <td>{ev.expires_at ? formatDateShort(ev.expires_at) : '—'}</td>
                  <td>
                    <div className="row" style={{ gap: 12, justifyContent: 'flex-end' }}>
                      <Link to={ev.id}>Verwalten</Link>
                      <button
                        className="btn ghost small"
                        style={{ color: 'var(--danger)' }}
                        onClick={() => remove(ev)}
                      >
                        Löschen
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
