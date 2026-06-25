import { useEffect, useRef, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api, ApiError, fetchAdminImage } from '../../api/client';
import { Alert, Modal, Spinner, StatusBadge } from '../../components/common';
import { AdminThumb } from '../../components/AdminThumb';
import EventEmails from './EventEmails';

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
  visible_to_event: number;
  original_filename: string;
  status: string;
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
  const [duplicateWarning, setDuplicateWarning] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const [emailModalPhoto, setEmailModalPhoto] = useState<Photo | null>(null);
  const [zoomPhoto, setZoomPhoto] = useState<Photo | null>(null);
  const [showAddChild, setShowAddChild] = useState(false);

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
      setError(err instanceof ApiError ? err.message : 'Auftrag konnte nicht geladen werden.');
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
      const res = await api<{
        results: { ok: boolean; matchedChildId?: string; duplicate?: boolean; filename: string }[];
      }>(`/api/admin/events/${id}/photos`, { method: 'POST', admin: true, formData: fd });
      const ok = res.results.filter((r) => r.ok).length;
      const matched = res.results.filter((r) => r.matchedChildId).length;
      const dupes = res.results.filter((r) => r.duplicate);
      setUploadMsg(
        `${ok} von ${res.results.length} Fotos hochgeladen und verarbeitet.` +
          (matched > 0 ? ` ${matched} automatisch einem Kind zugeordnet (Dateiname).` : ''),
      );
      if (dupes.length > 0) {
        const names = dupes.map((d) => d.filename).join(', ');
        setDuplicateWarning(
          `${dupes.length} Foto(s) haben einen Dateinamen, der in diesem Auftrag bereits vorkommt: ${names}. ` +
            'Bitte prüfe, ob dasselbe Kind doppelt hochgeladen wurde – betroffene Fotos sind unten mit „Doppelter Dateiname“ markiert.',
        );
      } else {
        setDuplicateWarning('');
      }
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

  const patchPhoto = async (photoId: string, data: Record<string, unknown>) => {
    await api(`/api/admin/photos/${photoId}`, { method: 'PATCH', admin: true, body: data });
    load();
  };

  const deletePhoto = async (photoId: string) => {
    if (!confirm('Foto wirklich löschen? Dies entfernt auch alle Varianten.')) return;
    await api(`/api/admin/photos/${photoId}`, { method: 'DELETE', admin: true });
    load();
  };

  const addChild = async (name: string) => {
    await api(`/api/admin/events/${id}/children`, { method: 'POST', admin: true, body: { name } });
    await load();
  };

  const deleteChild = async (childId: string) => {
    if (!confirm('Kind löschen? Zuordnungen gehen verloren.')) return;
    await api(`/api/admin/children/${childId}`, { method: 'DELETE', admin: true });
    load();
  };

  const autoAssign = async () => {
    setUploadMsg('');
    setError('');
    try {
      const res = await api<{ assigned: number; ambiguous: number; unmatched: number }>(
        `/api/admin/events/${id}/photos/auto-assign`,
        { method: 'POST', admin: true, body: {} },
      );
      setUploadMsg(
        `${res.assigned} Foto(s) automatisch nach Dateiname zugeordnet.` +
          (res.ambiguous > 0 ? ` ${res.ambiguous} mehrdeutig – bitte manuell prüfen.` : '') +
          (res.unmatched > 0
            ? ` ${res.unmatched} ohne Treffer – als Gruppen-/Klassenfoto markieren oder manuell zuordnen.`
            : ''),
      );
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Automatische Zuordnung fehlgeschlagen.');
    }
  };

  if (loading) return <Spinner />;
  if (!event) return <Alert kind="error">{error || 'Auftrag nicht gefunden.'}</Alert>;

  // Photos that share an identical file name within this Auftrag/Klasse. These
  // usually mean the same child was uploaded more than once.
  const filenameCounts = new Map<string, number>();
  for (const p of photos) {
    const key = (p.original_filename || '').trim().toLowerCase();
    if (key) filenameCounts.set(key, (filenameCounts.get(key) ?? 0) + 1);
  }
  const isDuplicateFilename = (p: Photo) => {
    const key = (p.original_filename || '').trim().toLowerCase();
    return !!key && (filenameCounts.get(key) ?? 0) > 1;
  };
  const duplicateCount = photos.filter(isDuplicateFilename).length;

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
      <EventEmails eventId={event.id} eventChildren={children} />

      {/* Upload */}
      <div className="card mb">
        <h2>Fotos hochladen</h2>
        <p className="muted" style={{ fontSize: '0.85rem' }}>
          Lade nur die Originale hoch. Thumbnail und Wasserzeichen-Preview werden automatisch erzeugt.
          Enthält der Dateiname den Namen eines Kindes – auch nur den <strong>Vornamen</strong> samt
          Nummer wie „Elin 1“ –, wird das Foto automatisch zugeordnet. Passt ein Vorname auf mehrere
          Kinder, bleibt das Foto bewusst unzugeordnet.
        </p>
        {uploadMsg && <Alert kind="success">{uploadMsg}</Alert>}
        {duplicateWarning && <Alert kind="error">{duplicateWarning}</Alert>}
        <div className="row">
          <input ref={fileRef} type="file" accept="image/*" multiple style={{ flex: 1 }} />
          <button className="btn" onClick={upload} disabled={uploading}>
            {uploading ? 'Wird hochgeladen …' : 'Hochladen & verarbeiten'}
          </button>
        </div>
        {children.length > 0 && photos.length > 0 && (
          <button
            className="btn secondary small"
            onClick={autoAssign}
            style={{ marginTop: 10 }}
            title="Vorhandene Fotos anhand des Dateinamens den Kindern zuordnen"
          >
            Vorhandene Fotos automatisch zuordnen (nach Dateiname)
          </button>
        )}
      </div>

      {/* Photos */}
      <div className="card">
        <h2>Fotos &amp; Zuordnung</h2>
        {duplicateCount > 0 && (
          <Alert kind="error">
            {duplicateCount} Foto(s) teilen sich einen Dateinamen mit einem anderen Foto in diesem
            Auftrag und sind mit „Doppelter Dateiname“ markiert. Bitte prüfen, ob dasselbe Kind
            doppelt hochgeladen wurde.
          </Alert>
        )}
        {photos.length === 0 ? (
          <p className="muted">Noch keine Fotos in diesem Auftrag.</p>
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
                    {p.is_class_photo ? <span className="badge class">Klassenfoto</span> : null}
                    {isDuplicateFilename(p) ? (
                      <span
                        className="badge red"
                        title="Ein weiteres Foto in diesem Auftrag hat denselben Dateinamen. Möglicherweise wurde dasselbe Kind doppelt hochgeladen."
                      >
                        Doppelter Dateiname
                      </span>
                    ) : null}
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
                            // Group/class photos default to "visible to the
                            // whole class" – the simplest path the photographer
                            // expects. Unchecking clears both flags.
                            child_id: e.target.checked ? null : p.child_id,
                            visible_to_event: e.target.checked,
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

                    {!!p.is_class_photo && (
                      <label style={{ margin: 0 }} title="Alle Familien dieses Auftrags/dieser Klasse sehen dieses Foto automatisch">
                        <input
                          type="checkbox"
                          checked={!!p.visible_to_event}
                          style={{ width: 'auto', marginRight: 6 }}
                          onChange={(e) =>
                            patchPhoto(p.id, { visible_to_event: e.target.checked })
                          }
                        />
                        Für die ganze Klasse sichtbar
                      </label>
                    )}

                    {!!p.is_class_photo && (
                      <button className="btn secondary small" onClick={() => setEmailModalPhoto(p)}>
                        Einzelne E-Mails …
                      </button>
                    )}
                  </div>
                  {!!p.is_class_photo && (
                    <p className="muted" style={{ fontSize: '0.78rem', marginTop: 6, marginBottom: 0 }}>
                      {p.visible_to_event
                        ? 'Sichtbar für alle Familien dieses Auftrags (alle E-Mail-Adressen mit einem Kind in dieser Klasse).'
                        : 'Nur für einzeln zugewiesene E-Mail-Adressen sichtbar.'}
                    </p>
                  )}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
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
          <h2 style={{ marginBottom: 0 }}>Einzelne E-Mail-Zuordnung (Klassenfoto)</h2>
          <button className="btn ghost small" onClick={onClose}>
            Schließen
          </button>
        </div>
        <p className="muted" style={{ fontSize: '0.82rem' }}>
          Nur nötig für Sonderfälle. Soll das Foto die <strong>ganze Klasse</strong> erreichen, nutze
          die Option „Für die ganze Klasse sichtbar“. Hier kannst du das Foto zusätzlich einzelnen
          E-Mail-Adressen zuweisen (z. B. Familien ohne eigenes Kind im Auftrag).
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
