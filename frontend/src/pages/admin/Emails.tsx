import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../../api/client';
import { Alert, Spinner, StatusBadge } from '../../components/common';
import { formatDateShort } from '../../lib/format';

interface EmailRow {
  id: string;
  email: string;
  status: string;
  created_at: string;
}

export default function Emails() {
  const [emails, setEmails] = useState<EmailRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = (query = '') =>
    api<{ emails: EmailRow[] }>(`/api/admin/emails?q=${encodeURIComponent(query)}`, { admin: true })
      .then((r) => setEmails(r.emails))
      .finally(() => setLoading(false));

  useEffect(() => {
    load();
  }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api('/api/admin/emails', { method: 'POST', admin: true, body: { email: newEmail } });
      setNewEmail('');
      load(q);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Konnte nicht angelegt werden.');
    } finally {
      setBusy(false);
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
          <button className="btn" disabled={busy}>
            E-Mail anlegen
          </button>
        </form>
      </div>

      <div className="card">
        <div className="field" style={{ maxWidth: 340 }}>
          <input
            placeholder="Suchen …"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              load(e.target.value);
            }}
          />
        </div>
        {emails.length === 0 ? (
          <p className="muted">Keine E-Mail-Adressen gefunden.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>E-Mail</th>
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
                  <td>
                    <StatusBadge status={e.status} />
                  </td>
                  <td>{formatDateShort(e.created_at)}</td>
                  <td>
                    <Link to={e.id}>Verwalten</Link>
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
