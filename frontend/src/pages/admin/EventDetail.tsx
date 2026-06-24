import { useEffect, useRef, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api, ApiError, fetchAdminImage } from '../../api/client';
import { Alert, Spinner, StatusBadge } from '../../components/common';
import { AdminThumb } from '../../components/AdminThumb';

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
interface Photo {
  id: string;
  child_id: string | null;
  is_class_photo: number;
  original_filename: string;
  status: string;
  published: number;
  width: number | null;
  height: number | null;
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
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const [emailModalPhoto, setEmailModalPhoto] = useState<Photo | null>(null);
  const [zoomPhoto, setZoomPhoto] = useState<Photo | null>(null);

  const load = async () => {
    try {
      const res = await api<{ event: EventObj; children: Child[]; photos: Photo[] }>(
        `/api/admin/events/${id}`,
        { admin: true },
      );
      setEvent(res.event);
      setChildren(res.children);
      setPhotos(res.photos);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Event konnte nicht geladen werden.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [id]);

  const upload = async () => {
    const files = fileRef.current?.files;
    if (!files || files.length === 0) return;
    setUploading(true);
    setUploadMsg('');
    setError('');
    const fd = new FormData();
    Array.from(files).forEach((f) => fd.append('photos', f));
    try {
      const res = await api<{ results: { ok: boolean }[] }>(`/api/admin/events/${id}/photos`, {
        method: 'POST',
        admin: true,
        formData: fd,
      });
      const ok = res.results.filter((r) => r.ok).length;
      setUploadMsg(`${ok} von ${res.results.length} Fotos hochgeladen und verarbeitet.`);
      if (fileRef.current) fileRef.current.value = '';
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Upload fehlgeschlagen.');
    } finally {
      setUploading(false);
    }
  };

  const patchEvent = async (data: Partial<EventObj>) => {
    await api(`/api/admin/events/${id}`, { method: 'PATCH', admin: true, body: data });
    load();
  };

  const deleteEvent = async () => {
    if (
      !confirm(
        'Dieses Event wirklich löschen? Alle Fotos, Kinder und Zuordnungen dieses Events werden unwiderruflich entfernt.',
      )
    )
      return;
    try {
      await api(`/api/admin/events/${id}`, { method: 'DELETE', admin: true });
      navigate('/admin/events');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Event konnte nicht gelöscht werden.');
    }
  };

  const patchPhoto = async (photoId: string, data: Record<string, unknown>) => {
    await api(`/api/admin/photos/${photoId}`, { method: 'PATCH', admin: true, body: data });
    load();
  };

  const deletePhoto = async (photoId: string) => {
    if (!confirm('Foto wirklich löschen? Dies entfernt auch alle Varianten.')) return;
    await api(`/api/admin/photos/${photoId}`, { method: 'DELETE', admin: true });
    load();
  };

  const addChild = async () => {
    const name = prompt('Name des Kindes (nur intern sichtbar):');
    if (!name) return;
    await api(`/api/admin/events/${id}/children`, { method: 'POST', admin: true, body: { name } });
    load();
  };

  const deleteChild = async (childId: string) => {
    if (!confirm('Kind löschen? Zuordnungen gehen verloren.')) return;
    await api(`/api/admin/children/${childId}`, { method: 'DELETE', admin: true });
    load();
  };

  if (loading) return <Spinner />;
  if (!event) return <Alert kind="error">{error || 'Event nicht gefunden.'}</Alert>;

  const publishedCount = photos.filter((p) => p.published).length;

  return (
    <div>
      <p>
        <Link to="/admin/events">← Alle Events</Link>
      </p>
      <div className="row between">
        <h1 style={{ marginBottom: 4 }}>{event.name}</h1>
        <StatusBadge status={event.status} />
      </div>
      {error && <Alert kind="error">{error}</Alert>}

      {/* Event settings */}
      <div className="card mb">
        <div className="row between">
          <div>
            <label>Status des Events</label>
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
              Erst bei Status „Veröffentlicht“ sind freigegebene Fotos für berechtigte Eltern
              sichtbar. „Archiviert“ wird nach Ablauf der Aufbewahrungsfrist automatisch gesetzt.
            </p>
          </div>
          <div className="muted" style={{ textAlign: 'right' }}>
            {photos.length} Fotos · {publishedCount} veröffentlicht
            <br />
            {children.length} Kinder
          </div>
        </div>
      </div>

      {/* Children */}
      <div className="card mb">
        <div className="row between">
          <h2 style={{ marginBottom: 0 }}>Kinder</h2>
          <button className="btn secondary small" onClick={addChild}>
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

      {/* Upload */}
      <div className="card mb">
        <h2>Fotos hochladen</h2>
        <p className="muted" style={{ fontSize: '0.85rem' }}>
          Lade nur die Originale hoch. Thumbnail und Wasserzeichen-Preview werden automatisch erzeugt.
        </p>
        {uploadMsg && <Alert kind="success">{uploadMsg}</Alert>}
        <div className="row">
          <input ref={fileRef} type="file" accept="image/*" multiple style={{ flex: 1 }} />
          <button className="btn" onClick={upload} disabled={uploading}>
            {uploading ? 'Wird hochgeladen …' : 'Hochladen & verarbeiten'}
          </button>
        </div>
      </div>

      {/* Photos */}
      <div className="card">
        <h2>Fotos &amp; Zuordnung</h2>
        {photos.length === 0 ? (
          <p className="muted">Noch keine Fotos in diesem Event.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {photos.map((p) => (
              <div
                key={p.id}
                style={{
                  display: 'flex',
                  gap: 16,
                  alignItems: 'center',
                  padding: 12,
                  border: '1px solid var(--border)',
                  borderRadius: 12,
                }}
              >
                <AdminThumb photoId={p.id} onClick={() => setZoomPhoto(p)} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <StatusBadge status={p.status} />
                    {p.published ? (
                      <span className="badge green">Veröffentlicht</span>
                    ) : (
                      <span className="badge gray">Nicht veröffentlicht</span>
                    )}
                    {p.is_class_photo ? <span className="badge class">Klassenfoto</span> : null}
                  </div>
                  <div className="muted" style={{ fontSize: '0.8rem', marginTop: 4 }} title={p.original_filename}>
                    {p.original_filename} {p.width ? `· ${p.width}×${p.height}` : ''}
                  </div>

                  <div className="row" style={{ marginTop: 10 }}>
                    <label style={{ margin: 0 }}>
                      <input
                        type="checkbox"
                        checked={!!p.is_class_photo}
                        style={{ width: 'auto', marginRight: 6 }}
                        onChange={(e) =>
                          patchPhoto(p.id, {
                            is_class_photo: e.target.checked,
                            child_id: e.target.checked ? null : p.child_id,
                          })
                        }
                      />
                      Gruppen-/Klassenfoto
                    </label>

                    {!p.is_class_photo && (
                      <select
                        value={p.child_id ?? ''}
                        onChange={(e) =>
                          patchPhoto(p.id, {
                            child_id: e.target.value || null,
                            status: e.target.value ? 'assigned' : 'processed',
                          })
                        }
                        style={{ width: 220 }}
                      >
                        <option value="">— Kind zuordnen —</option>
                        {children.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    )}

                    {p.is_class_photo && (
                      <button className="btn secondary small" onClick={() => setEmailModalPhoto(p)}>
                        E-Mail-Zuordnung verwalten
                      </button>
                    )}
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <button
                    className={p.published ? 'btn secondary small' : 'btn small'}
                    onClick={() => patchPhoto(p.id, { published: !p.published })}
                  >
                    {p.published ? 'Zurückziehen' : 'Veröffentlichen'}
                  </button>
                  <button
                    className="btn ghost small"
                    onClick={() => patchPhoto(p.id, { status: 'processed' })}
                    title="Status auf 'verarbeitet' zurücksetzen"
                  >
                    Neu prüfen
                  </button>
                  <button className="btn ghost small" onClick={() => deletePhoto(p.id)}>
                    Löschen
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Danger zone */}
      <div className="card mb" style={{ marginTop: 16, borderColor: 'var(--danger, #e5484d)' }}>
        <div className="row between">
          <div>
            <h2 style={{ marginBottom: 4 }}>Event löschen</h2>
            <p className="muted" style={{ fontSize: '0.82rem', margin: 0 }}>
              Entfernt das Event samt aller Fotos, Kinder und Zuordnungen. Dies kann nicht rückgängig
              gemacht werden.
            </p>
          </div>
          <button className="btn danger" onClick={deleteEvent}>
            Event löschen
          </button>
        </div>
      </div>

      {emailModalPhoto && (
        <PhotoEmailModal photo={emailModalPhoto} onClose={() => setEmailModalPhoto(null)} />
      )}

      {zoomPhoto && <AdminPhotoLightbox photo={zoomPhoto} onClose={() => setZoomPhoto(null)} />}
    </div>
  );
}

/** Full-resolution, watermark-free preview of a single photo for admins. */
function AdminPhotoLightbox({ photo, onClose }: { photo: Photo; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let revoked: string | null = null;
    let active = true;
    fetchAdminImage(`/api/admin/photos/${photo.id}/original`)
      .then((u) => {
        if (active) {
          setUrl(u);
          revoked = u;
        } else {
          URL.revokeObjectURL(u);
        }
      })
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [photo.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="lightbox" onClick={onClose}>
      <div className="inner" onClick={(e) => e.stopPropagation()}>
        <button className="close" onClick={onClose} aria-label="Schließen">
          ×
        </button>
        {failed ? (
          <Alert kind="error">Originaldatei konnte nicht geladen werden.</Alert>
        ) : url ? (
          <img src={url} alt={photo.original_filename} style={{ pointerEvents: 'auto' }} />
        ) : (
          <div style={{ display: 'grid', placeItems: 'center', minWidth: 220, minHeight: 160 }}>
            <span className="spinner" />
          </div>
        )}
        <div
          className="muted center"
          style={{ marginTop: 10, fontSize: '0.82rem', color: '#e2e8f0' }}
        >
          {photo.original_filename}
          {photo.width ? ` · ${photo.width}×${photo.height}` : ''}
        </div>
      </div>
    </div>
  );
}

interface EmailRow {
  id: string;
  email: string;
}

function PhotoEmailModal({ photo, onClose }: { photo: Photo; onClose: () => void }) {
  const [assigned, setAssigned] = useState<EmailRow[]>([]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<EmailRow[]>([]);

  const loadAssigned = async () => {
    const res = await api<{ emails: { email_id: string; email: string }[] }>(
      `/api/admin/photos/${photo.id}/emails`,
      { admin: true },
    );
    setAssigned(res.emails.map((e) => ({ id: e.email_id, email: e.email })));
  };

  useEffect(() => {
    loadAssigned();
  }, [photo.id]);

  const search = async (q: string) => {
    setQuery(q);
    const res = await api<{ emails: EmailRow[] }>(`/api/admin/emails?q=${encodeURIComponent(q)}`, {
      admin: true,
    });
    setResults(res.emails);
  };

  const add = async (emailId: string) => {
    await api(`/api/admin/photos/${photo.id}/emails`, { method: 'POST', admin: true, body: { emailId } });
    loadAssigned();
  };
  const remove = async (emailId: string) => {
    await api(`/api/admin/photos/${photo.id}/emails/${emailId}`, { method: 'DELETE', admin: true });
    loadAssigned();
  };

  return (
    <div className="lightbox" onClick={onClose}>
      <div
        className="card"
        style={{ maxWidth: 480, width: '100%' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="row between">
          <h2 style={{ marginBottom: 0 }}>E-Mail-Zuordnung (Klassenfoto)</h2>
          <button className="btn ghost small" onClick={onClose}>
            Schließen
          </button>
        </div>
        <p className="muted" style={{ fontSize: '0.82rem' }}>
          Weise dieses Klassenfoto allen berechtigten Familien direkt zu. Jede Familie sieht nur das
          ihr zugewiesene Foto.
        </p>
        <div className="mb">
          <strong>Zugewiesen ({assigned.length})</strong>
          <div style={{ marginTop: 6 }}>
            {assigned.length === 0 && <span className="muted">Noch niemand zugewiesen.</span>}
            {assigned.map((e) => (
              <span className="chip" key={e.id}>
                {e.email}
                <button onClick={() => remove(e.id)}>×</button>
              </span>
            ))}
          </div>
        </div>
        <div className="field">
          <label>E-Mail suchen &amp; hinzufügen</label>
          <input value={query} onChange={(e) => search(e.target.value)} placeholder="Suchen …" />
        </div>
        <div style={{ maxHeight: 200, overflow: 'auto' }}>
          {results
            .filter((r) => !assigned.some((a) => a.id === r.id))
            .map((r) => (
              <div key={r.id} className="row between" style={{ padding: '6px 0' }}>
                <span>{r.email}</span>
                <button className="btn secondary small" onClick={() => add(r.id)}>
                  + Hinzufügen
                </button>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
