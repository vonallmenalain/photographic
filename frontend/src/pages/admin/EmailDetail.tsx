import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../../api/client';
import { Alert, Spinner, StatusBadge } from '../../components/common';
import { formatPrice, formatDate } from '../../lib/format';

interface EmailObj {
  id: string;
  email: string;
  name?: string;
  status: string;
  note: string;
  verified_at: string | null;
}
interface LinkedChild {
  id: string;
  name: string;
  event_id: string;
  event_name: string;
}
interface OrderRow {
  id: string;
  status: string;
  total_cents: number;
  currency: string;
  created_at: string;
}
interface EventRow {
  id: string;
  name: string;
}
interface Child {
  id: string;
  name: string;
}

export default function EmailDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<{
    email: EmailObj;
    children: LinkedChild[];
    directPhotos: { id: string }[];
    orders: OrderRow[];
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  // child picker
  const [events, setEvents] = useState<EventRow[]>([]);
  const [pickEvent, setPickEvent] = useState('');
  const [eventChildren, setEventChildren] = useState<Child[]>([]);

  const load = async () => {
    try {
      const res = await api<typeof data>(`/api/admin/emails/${id}`, { admin: true });
      setData(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'E-Mail konnte nicht geladen werden.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    api<{ events: EventRow[] }>('/api/admin/events', { admin: true }).then((r) => setEvents(r.events));
  }, [id]);

  useEffect(() => {
    if (!pickEvent) {
      setEventChildren([]);
      return;
    }
    api<{ children: Child[] }>(`/api/admin/events/${pickEvent}`, { admin: true }).then((r) =>
      setEventChildren(r.children),
    );
  }, [pickEvent]);

  const patch = async (body: Record<string, unknown>) => {
    setMsg('');
    try {
      await api(`/api/admin/emails/${id}`, { method: 'PATCH', admin: true, body });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Aktualisierung fehlgeschlagen.');
    }
  };

  const linkChild = async (childId: string) => {
    await api(`/api/admin/emails/${id}/children`, { method: 'POST', admin: true, body: { childId } });
    load();
  };
  const unlinkChild = async (childId: string) => {
    await api(`/api/admin/emails/${id}/children/${childId}`, { method: 'DELETE', admin: true });
    load();
  };
  const resend = async () => {
    await api(`/api/admin/emails/${id}/resend-verification`, { method: 'POST', admin: true });
    setMsg('Eine neue Bestätigungs-E-Mail wurde ausgelöst.');
  };
  const remove = async () => {
    if (
      !confirm(
        'Diese E-Mail-Adresse wirklich löschen? Verknüpfungen, Sitzungen und Bestätigungs-Tokens dieser Adresse werden mit entfernt. Dies kann nicht rückgängig gemacht werden.',
      )
    )
      return;
    setError('');
    try {
      await api(`/api/admin/emails/${id}`, { method: 'DELETE', admin: true });
      navigate(-1);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'E-Mail-Adresse konnte nicht gelöscht werden.');
    }
  };

  if (loading) return <Spinner />;
  if (!data) return <Alert kind="error">{error || 'Nicht gefunden.'}</Alert>;

  const { email, children, directPhotos, orders } = data;

  return (
    <div>
      <p>
        <button
          type="button"
          className="btn ghost small"
          style={{ paddingLeft: 0 }}
          onClick={() => navigate(-1)}
        >
          ← Zurück
        </button>
      </p>
      <div className="row between">
        <h1 style={{ marginBottom: 4 }}>{email.email}</h1>
        <StatusBadge status={email.status === 'verified' ? 'verified' : 'not_verified'} />
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      {msg && <Alert kind="success">{msg}</Alert>}

      <div className="card mb">
        <h2>Einstellungen</h2>
        <div className="field" style={{ marginBottom: 12 }}>
          <label>Verifizierung</label>
          <div className="row" style={{ alignItems: 'center', gap: 10 }}>
            <StatusBadge status={email.status === 'verified' ? 'verified' : 'not_verified'} />
            <span className="muted" style={{ fontSize: '0.82rem' }}>
              {email.status === 'verified'
                ? `Von den Eltern bestätigt${email.verified_at ? ` am ${formatDate(email.verified_at)}` : ''}.`
                : 'Noch nicht von den Eltern bestätigt. Der Status wird automatisch gesetzt, sobald sich die Eltern per E-Mail anmelden.'}
            </span>
          </div>
        </div>
        <div className="field">
          <label>E-Mail-Adresse korrigieren</label>
          <EmailEditor current={email.email} onSave={(v) => patch({ email: v })} />
        </div>
        <div className="field mt">
          <label>Name (intern)</label>
          <NoteEditor current={email.name ?? ''} onSave={(v) => patch({ name: v })} />
        </div>
        <div className="field mt">
          <label>Notiz (intern)</label>
          <NoteEditor current={email.note} onSave={(v) => patch({ note: v })} />
        </div>
        <button className="btn secondary" onClick={resend}>
          Bestätigungs-E-Mail erneut senden
        </button>
      </div>

      <div className="card mb">
        <h2>Zugeordnete Kinder</h2>
        <p className="muted" style={{ fontSize: '0.82rem' }}>
          Über diese Verknüpfungen entscheidet sich, welche Fotos die Familie sieht.
        </p>
        <div className="mb">
          {children.length === 0 && <span className="muted">Noch keine Kinder verknüpft.</span>}
          {children.map((c) => (
            <span className="chip" key={c.id}>
              {c.name} <span className="muted">({c.event_name})</span>
              <button onClick={() => unlinkChild(c.id)}>×</button>
            </span>
          ))}
        </div>
        <div className="row">
          <select value={pickEvent} onChange={(e) => setPickEvent(e.target.value)} style={{ width: 240 }}>
            <option value="">— Auftrag wählen —</option>
            {events.map((ev) => (
              <option key={ev.id} value={ev.id}>
                {ev.name}
              </option>
            ))}
          </select>
          <select
            disabled={!pickEvent}
            onChange={(e) => e.target.value && linkChild(e.target.value)}
            value=""
            style={{ width: 240 }}
          >
            <option value="">— Kind hinzufügen —</option>
            {eventChildren
              .filter((c) => !children.some((lc) => lc.id === c.id))
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        </div>

        <AddRelatedEmail
          emailId={email.id}
          childCount={children.length}
          onAdded={(message) => {
            setMsg(message);
            setError('');
          }}
          onError={(message) => setError(message)}
        />
      </div>

      <div className="card mb">
        <h2>Direkt zugewiesene Fotos</h2>
        <p className="muted">
          {directPhotos.length} Foto(s) direkt zugewiesen (z. B. Klassenfotos).
        </p>
      </div>

      <div className="card">
        <h2>Bestellungen</h2>
        {orders.length === 0 ? (
          <p className="muted">Noch keine Bestellungen.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Datum</th>
                <th>Status</th>
                <th>Summe</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id}>
                  <td>{formatDate(o.created_at)}</td>
                  <td>
                    <StatusBadge status={o.status} />
                  </td>
                  <td>{formatPrice(o.total_cents, o.currency)}</td>
                  <td>
                    <Link to={`/admin/orders/${o.id}`}>Details</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Danger zone */}
      <div className="card mb" style={{ marginTop: 16, borderColor: 'var(--danger, #e5484d)' }}>
        <div className="row between">
          <div>
            <h2 style={{ marginBottom: 4 }}>E-Mail-Adresse löschen</h2>
            <p className="muted" style={{ fontSize: '0.82rem', margin: 0 }}>
              Entfernt diese Adresse samt aller Verknüpfungen, Sitzungen und Bestätigungs-Tokens. Dies
              kann nicht rückgängig gemacht werden.
            </p>
          </div>
          <button className="btn danger" onClick={remove}>
            E-Mail-Adresse löschen
          </button>
        </div>
      </div>
    </div>
  );
}

function EmailEditor({ current, onSave }: { current: string; onSave: (v: string) => void }) {
  const [val, setVal] = useState(current);
  return (
    <div className="row">
      <input value={val} onChange={(e) => setVal(e.target.value)} style={{ flex: 1 }} />
      <button className="btn secondary small" disabled={val === current} onClick={() => onSave(val)}>
        Speichern
      </button>
    </div>
  );
}

/**
 * Adds a further parent e-mail address (e.g. the second parent) that should see
 * exactly the same children as this one. The address is created if needed and
 * automatically linked to every child currently linked here.
 */
function AddRelatedEmail({
  emailId,
  childCount,
  onAdded,
  onError,
}: {
  emailId: string;
  childCount: number;
  onAdded: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!value.trim()) return;
    setBusy(true);
    try {
      const res = await api<{ id: string; created: boolean; linksCreated: number }>(
        `/api/admin/emails/${emailId}/related-emails`,
        { method: 'POST', admin: true, body: { email: value.trim(), name: name.trim() } },
      );
      const linkPart =
        res.linksCreated > 0
          ? ` und mit ${res.linksCreated} Kind(ern) verknüpft`
          : childCount === 0
            ? ' (noch keine Kinder zum Verknüpfen vorhanden)'
            : ' (bereits mit denselben Kindern verknüpft)';
      onAdded(
        `E-Mail-Adresse ${res.created ? 'angelegt' : 'übernommen'}${linkPart}.`,
      );
      setValue('');
      setName('');
      setOpen(false);
      // Jump straight to the new address so the admin can manage it further.
      navigate(`/admin/emails/${res.id}`);
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Konnte nicht hinzugefügt werden.');
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <div style={{ marginTop: 14 }}>
        <button type="button" className="btn secondary small" onClick={() => setOpen(true)}>
          + Weitere E-Mail-Adresse hinzufügen
        </button>
        <p className="muted" style={{ fontSize: '0.8rem', marginTop: 6, marginBottom: 0 }}>
          Z. B. die Adresse des zweiten Elternteils. Sie wird mit denselben Kindern verknüpft wie
          diese Adresse und sieht damit dieselben Fotos.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} style={{ marginTop: 14 }}>
      <div className="row" style={{ alignItems: 'flex-end', flexWrap: 'wrap', gap: 10 }}>
        <div className="field" style={{ marginBottom: 0, minWidth: 240, flex: 1 }}>
          <label style={{ fontSize: '0.8rem' }}>Weitere E-Mail-Adresse</label>
          <input
            type="email"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="zweiter-elternteil@beispiel.ch"
            autoFocus
            required
          />
        </div>
        <div className="field" style={{ marginBottom: 0, minWidth: 200 }}>
          <label style={{ fontSize: '0.8rem' }}>Name (optional)</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="z. B. Familie Muster" />
        </div>
        <button className="btn small" type="submit" disabled={busy}>
          {busy ? 'Wird hinzugefügt …' : 'Hinzufügen'}
        </button>
        <button
          type="button"
          className="btn ghost small"
          onClick={() => {
            setOpen(false);
            setValue('');
            setName('');
          }}
          disabled={busy}
        >
          Abbrechen
        </button>
      </div>
      <p className="muted" style={{ fontSize: '0.8rem', marginTop: 6, marginBottom: 0 }}>
        {childCount > 0
          ? `Die Adresse wird mit ${childCount} verknüpften Kind(ern) dieser Adresse verbunden.`
          : 'Dieser Adresse ist noch kein Kind zugewiesen – die neue Adresse wird vorerst ohne Kind-Verknüpfung angelegt.'}
      </p>
    </form>
  );
}

function NoteEditor({ current, onSave }: { current: string; onSave: (v: string) => void }) {
  const [val, setVal] = useState(current);
  return (
    <div className="row">
      <input value={val} onChange={(e) => setVal(e.target.value)} style={{ flex: 1 }} placeholder="Notiz …" />
      <button className="btn secondary small" disabled={val === current} onClick={() => onSave(val)}>
        Speichern
      </button>
    </div>
  );
}
