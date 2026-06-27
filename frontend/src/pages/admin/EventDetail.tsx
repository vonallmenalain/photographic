import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../../api/client';
import { Alert, Modal, Spinner, StatusBadge } from '../../components/common';
import EventEmails from './EventEmails';
import { PhotoManager, type ManagedPhoto } from './PhotoManager';

interface EventObj {
  id: string;
  name: string;
  description: string;
  status: string;
  expires_at: string | null;
}
interface Child {
  id: string;
  name: string;
  note: string;
}

const EVENT_STATUS_OPTIONS = [
  { value: 'draft', label: 'Entwurf' },
  { value: 'published', label: 'Veröffentlicht' },
  { value: 'archived', label: 'Archiviert' },
] as const;

export default function EventDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [event, setEvent] = useState<EventObj | null>(null);
  const [children, setChildren] = useState<Child[]>([]);
  const [photos, setPhotos] = useState<ManagedPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showAddChild, setShowAddChild] = useState(false);
  const [emailCount, setEmailCount] = useState(0);
  // Bumped after children change so the embedded PhotoManager re-loads photos
  // (a deleted child clears the child link on its photos server-side).
  const [photoRefresh, setPhotoRefresh] = useState(0);

  const load = async () => {
    try {
      const [res, emailRes] = await Promise.all([
        api<{ event: EventObj; children: Child[] }>(`/api/admin/events/${id}`, {
          admin: true,
        }),
        api<{ emails: { id: string }[] }>(`/api/admin/emails?eventId=${id}`, { admin: true }).catch(
          () => ({ emails: [] as { id: string }[] }),
        ),
      ]);
      setEvent(res.event);
      setChildren(res.children);
      setEmailCount(emailRes.emails.length);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Auftrag konnte nicht geladen werden.');
    } finally {
      setLoading(false);
    }
  };

  const scrollToCard = (elId: string) =>
    document.getElementById(elId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  useEffect(() => {
    load();
  }, [id]);

  const patchEvent = async (data: Partial<EventObj>) => {
    await api(`/api/admin/events/${id}`, { method: 'PATCH', admin: true, body: data });
    load();
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

  const addChild = async (name: string) => {
    await api(`/api/admin/events/${id}/children`, { method: 'POST', admin: true, body: { name } });
    await load();
    setPhotoRefresh((n) => n + 1);
  };

  const deleteChild = async (childId: string) => {
    if (!confirm('Kind löschen? Zuordnungen gehen verloren.')) return;
    await api(`/api/admin/children/${childId}`, { method: 'DELETE', admin: true });
    await load();
    setPhotoRefresh((n) => n + 1);
  };

  const publish = async () => {
    setError('');
    if (photos.length === 0) {
      alert('Es sind noch keine Fotos in diesem Auftrag. Bitte lade zuerst Fotos hoch.');
      return;
    }
    const unassigned = photos.filter((p) => !p.is_class_photo && !p.child_id).length;
    if (
      unassigned > 0 &&
      !confirm(
        `${unassigned} Foto(s) sind noch keinem Kind zugeordnet und keine Gruppen-/Klassenfotos – sie werden für niemanden sichtbar sein. Trotzdem jetzt veröffentlichen?`,
      )
    ) {
      return;
    }
    await patchEvent({ status: 'published' });
  };

  if (loading) return <Spinner />;
  if (!event) return <Alert kind="error">{error || 'Auftrag nicht gefunden.'}</Alert>;

  const duplicateFilenameCount = (() => {
    const counts = new Map<string, number>();
    for (const p of photos) {
      const key = (p.original_filename || '').trim().toLowerCase();
      if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return photos.filter((p) => {
      const key = (p.original_filename || '').trim().toLowerCase();
      return !!key && (counts.get(key) ?? 0) > 1;
    }).length;
  })();
  const unassignedCount = photos.filter((p) => !p.is_class_photo && !p.child_id).length;

  const isPublished = event.status === 'published';
  const checklist = [
    {
      label: 'Kinder & E-Mails erfassen',
      done: children.length > 0 && emailCount > 0,
      detail: `${children.length} Kind(er) · ${emailCount} E-Mail-Adresse(n)`,
      action: (
        <div className="row" style={{ gap: 8 }}>
          <Link to={`/admin/import?eventId=${event.id}`} className="btn secondary small">
            Importieren
          </Link>
          <button className="btn ghost small" onClick={() => scrollToCard('ev-emails')}>
            Zu E-Mails &amp; Kindern
          </button>
        </div>
      ),
    },
    {
      label: 'Fotos hochladen',
      done: photos.length > 0,
      detail: `${photos.length} Foto(s) hochgeladen`,
      action: (
        <button className="btn ghost small" onClick={() => scrollToCard('ev-upload')}>
          Zum Upload
        </button>
      ),
    },
    {
      label: 'Zuordnung prüfen',
      done: photos.length > 0 && unassignedCount === 0 && duplicateFilenameCount === 0,
      detail:
        photos.length === 0
          ? 'Noch keine Fotos'
          : `${unassignedCount} unzugeordnet · ${duplicateFilenameCount} Duplikat(e)`,
      action: (
        <button className="btn ghost small" onClick={() => scrollToCard('ev-photos')}>
          Zur Zuordnung
        </button>
      ),
    },
    {
      label: 'Veröffentlichen',
      done: isPublished,
      detail: isPublished
        ? 'Der Auftrag ist veröffentlicht – Fotos sind für berechtigte Eltern sichtbar.'
        : 'Sichtbar für Eltern erst nach dem Veröffentlichen.',
      action: isPublished ? (
        <button className="btn ghost small" onClick={() => patchEvent({ status: 'draft' })}>
          Auf Entwurf zurücksetzen
        </button>
      ) : (
        <button className="btn small" onClick={publish}>
          Jetzt veröffentlichen
        </button>
      ),
    },
    {
      label: 'Eltern einladen',
      done: false,
      optional: true,
      detail: 'Sende den Eltern den Link zur Galerie (am besten nach dem Veröffentlichen).',
      action: (
        <button
          className="btn ghost small"
          onClick={() => scrollToCard('ev-emails')}
          disabled={!isPublished}
          title={isPublished ? '' : 'Erst veröffentlichen, dann einladen'}
        >
          Einladung senden
        </button>
      ),
    },
  ];

  return (
    <div>
      <p>
        <Link to="/admin/events">← Alle Aufträge</Link>
      </p>
      <div className="row between">
        <h1 style={{ marginBottom: 4 }}>{event.name}</h1>
        <StatusBadge status={event.status} />
      </div>
      {error && <Alert kind="error">{error}</Alert>}

      {/* Guided publication checklist */}
      <div className="card mb publish-checklist">
        <h2 style={{ marginTop: 0 }}>So veröffentlichst du diesen Auftrag</h2>
        <ol className="checklist">
          {checklist.map((step, i) => (
            <li key={step.label} className={`checklist-step${step.done ? ' done' : ''}`}>
              <span className="checklist-marker" aria-hidden="true">
                {step.done ? '✓' : i + 1}
              </span>
              <div className="checklist-body">
                <div className="checklist-title">
                  {step.label}
                  {step.optional ? <span className="muted"> (optional)</span> : null}
                </div>
                <div className="muted checklist-detail">{step.detail}</div>
              </div>
              <div className="checklist-action">{step.action}</div>
            </li>
          ))}
        </ol>
      </div>

      {/* Auftrag settings */}
      <div className="card mb">
        <div className="row between">
          <div>
            <label>Status des Auftrags</label>
            <select
              value={event.status}
              onChange={(e) => patchEvent({ status: e.target.value })}
              style={{ width: 240 }}
            >
              {EVENT_STATUS_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
              {!EVENT_STATUS_OPTIONS.some((s) => s.value === event.status) && (
                <option value={event.status}>{event.status}</option>
              )}
            </select>
            <p className="muted" style={{ fontSize: '0.82rem', marginTop: 8 }}>
              Erst bei Status „Veröffentlicht“ sind die zugeordneten Fotos für berechtigte Eltern
              sichtbar. „Archiviert“ wird nach Ablauf der Aufbewahrungsfrist automatisch gesetzt.
            </p>
          </div>
          <div className="muted" style={{ textAlign: 'right' }}>
            {photos.length} Fotos
            <br />
            {children.length} Kinder
          </div>
        </div>
      </div>

      {/* Children */}
      <div className="card mb">
        <div className="row between">
          <h2 style={{ marginBottom: 0 }}>Kinder</h2>
          <button className="btn secondary small" onClick={() => setShowAddChild(true)}>
            + Kind anlegen
          </button>
        </div>
        <p className="muted" style={{ fontSize: '0.82rem' }}>
          Namen sind nur intern – sie werden Eltern niemals angezeigt.
        </p>
        {children.length === 0 ? (
          <p className="muted">Noch keine Kinder angelegt.</p>
        ) : (
          <div>
            {children.map((c) => (
              <span className="chip" key={c.id}>
                {c.name}
                <button onClick={() => deleteChild(c.id)} title="Löschen">
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* E-Mail-Adressen (Eltern) dieses Auftrags */}
      <div id="ev-emails">
        <EventEmails eventId={event.id} eventChildren={children} />
      </div>

      {/* Fotos: Upload + Zuordnung (gemeinsame Komponente) */}
      <PhotoManager
        eventId={event.id}
        children={children}
        refreshSignal={photoRefresh}
        onPhotosChange={setPhotos}
      />

      {/* Danger zone */}
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

      {showAddChild && (
        <AddChildModal
          onClose={() => setShowAddChild(false)}
          onCreate={async (name) => {
            await addChild(name);
            setShowAddChild(false);
          }}
        />
      )}
    </div>
  );
}

function AddChildModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setError('');
    setBusy(true);
    try {
      await onCreate(trimmed);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Konnte nicht angelegt werden.');
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Kind anlegen"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>
            Abbrechen
          </button>
          <button type="submit" form="add-child-form" className="btn" disabled={busy}>
            {busy ? 'Wird angelegt …' : 'Kind anlegen'}
          </button>
        </>
      }
    >
      <form id="add-child-form" onSubmit={submit}>
        {error && <Alert kind="error">{error}</Alert>}
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Name des Kindes</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="z. B. Alain"
            autoFocus
            required
          />
          <p className="muted" style={{ fontSize: '0.8rem', marginTop: 6, marginBottom: 0 }}>
            Der Name ist nur intern sichtbar – Eltern sehen ihn nie.
          </p>
        </div>
      </form>
    </Modal>
  );
}
