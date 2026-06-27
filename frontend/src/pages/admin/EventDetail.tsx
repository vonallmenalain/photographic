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
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);
  const [uploadMsg, setUploadMsg] = useState('');
  const [duplicateWarning, setDuplicateWarning] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const [emailModalPhoto, setEmailModalPhoto] = useState<Photo | null>(null);
  const [zoomPhoto, setZoomPhoto] = useState<Photo | null>(null);
  const [showAddChild, setShowAddChild] = useState(false);
  const [emailCount, setEmailCount] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const [photoFilter, setPhotoFilter] = useState<'all' | 'unassigned' | 'class' | 'duplicates'>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const load = async () => {
    try {
      const [res, emailRes] = await Promise.all([
        api<{ event: EventObj; children: Child[]; photos: Photo[] }>(`/api/admin/events/${id}`, {
          admin: true,
        }),
        api<{ emails: { id: string }[] }>(`/api/admin/emails?eventId=${id}`, { admin: true }).catch(
          () => ({ emails: [] as { id: string }[] }),
        ),
      ]);
      setEvent(res.event);
      setChildren(res.children);
      setPhotos(res.photos);
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

  // Photos are uploaded one at a time instead of in a single large request.
  // A big batch is processed synchronously on the server (each photo writes the
  // original plus three sharp variants) and, behind the Cloudflare tunnel, a
  // long-running request runs into the ~100s gateway timeout or body-size limit
  // and fails as a whole ("Upload fehlgeschlagen"). Sending one photo per
  // request keeps every request small and fast, lets us show real progress, and
  // a single retry absorbs transient network blips. Duplicate detection is
  // unchanged: each request sees the already-stored photos of this Auftrag.
  type UploadResult = {
    ok: boolean;
    matchedChildId?: string;
    duplicate?: boolean;
    filename: string;
  };

  const uploadOne = async (file: File): Promise<UploadResult[]> => {
    const fd = new FormData();
    fd.append('photos', file);
    const res = await api<{ results: UploadResult[] }>(`/api/admin/events/${id}/photos`, {
      method: 'POST',
      admin: true,
      formData: fd,
    });
    return res.results;
  };

  const upload = async () => {
    const files = fileRef.current?.files;
    if (!files || files.length === 0) return;
    await uploadFiles(Array.from(files));
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (uploading) return;
    const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('image/'));
    if (files.length > 0) void uploadFiles(files);
  };

  const uploadFiles = async (fileList: File[]) => {
    setUploading(true);
    setUploadMsg('');
    setError('');
    setDuplicateWarning('');
    setUploadProgress({ done: 0, total: fileList.length });

    const results: UploadResult[] = [];
    const failed: string[] = [];

    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      try {
        results.push(...(await uploadOne(file)));
      } catch {
        // One retry to ride out transient failures (flaky network, brief
        // gateway hiccup) before giving up on this single photo.
        try {
          results.push(...(await uploadOne(file)));
        } catch {
          failed.push(file.name);
          results.push({ ok: false, filename: file.name });
        }
      }
      setUploadProgress({ done: i + 1, total: fileList.length });
    }

    const ok = results.filter((r) => r.ok).length;
    const matched = results.filter((r) => r.matchedChildId).length;
    const dupes = results.filter((r) => r.duplicate);
    setUploadMsg(
      `${ok} von ${results.length} Fotos hochgeladen und verarbeitet.` +
        (matched > 0 ? ` ${matched} automatisch einem Kind zugeordnet (Dateiname).` : ''),
    );
    if (dupes.length > 0) {
      const names = dupes.map((d) => d.filename).join(', ');
      setDuplicateWarning(
        `${dupes.length} Foto(s) haben einen Dateinamen, der in diesem Auftrag bereits vorkommt: ${names}. ` +
          'Bitte prüfe, ob dasselbe Kind doppelt hochgeladen wurde – betroffene Fotos sind unten mit „Doppelter Dateiname“ markiert.',
      );
    }
    if (failed.length > 0) {
      const names = failed.join(', ');
      setError(
        `${failed.length} Foto(s) konnten nicht hochgeladen werden: ${names}. ` +
          'Bitte lade diese erneut hoch.',
      );
    }
    if (fileRef.current) fileRef.current.value = '';
    setUploadProgress(null);
    setUploading(false);
    load();
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
    // Reflect the change in local state immediately. Otherwise the controlled
    // checkbox only updates after the PATCH + reload round-trip completes, which
    // caused the visible "the box jumps to a slightly different place / a larger
    // field flashes" glitch while the row re-rendered with stale then fresh data.
    setPhotos((prev) =>
      prev.map((p) => {
        if (p.id !== photoId) return p;
        const next = { ...p };
        if ('is_class_photo' in data) next.is_class_photo = data.is_class_photo ? 1 : 0;
        if ('visible_to_event' in data) next.visible_to_event = data.visible_to_event ? 1 : 0;
        if ('child_id' in data) next.child_id = (data.child_id as string | null) ?? null;
        if ('status' in data) next.status = String(data.status);
        return next;
      }),
    );
    try {
      await api(`/api/admin/photos/${photoId}`, { method: 'PATCH', admin: true, body: data });
    } finally {
      load();
    }
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
      const res = await api<{
        assigned: number;
        ambiguous: number;
        unmatched: number;
        groupPhotos?: number;
      }>(`/api/admin/events/${id}/photos/auto-assign`, { method: 'POST', admin: true, body: {} });
      setUploadMsg(
        `${res.assigned} Foto(s) automatisch nach Dateiname zugeordnet.` +
          (res.groupPhotos && res.groupPhotos > 0
            ? ` ${res.groupPhotos} als Gruppen-/Klassenfoto markiert (für die ganze Klasse sichtbar).`
            : '') +
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

  const toggleSelect = (photoId: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(photoId)) next.delete(photoId);
      else next.add(photoId);
      return next;
    });

  // Applies the same change to every selected photo, then reloads once.
  const bulkPatch = async (data: Record<string, unknown>) => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setError('');
    try {
      await Promise.all(
        ids.map((pid) => api(`/api/admin/photos/${pid}`, { method: 'PATCH', admin: true, body: data })),
      );
      setSelected(new Set());
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Aktion fehlgeschlagen.');
    }
  };

  const bulkDelete = async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    if (!confirm(`${ids.length} ausgewählte Foto(s) wirklich löschen? Dies entfernt auch alle Varianten.`))
      return;
    setError('');
    try {
      await Promise.all(ids.map((pid) => api(`/api/admin/photos/${pid}`, { method: 'DELETE', admin: true })));
      setSelected(new Set());
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Löschen fehlgeschlagen.');
    }
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
  const unassignedCount = photos.filter((p) => !p.is_class_photo && !p.child_id).length;
  const classCount = photos.filter((p) => !!p.is_class_photo).length;

  const displayedPhotos = photos.filter((p) => {
    if (photoFilter === 'unassigned') return !p.is_class_photo && !p.child_id;
    if (photoFilter === 'class') return !!p.is_class_photo;
    if (photoFilter === 'duplicates') return isDuplicateFilename(p);
    return true;
  });

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
      done: photos.length > 0 && unassignedCount === 0 && duplicateCount === 0,
      detail:
        photos.length === 0
          ? 'Noch keine Fotos'
          : `${unassignedCount} unzugeordnet · ${duplicateCount} Duplikat(e)`,
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

      {/* Upload */}
      <div className="card mb" id="ev-upload">
        <h2>Fotos hochladen</h2>
        <p className="muted" style={{ fontSize: '0.85rem' }}>
          Lade nur die Originale hoch. Thumbnail und Wasserzeichen-Preview werden automatisch erzeugt.
          Enthält der Dateiname den Namen eines Kindes – auch nur den <strong>Vornamen</strong> samt
          Nummer wie „Elin 1“ –, wird das Foto automatisch zugeordnet. Passt ein Vorname auf mehrere
          Kinder, bleibt das Foto bewusst unzugeordnet.
        </p>
        <p className="muted" style={{ fontSize: '0.85rem' }}>
          Enthält der Dateiname <strong>„Gruppenfoto“</strong>, <strong>„Klassenfoto“</strong> oder{' '}
          <strong>„Klassenspiegel“</strong>, wird das Foto automatisch als Gruppen-/Klassenfoto
          markiert und für die ganze Klasse sichtbar gesetzt.
        </p>
        <p className="muted" style={{ fontSize: '0.85rem' }}>
          Die Fotos werden einzeln nacheinander hochgeladen und verarbeitet – so funktioniert auch
          das Hochladen vieler Fotos auf einmal zuverlässig.
        </p>
        {uploadMsg && <Alert kind="success">{uploadMsg}</Alert>}
        {duplicateWarning && <Alert kind="error">{duplicateWarning}</Alert>}
        <div
          className={`dropzone${dragOver ? ' is-dragover' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            if (!uploading) setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
        >
          <p className="muted" style={{ margin: '0 0 10px', fontSize: '0.85rem' }}>
            Fotos hierher ziehen &amp; ablegen – oder Dateien auswählen.
          </p>
          <div className="row">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              disabled={uploading}
              style={{ flex: 1 }}
            />
            <button className="btn" onClick={upload} disabled={uploading}>
              {uploading
                ? uploadProgress
                  ? `Wird hochgeladen … (${uploadProgress.done}/${uploadProgress.total})`
                  : 'Wird hochgeladen …'
                : 'Hochladen & verarbeiten'}
            </button>
          </div>
        </div>
        {uploadProgress && (
          <div style={{ marginTop: 12 }} aria-live="polite">
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={uploadProgress.total}
              aria-valuenow={uploadProgress.done}
              style={{
                height: 10,
                borderRadius: 999,
                background: 'var(--surface-2)',
                overflow: 'hidden',
                border: '1px solid var(--border)',
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: `${uploadProgress.total > 0 ? (uploadProgress.done / uploadProgress.total) * 100 : 0}%`,
                  background: 'var(--primary)',
                  transition: 'width 0.25s ease',
                }}
              />
            </div>
            <p className="muted" style={{ fontSize: '0.8rem', marginTop: 6 }}>
              {uploadProgress.done} von {uploadProgress.total} Fotos verarbeitet …
            </p>
          </div>
        )}
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
      <div className="card" id="ev-photos">
        <h2>Fotos &amp; Zuordnung</h2>
        {duplicateCount > 0 && (
          <Alert kind="error">
            {duplicateCount} Foto(s) teilen sich einen Dateinamen mit einem anderen Foto in diesem
            Auftrag und sind mit „Doppelter Dateiname“ markiert. Bitte prüfen, ob dasselbe Kind
            doppelt hochgeladen wurde.
          </Alert>
        )}

        {photos.length > 0 && (
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            <PhotoFilterButton active={photoFilter === 'all'} onClick={() => setPhotoFilter('all')}>
              Alle ({photos.length})
            </PhotoFilterButton>
            <PhotoFilterButton
              active={photoFilter === 'unassigned'}
              onClick={() => setPhotoFilter('unassigned')}
            >
              Unzugeordnet ({unassignedCount})
            </PhotoFilterButton>
            <PhotoFilterButton active={photoFilter === 'class'} onClick={() => setPhotoFilter('class')}>
              Klassenfotos ({classCount})
            </PhotoFilterButton>
            <PhotoFilterButton
              active={photoFilter === 'duplicates'}
              onClick={() => setPhotoFilter('duplicates')}
            >
              Duplikate ({duplicateCount})
            </PhotoFilterButton>
          </div>
        )}

        {selected.size > 0 && (
          <div className="bulk-bar">
            <strong>{selected.size} ausgewählt</strong>
            <select
              defaultValue=""
              onChange={(e) => {
                const v = e.target.value;
                e.target.value = '';
                if (v) bulkPatch({ child_id: v, status: 'assigned', is_class_photo: false, visible_to_event: false });
              }}
              style={{ width: 200 }}
              aria-label="Kind für Auswahl zuweisen"
            >
              <option value="">Kind zuweisen …</option>
              {children.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <button
              className="btn secondary small"
              onClick={() => bulkPatch({ is_class_photo: true, visible_to_event: true, child_id: null })}
            >
              Als Gruppenfoto markieren
            </button>
            <button className="btn ghost small" style={{ color: 'var(--danger)' }} onClick={bulkDelete}>
              Löschen
            </button>
            <button className="btn ghost small" onClick={() => setSelected(new Set())}>
              Auswahl aufheben
            </button>
          </div>
        )}

        {photos.length === 0 ? (
          <p className="muted">Noch keine Fotos in diesem Auftrag.</p>
        ) : displayedPhotos.length === 0 ? (
          <p className="muted">Keine Fotos für diesen Filter.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {displayedPhotos.map((p) => (
              <div
                key={p.id}
                className="admin-photo-row"
                style={{
                  display: 'flex',
                  gap: 16,
                  alignItems: 'center',
                  padding: 12,
                  border: '1px solid var(--border)',
                  borderRadius: 12,
                }}
              >
                <input
                  type="checkbox"
                  checked={selected.has(p.id)}
                  onChange={() => toggleSelect(p.id)}
                  style={{ width: 'auto', flex: 'none' }}
                  aria-label={`Foto ${p.original_filename} auswählen`}
                />
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

                  {/* Primary control. Kept on its own line so it never moves
                      when the class-photo options below appear or disappear. */}
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
                  </div>

                  {/* Secondary class-photo options live on a separate line so
                      toggling them never nudges the checkbox above. */}
                  {!!p.is_class_photo && (
                    <div className="row" style={{ marginTop: 8 }}>
                      <label
                        style={{ margin: 0 }}
                        title="Alle Familien dieses Auftrags/dieser Klasse sehen dieses Foto automatisch"
                      >
                        <input
                          type="checkbox"
                          checked={!!p.visible_to_event}
                          style={{ width: 'auto', marginRight: 6 }}
                          onChange={(e) => patchPhoto(p.id, { visible_to_event: e.target.checked })}
                        />
                        Für die ganze Klasse sichtbar
                      </label>

                      {!p.visible_to_event && (
                        <button
                          className="btn secondary small"
                          onClick={() => setEmailModalPhoto(p)}
                        >
                          E-Mail-Adressen zuweisen …
                        </button>
                      )}
                    </div>
                  )}
                  {!!p.is_class_photo && (
                    <p className="muted" style={{ fontSize: '0.78rem', marginTop: 6, marginBottom: 0 }}>
                      {p.visible_to_event
                        ? 'Sichtbar für alle Familien dieses Auftrags (alle E-Mail-Adressen mit einem Kind in dieser Klasse).'
                        : 'Nur für einzeln zugewiesene E-Mail-Adressen sichtbar.'}
                    </p>
                  )}
                </div>

                <div
                  className="admin-photo-actions"
                  style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
                >
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
        <PhotoEmailModal
          photo={emailModalPhoto}
          eventId={event.id}
          onClose={() => setEmailModalPhoto(null)}
        />
      )}

      {zoomPhoto && <AdminPhotoLightbox photo={zoomPhoto} onClose={() => setZoomPhoto(null)} />}
    </div>
  );
}

function PhotoFilterButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button type="button" className={`btn small ${active ? '' : 'ghost'}`} onClick={onClick}>
      {children}
    </button>
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

interface ClassEmail {
  id: string;
  email: string;
  name?: string;
  children?: { id: string; name: string; event_id: string }[];
}

/**
 * Assigns a group/class photo to individual e-mail addresses of the current
 * Auftrag/Klasse. Built on the shared `Modal` (same look & feel as
 * „E-Mail anlegen“): it lists every e-mail address of the class and lets the
 * photographer toggle each one with a single click. Toggles are optimistic so
 * nothing flickers or jumps.
 */
function PhotoEmailModal({
  photo,
  eventId,
  onClose,
}: {
  photo: Photo;
  eventId: string;
  onClose: () => void;
}) {
  const [classEmails, setClassEmails] = useState<ClassEmail[]>([]);
  const [assignedIds, setAssignedIds] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadAll = async () => {
    setLoading(true);
    setError('');
    try {
      const [assignedRes, classRes] = await Promise.all([
        api<{ emails: { email_id: string; email: string }[] }>(
          `/api/admin/photos/${photo.id}/emails`,
          { admin: true },
        ),
        api<{ emails: ClassEmail[] }>(
          `/api/admin/emails?eventId=${encodeURIComponent(eventId)}`,
          { admin: true },
        ),
      ]);
      setAssignedIds(new Set(assignedRes.emails.map((e) => e.email_id)));
      // Show every class address, plus any already-assigned address that does
      // not belong to the class (e.g. a family without an own child) so it can
      // still be reviewed and removed here.
      const classIds = new Set(classRes.emails.map((e) => e.id));
      const extra: ClassEmail[] = assignedRes.emails
        .filter((a) => !classIds.has(a.email_id))
        .map((a) => ({ id: a.email_id, email: a.email }));
      setClassEmails([...classRes.emails, ...extra]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'E-Mail-Adressen konnten nicht geladen werden.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photo.id, eventId]);

  const toggle = async (emailId: string) => {
    const wasAssigned = assignedIds.has(emailId);
    setAssignedIds((prev) => {
      const next = new Set(prev);
      if (wasAssigned) next.delete(emailId);
      else next.add(emailId);
      return next;
    });
    setError('');
    try {
      if (wasAssigned) {
        await api(`/api/admin/photos/${photo.id}/emails/${emailId}`, {
          method: 'DELETE',
          admin: true,
        });
      } else {
        await api(`/api/admin/photos/${photo.id}/emails`, {
          method: 'POST',
          admin: true,
          body: { emailId },
        });
      }
    } catch (err) {
      setAssignedIds((prev) => {
        const next = new Set(prev);
        if (wasAssigned) next.add(emailId);
        else next.delete(emailId);
        return next;
      });
      setError(err instanceof ApiError ? err.message : 'Aktion fehlgeschlagen.');
    }
  };

  const q = query.trim().toLowerCase();
  const filtered = q
    ? classEmails.filter(
        (e) =>
          e.email.toLowerCase().includes(q) ||
          (e.name ?? '').toLowerCase().includes(q) ||
          (e.children ?? []).some((c) => c.name.toLowerCase().includes(q)),
      )
    : classEmails;

  const childNamesFor = (e: ClassEmail) =>
    (e.children ?? []).filter((c) => c.event_id === eventId).map((c) => c.name);

  return (
    <Modal
      title="E-Mail-Adressen zuweisen"
      onClose={onClose}
      width={520}
      footer={
        <button type="button" className="btn" onClick={onClose}>
          Fertig
        </button>
      }
    >
      {error && <Alert kind="error">{error}</Alert>}
      <p className="muted" style={{ fontSize: '0.82rem', marginTop: 0 }}>
        Wähle die E-Mail-Adressen aus, die dieses Gruppen-/Klassenfoto sehen dürfen. Es werden alle
        Adressen dieser Klasse angezeigt – ein Klick genügt zum Zuweisen bzw. Entfernen.
      </p>

      <div className="field" style={{ marginBottom: 12 }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="E-Mail, Name oder Kind suchen …"
          autoFocus
        />
      </div>

      {loading ? (
        <p className="muted">Wird geladen …</p>
      ) : classEmails.length === 0 ? (
        <p className="muted">
          Für diese Klasse sind noch keine E-Mail-Adressen hinterlegt. Lege sie oben über „+ E-Mail
          anlegen“ an.
        </p>
      ) : filtered.length === 0 ? (
        <p className="muted">Keine Treffer für „{query}“.</p>
      ) : (
        <div className="email-pick-list">
          {filtered.map((e) => {
            const checked = assignedIds.has(e.id);
            const childNames = childNamesFor(e);
            return (
              <label key={e.id} className={`email-pick${checked ? ' selected' : ''}`}>
                <input type="checkbox" checked={checked} onChange={() => toggle(e.id)} />
                <span className="email-pick-info">
                  <span className="email-pick-email">{e.email}</span>
                  {(e.name || childNames.length > 0) && (
                    <span className="email-pick-meta">
                      {e.name ? e.name : null}
                      {e.name && childNames.length > 0 ? ' · ' : ''}
                      {childNames.length > 0 ? `Kind: ${childNames.join(', ')}` : ''}
                    </span>
                  )}
                </span>
              </label>
            );
          })}
        </div>
      )}

      <p className="muted" style={{ fontSize: '0.78rem', marginTop: 12, marginBottom: 0 }}>
        {assignedIds.size === 0
          ? 'Noch keine Adresse zugewiesen.'
          : `${assignedIds.size} Adresse(n) zugewiesen.`}
      </p>
    </Modal>
  );
}
