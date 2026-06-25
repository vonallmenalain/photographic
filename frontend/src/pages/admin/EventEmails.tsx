import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../../api/client';
import { Alert, Modal, StatusBadge } from '../../components/common';

interface EventRef {
  id: string;
  name: string;
}
interface ChildLink {
  id: string;
  name: string;
  event_id: string;
}
interface EmailRow {
  id: string;
  email: string;
  name?: string;
  status: string;
  events?: EventRef[];
  children?: ChildLink[];
}
interface ChildRef {
  id: string;
  name: string;
}

/**
 * E-Mail-Adressen-Verwaltung direkt im Auftrag. Bietet dieselben Funktionen wie
 * die frühere globale E-Mail-Liste, aber auf diesen Auftrag gefiltert: anlegen
 * (optional direkt einem Kind dieses Auftrags zuweisen), suchen, verwalten und
 * löschen. Die Freitextsuche findet sowohl die E-Mail/den Namen als auch das
 * verknüpfte Kind.
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
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

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

  const childNamesFor = (row: EmailRow) => {
    const links = (row.children ?? []).filter((c) => c.event_id === eventId);
    return links.map((c) => c.name);
  };

  return (
    <div className="card mb">
      <div className="row between">
        <h2 style={{ marginBottom: 0 }}>E-Mail-Adressen</h2>
        <button className="btn secondary small" onClick={() => setShowCreate(true)}>
          + E-Mail anlegen
        </button>
      </div>
      <p className="muted" style={{ fontSize: '0.82rem' }}>
        Eltern-Adressen dieses Auftrags. Die E-Mail ist die zentrale Identität und entscheidet, welche
        Fotos eine Familie sieht.
      </p>

      {error && <Alert kind="error">{error}</Alert>}
      {msg && <Alert kind="success">{msg}</Alert>}

      <div className="field" style={{ maxWidth: 320, marginTop: 6, marginBottom: 0 }}>
        <label style={{ fontSize: '0.8rem' }}>Suchen</label>
        <input
          placeholder="E-Mail, Name oder Kind …"
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
          {q
            ? 'Keine Treffer für diese Suche.'
            : 'Noch keine E-Mail-Adressen mit diesem Auftrag verknüpft.'}
        </p>
      ) : (
        <table style={{ marginTop: 14 }}>
          <thead>
            <tr>
              <th>E-Mail</th>
              <th>Name</th>
              <th>Name Kind</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {emails.map((e) => {
              const childNames = childNamesFor(e);
              return (
                <tr key={e.id}>
                  <td>
                    <Link to={`/admin/emails/${e.id}`}>{e.email}</Link>
                  </td>
                  <td>{e.name || <span className="muted">—</span>}</td>
                  <td>
                    {childNames.length > 0 ? (
                      childNames.map((n) => (
                        <span className="badge" key={n} style={{ marginRight: 4 }}>
                          {n}
                        </span>
                      ))
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>
                    <StatusBadge status={e.status} />
                  </td>
                  <td>
                    <div className="row" style={{ gap: 10 }}>
                      <Link to={`/admin/emails/${e.id}`}>Verwalten</Link>
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
              );
            })}
          </tbody>
        </table>
      )}

      {showCreate && (
        <CreateEmailModal
          eventChildren={eventChildren}
          onClose={() => setShowCreate(false)}
          onCreated={(message) => {
            setShowCreate(false);
            setMsg(message);
            setError('');
            load();
          }}
        />
      )}
    </div>
  );
}

function CreateEmailModal({
  eventChildren,
  onClose,
  onCreated,
}: {
  eventChildren: ChildRef[];
  onClose: () => void;
  onCreated: (msg: string) => void;
}) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [linkChildId, setLinkChildId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const created = await api<{ id: string }>('/api/admin/emails', {
        method: 'POST',
        admin: true,
        body: { email, name },
      });
      if (linkChildId) {
        await api(`/api/admin/emails/${created.id}/children`, {
          method: 'POST',
          admin: true,
          body: { childId: linkChildId },
        });
        onCreated('E-Mail angelegt und mit dem Kind verknüpft.');
      } else {
        onCreated(
          'E-Mail angelegt. Damit sie diesem Auftrag zugeordnet ist, verknüpfe sie mit einem Kind (Spalte „Verwalten“).',
        );
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Konnte nicht angelegt werden.');
      setBusy(false);
    }
  };

  return (
    <Modal
      title="E-Mail anlegen"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>
            Abbrechen
          </button>
          <button type="submit" form="create-email-form" className="btn" disabled={busy}>
            {busy ? 'Wird angelegt …' : 'E-Mail anlegen'}
          </button>
        </>
      }
    >
      <form id="create-email-form" onSubmit={submit}>
        {error && <Alert kind="error">{error}</Alert>}
        <div className="field">
          <label>E-Mail</label>
          <input
            type="email"
            placeholder="eltern-adresse@beispiel.ch"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus
            required
          />
        </div>
        <div className="field">
          <label>Name des Elternteils (optional)</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="z. B. Familie Muster" />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Kind verknüpfen (optional)</label>
          <select value={linkChildId} onChange={(e) => setLinkChildId(e.target.value)}>
            <option value="">— kein Kind —</option>
            {eventChildren.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <p className="muted" style={{ fontSize: '0.8rem', marginTop: 6, marginBottom: 0 }}>
            Verknüpfst du ein Kind, ist die Adresse direkt diesem Auftrag zugeordnet.
          </p>
        </div>
      </form>
    </Modal>
  );
}
