import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../../api/client';
import { Alert, Spinner, StatusBadge } from '../../components/common';
import { formatDateShort } from '../../lib/format';

interface EventRef {
  id: string;
  name: string;
}
interface EmailRow {
  id: string;
  email: string;
  name?: string;
  status: string;
  created_at: string;
  events?: EventRef[];
}

export default function Emails() {
  const [emails, setEmails] = useState<EmailRow[]>([]);
  const [events, setEvents] = useState<EventRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [eventFilter, setEventFilter] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newName, setNewName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = (query = q, eventId = eventFilter) => {
    const params = new URLSearchParams();
    if (query) params.set('q', query);
    if (eventId) params.set('eventId', eventId);
    return api<{ emails: EmailRow[] }>(`/api/admin/emails?${params.toString()}`, { admin: true })
      .then((r) => setEmails(r.emails))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load('', '');
    api<{ events: EventRef[] }>('/api/admin/events', { admin: true })
      .then((r) => setEvents(r.events))
      .catch(() => setEvents([]));
  }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api('/api/admin/emails', {
        method: 'POST',
        admin: true,
        body: { email: newEmail, name: newName },
      });
      setNewEmail('');
      setNewName('');
      load(q);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Konnte nicht angelegt werden.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (row: EmailRow) => {
    if (
      !confirm(
        `E-Mail-Adresse „${row.email}“ wirklich löschen? Verknüpfungen, Sitzungen und Bestätigungs-Tokens dieser Adresse werden mit entfernt.`,
      )
    )
      return;
    setError('');
    try {
      await api(`/api/admin/emails/${row.id}`, { method: 'DELETE', admin: true });
      load(q);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Konnte nicht gelöscht werden.');
    }
  };

  if (loading) return <Spinner />;

  return (
    <div>
      <h1>E-Mail-Adressen</h1>
      <p className="soft">
        Die E-Mail-Adresse ist die zentrale Identität: Sie entscheidet, welche Fotos eine Familie
        sieht.
      </p>

      <div className="card mb">
        {error && <Alert kind="error">{error}</Alert>}
        <form onSubmit={create} className="row">
          <div style={{ flex: 1, minWidth: 220 }}>
            <input
              type="email"
              placeholder="neue-eltern-adresse@beispiel.de"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              required
            />
          </div>
          <div style={{ flex: 1, minWidth: 180 }}>
            <input
              placeholder="Name (optional)"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
          </div>
          <button className="btn" disabled={busy}>
            E-Mail anlegen
          </button>
        </form>
        <p className="muted" style={{ fontSize: '0.82rem', marginTop: 8, marginBottom: 0 }}>
          Tipp: Mehrere Adressen und Kinder auf einmal? Nutze den{' '}
          <Link to="/admin/import">Import</Link> (Kopieren &amp; Einfügen oder CSV/Excel).
        </p>
      </div>

      <div className="card">
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <div className="field" style={{ flex: 1, minWidth: 220, maxWidth: 340, marginBottom: 0 }}>
            <label style={{ fontSize: '0.8rem' }}>Suchen</label>
            <input
              placeholder="E-Mail oder Name …"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                load(e.target.value, eventFilter);
              }}
            />
          </div>
          <div className="field" style={{ minWidth: 220, maxWidth: 300, marginBottom: 0 }}>
            <label style={{ fontSize: '0.8rem' }}>Nach Auftrag/Klasse filtern</label>
            <select
              value={eventFilter}
              onChange={(e) => {
                setEventFilter(e.target.value);
                load(q, e.target.value);
              }}
            >
              <option value="">Alle Aufträge</option>
              {events.map((ev) => (
                <option key={ev.id} value={ev.id}>
                  {ev.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        {emails.length === 0 ? (
          <p className="muted" style={{ marginTop: 16 }}>
            Keine E-Mail-Adressen gefunden.
          </p>
        ) : (
          <table style={{ marginTop: 16 }}>
            <thead>
              <tr>
                <th>E-Mail</th>
                <th>Name</th>
                <th>Aufträge</th>
                <th>Status</th>
                <th>Angelegt</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {emails.map((e) => (
                <tr key={e.id}>
                  <td>
                    <Link to={e.id}>{e.email}</Link>
                  </td>
                  <td>{e.name || <span className="muted">—</span>}</td>
                  <td>
                    {e.events && e.events.length > 0 ? (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {e.events.map((ev) => (
                          <Link
                            key={ev.id}
                            to={`/admin/events/${ev.id}`}
                            className="badge class"
                            title={ev.name}
                            style={{ textDecoration: 'none' }}
                          >
                            {ev.name}
                          </Link>
                        ))}
                      </div>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>
                    <StatusBadge status={e.status} />
                  </td>
                  <td>{formatDateShort(e.created_at)}</td>
                  <td>
                    <div className="row" style={{ gap: 12 }}>
                      <Link to={e.id}>Verwalten</Link>
                      <button
                        className="btn ghost small"
                        onClick={() => remove(e)}
                        style={{ color: 'var(--danger)' }}
                      >
                        Löschen
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
