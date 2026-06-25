import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../../api/client';
import { Alert, StatusBadge } from '../../components/common';

interface EventRef {
  id: string;
  name: string;
}
interface EmailRow {
  id: string;
  email: string;
  name?: string;
  status: string;
  events?: EventRef[];
}
interface ChildRef {
  id: string;
  name: string;
}

/**
 * E-Mail-Adressen-Verwaltung direkt im Auftrag. Bietet dieselben Funktionen wie
 * die frühere globale E-Mail-Liste, aber auf diesen Auftrag gefiltert: anlegen
 * (optional direkt einem Kind dieses Auftrags zuweisen), suchen, verwalten,
 * Bestätigung erneut senden und löschen.
 */
export default function EventEmails({
  eventId,
  eventChildren,
}: {
  eventId: string;
  eventChildren: ChildRef[];
}) {
  const [emails, setEmails] = useState<EmailRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newName, setNewName] = useState('');
  const [linkChildId, setLinkChildId] = useState('');
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const load = (query = q) => {
    const params = new URLSearchParams();
    params.set('eventId', eventId);
    if (query) params.set('q', query);
    return api<{ emails: EmailRow[] }>(`/api/admin/emails?${params.toString()}`, { admin: true })
      .then((r) => setEmails(r.emails))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMsg('');
    setBusy(true);
    try {
      const created = await api<{ id: string }>('/api/admin/emails', {
        method: 'POST',
        admin: true,
        body: { email: newEmail, name: newName },
      });
      if (linkChildId) {
        await api(`/api/admin/emails/${created.id}/children`, {
          method: 'POST',
          admin: true,
          body: { childId: linkChildId },
        });
      } else {
        setMsg(
          'E-Mail angelegt. Damit sie diesem Auftrag zugeordnet ist, verknüpfe sie mit einem Kind (Spalte „Verwalten“) oder wähle oben ein Kind aus.',
        );
      }
      setNewEmail('');
      setNewName('');
      setLinkChildId('');
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Konnte nicht angelegt werden.');
    } finally {
      setBusy(false);
    }
  };

  const resend = async (row: EmailRow) => {
    setMsg('');
    setError('');
    try {
      await api(`/api/admin/emails/${row.id}/resend-verification`, { method: 'POST', admin: true });
      setMsg(`Bestätigungs-E-Mail an ${row.email} ausgelöst.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Konnte nicht gesendet werden.');
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
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Konnte nicht gelöscht werden.');
    }
  };

  return (
    <div className="card mb">
      <h2 style={{ marginBottom: 4 }}>E-Mail-Adressen</h2>
      <p className="muted" style={{ fontSize: '0.82rem' }}>
        Eltern-Adressen dieses Auftrags. Die E-Mail ist die zentrale Identität und entscheidet, welche
        Fotos eine Familie sieht.
      </p>

      {error && <Alert kind="error">{error}</Alert>}
      {msg && <Alert kind="success">{msg}</Alert>}

      <form onSubmit={create} className="row" style={{ alignItems: 'flex-end' }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <label style={{ fontSize: '0.8rem' }}>E-Mail</label>
          <input
            type="email"
            placeholder="eltern-adresse@beispiel.ch"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            required
          />
        </div>
        <div style={{ flex: 1, minWidth: 160 }}>
          <label style={{ fontSize: '0.8rem' }}>Name (optional)</label>
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Name" />
        </div>
        <div style={{ minWidth: 180 }}>
          <label style={{ fontSize: '0.8rem' }}>Kind verknüpfen (optional)</label>
          <select value={linkChildId} onChange={(e) => setLinkChildId(e.target.value)}>
            <option value="">— kein Kind —</option>
            {eventChildren.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <button className="btn" disabled={busy}>
          E-Mail anlegen
        </button>
      </form>

      <div className="field" style={{ maxWidth: 320, marginTop: 14, marginBottom: 0 }}>
        <label style={{ fontSize: '0.8rem' }}>Suchen</label>
        <input
          placeholder="E-Mail oder Name …"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            load(e.target.value);
          }}
        />
      </div>

      {loading ? (
        <p className="muted" style={{ marginTop: 12 }}>
          Wird geladen …
        </p>
      ) : emails.length === 0 ? (
        <p className="muted" style={{ marginTop: 12 }}>
          Noch keine E-Mail-Adressen mit diesem Auftrag verknüpft.
        </p>
      ) : (
        <table style={{ marginTop: 14 }}>
          <thead>
            <tr>
              <th>E-Mail</th>
              <th>Name</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {emails.map((e) => (
              <tr key={e.id}>
                <td>
                  <Link to={`/admin/emails/${e.id}`}>{e.email}</Link>
                </td>
                <td>{e.name || <span className="muted">—</span>}</td>
                <td>
                  <StatusBadge status={e.status} />
                </td>
                <td>
                  <div className="row" style={{ gap: 10 }}>
                    <Link to={`/admin/emails/${e.id}`}>Verwalten</Link>
                    <button className="btn ghost small" onClick={() => resend(e)}>
                      Bestätigung senden
                    </button>
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
  );
}
