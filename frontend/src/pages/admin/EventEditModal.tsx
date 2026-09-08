import { useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '../../api/client';
import {
  Alert,
  DeliveryProblemBadge,
  Modal,
  StatusBadge,
  type DeliveryProblemInfo,
} from '../../components/common';
import { AdminThumb } from '../../components/AdminThumb';
import { AdminPhotoLightbox, type ManagedPhoto } from './PhotoManager';

interface OverviewPhoto {
  id: string;
  original_filename: string;
  status: string;
  is_class_photo: number;
  visible_to_event: number;
  child_id: string | null;
  width: number | null;
  height: number | null;
  /** How often the photo appears in confirmed (paid) orders. */
  ordered_count: number;
  duplicate_filename: number;
}
interface OverviewChildEmail {
  id: string;
  email: string;
  name: string;
  status: string;
  /** Letzte E-Mail an diese Adresse kam nicht an (Resend-Webhook / SMTP). */
  delivery_problem: DeliveryProblemInfo | null;
}
interface OverviewChild {
  id: string;
  name: string;
  emails: OverviewChildEmail[];
  photos: OverviewPhoto[];
}
interface OverviewEmail {
  id: string;
  email: string;
  name: string;
  status: string;
  delivery_problem: DeliveryProblemInfo | null;
  childNames: string[];
  directPhotoCount: number;
}
interface PhotoOverview {
  event: { id: string; name: string; status: string };
  emails: OverviewEmail[];
  children: OverviewChild[];
  classPhotos: OverviewPhoto[];
  unassignedPhotos: OverviewPhoto[];
  counts: {
    photos: number;
    children: number;
    emails: number;
    unassigned: number;
    disabled: number;
  };
}

/** Where newly uploaded photos go: automatic (file name), a specific child or "group photo". */
type UploadTarget = 'auto' | 'group' | string;

interface UploadResult {
  ok: boolean;
  filename: string;
  matchedChildId?: string;
  duplicate?: boolean;
}

/**
 * "Auftrag bearbeiten" – editing view of an existing Auftrag, opened from the
 * Aufträge list. Shows every photo grouped by child (plus group/class photos
 * and unassigned photos) together with the parents' e-mail addresses, and lets
 * the photographer change the order afterwards without touching its status:
 *
 *  - add photos (assigned automatically by file name, to a chosen child, or as
 *    group photo – also directly per child via "+ Fotos"),
 *  - add a parent e-mail address directly to a child ("+ E-Mail-Adresse", e.g.
 *    the second parent), correct a misspelt address in place or remove the
 *    link between an address and the child,
 *  - re-assign a photo to another child / mark it as group photo,
 *  - deactivate a photo (hidden from parents, keeps files and orders) and
 *    reactivate it again,
 *  - delete a photo for good.
 *
 * Every change takes effect immediately – also for an already published
 * Auftrag. Photos that were already ordered are flagged and guarded with an
 * extra confirmation before they are deactivated or deleted.
 */
export function EventEditModal({
  eventId,
  eventName,
  onClose,
  onChanged,
}: {
  eventId: string;
  eventName: string;
  onClose: () => void;
  /** Called when the modal closes after at least one change (so lists can refresh). */
  onChanged?: () => void;
}) {
  const [data, setData] = useState<PhotoOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const [zoom, setZoom] = useState<ManagedPhoto | null>(null);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [uploadTarget, setUploadTarget] = useState<UploadTarget>('auto');
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(
    null,
  );
  const [dragOver, setDragOver] = useState(false);
  // "+ E-Mail-Adresse": Kind, für das gerade das Formular offen ist.
  const [emailFormChildId, setEmailFormChildId] = useState<string | null>(null);
  // Adresse, die gerade an Ort und Stelle korrigiert wird.
  const [emailEdit, setEmailEdit] = useState<{ emailId: string; value: string } | null>(null);
  const [emailBusy, setEmailBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const dirtyRef = useRef(false);

  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await api<PhotoOverview>(`/api/admin/events/${eventId}/photo-overview`, {
        admin: true,
      });
      setData(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Übersicht konnte nicht geladen werden.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setError('');
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  const close = () => {
    if (dirtyRef.current) onChanged?.();
    onClose();
  };

  const setBusy = (id: string, on: boolean) =>
    setBusyIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const patchPhoto = async (photo: OverviewPhoto, body: Record<string, unknown>) => {
    setError('');
    setNotice('');
    setBusy(photo.id, true);
    try {
      await api(`/api/admin/photos/${photo.id}`, { method: 'PATCH', admin: true, body });
      dirtyRef.current = true;
      await load(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Aktion fehlgeschlagen.');
    } finally {
      setBusy(photo.id, false);
    }
  };

  const toggleDisabled = (photo: OverviewPhoto) => {
    const disable = photo.status !== 'disabled';
    if (
      disable &&
      photo.ordered_count > 0 &&
      !confirm(
        `Dieses Foto wurde bereits ${photo.ordered_count}× bestellt. Trotzdem deaktivieren? ` +
          'Die Eltern sehen es dann nicht mehr in der Galerie; bereits gekaufte Downloads bleiben gültig.',
      )
    )
      return;
    void patchPhoto(photo, {
      status: disable ? 'disabled' : photo.child_id ? 'assigned' : 'processed',
    });
  };

  const reassign = (photo: OverviewPhoto, value: string) => {
    // A deactivated photo keeps being deactivated when its assignment changes.
    const keepDisabled = photo.status === 'disabled';
    let body: Record<string, unknown>;
    if (value === 'group') {
      body = {
        is_class_photo: true,
        visible_to_event: true,
        child_id: null,
        status: keepDisabled ? 'disabled' : 'processed',
      };
    } else if (value === '') {
      body = {
        child_id: null,
        is_class_photo: false,
        visible_to_event: false,
        status: keepDisabled ? 'disabled' : 'processed',
      };
    } else {
      body = {
        child_id: value,
        is_class_photo: false,
        visible_to_event: false,
        status: keepDisabled ? 'disabled' : 'assigned',
      };
    }
    void patchPhoto(photo, body);
  };

  const remove = async (photo: OverviewPhoto) => {
    const warn =
      photo.ordered_count > 0
        ? ` ACHTUNG: Dieses Foto wurde bereits ${photo.ordered_count}× bestellt – die bestellten Downloads und Abzüge dieses Fotos wären danach nicht mehr verfügbar.`
        : '';
    if (
      !confirm(
        `Foto „${photo.original_filename}“ wirklich löschen? Dies entfernt auch alle Varianten und kann nicht rückgängig gemacht werden.${warn}`,
      )
    )
      return;
    setError('');
    setNotice('');
    setBusy(photo.id, true);
    try {
      await api(`/api/admin/photos/${photo.id}`, { method: 'DELETE', admin: true });
      dirtyRef.current = true;
      await load(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Löschen fehlgeschlagen.');
    } finally {
      setBusy(photo.id, false);
    }
  };

  // --- E-Mail-Adressen je Kind -------------------------------------------------
  const addEmail = async (
    child: OverviewChild,
    email: string,
    name: string,
    sendInvitation: boolean,
  ) => {
    setError('');
    setNotice('');
    setEmailBusy(true);
    try {
      const res = await api<{
        id: string;
        email: string;
        created: boolean;
        linked: boolean;
        invited: boolean;
      }>(`/api/admin/children/${child.id}/emails`, {
        method: 'POST',
        admin: true,
        body: { email: email.trim(), name: name.trim(), sendInvitation },
      });
      dirtyRef.current = true;
      const what = res.created ? 'angelegt' : 'übernommen';
      const link = res.linked
        ? ` und mit „${child.name}“ verknüpft`
        : ` – sie war bereits mit „${child.name}“ verknüpft`;
      const invite = res.invited
        ? ' Die Einladung wurde an diese Adresse gesendet.'
        : sendInvitation
          ? ' Die Einladung wurde nicht gesendet (Auftrag nicht veröffentlicht oder Versand fehlgeschlagen).'
          : ' Die Einladung kannst du über „Einladung per E-Mail senden“ gezielt an diese Adresse schicken.';
      setNotice(`E-Mail-Adresse ${res.email} ${what}${link}.${invite}`);
      setEmailFormChildId(null);
      await load(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'E-Mail-Adresse konnte nicht hinzugefügt werden.');
    } finally {
      setEmailBusy(false);
    }
  };

  const saveEmailEdit = async () => {
    if (!emailEdit) return;
    const value = emailEdit.value.trim();
    const current = data?.children
      .flatMap((c) => c.emails)
      .find((e) => e.id === emailEdit.emailId);
    if (!value || (current && value.toLowerCase() === current.email.toLowerCase())) {
      setEmailEdit(null);
      return;
    }
    setError('');
    setNotice('');
    setEmailBusy(true);
    try {
      const res = await api<{ ok: boolean; addressChanged?: boolean }>(
        `/api/admin/emails/${emailEdit.emailId}`,
        { method: 'PATCH', admin: true, body: { email: value } },
      );
      dirtyRef.current = true;
      setNotice(
        `E-Mail-Adresse korrigiert zu ${value.toLowerCase()}.${
          res.addressChanged
            ? ' Die Bestätigung wurde zurückgesetzt – die Eltern müssen die neue Adresse einmal bestätigen; die Einladung kannst du gezielt an diese Adresse senden.'
            : ''
        }`,
      );
      setEmailEdit(null);
      await load(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'E-Mail-Adresse konnte nicht geändert werden.');
    } finally {
      setEmailBusy(false);
    }
  };

  const unlinkEmail = async (child: OverviewChild, email: OverviewChildEmail) => {
    if (
      !confirm(
        `Verknüpfung zwischen ${email.email} und „${child.name}“ entfernen? Die Adresse sieht die Fotos dieses Kindes dann nicht mehr. Die Adresse selbst bleibt bestehen.`,
      )
    )
      return;
    setError('');
    setNotice('');
    setEmailBusy(true);
    try {
      await api(`/api/admin/emails/${email.id}/children/${child.id}`, { method: 'DELETE', admin: true });
      dirtyRef.current = true;
      setNotice(`Verknüpfung zwischen ${email.email} und „${child.name}“ entfernt.`);
      await load(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Verknüpfung konnte nicht entfernt werden.');
    } finally {
      setEmailBusy(false);
    }
  };

  // Photos are uploaded one at a time (same reasoning as in PhotoManager: small,
  // fast requests that survive the tunnel's limits and allow real progress).
  const uploadOne = async (file: File, target: UploadTarget): Promise<UploadResult[]> => {
    const fd = new FormData();
    fd.append('photos', file);
    const params =
      target === 'group'
        ? '?asGroup=1'
        : target !== 'auto'
          ? `?childId=${encodeURIComponent(target)}`
          : '';
    const res = await api<{ results: UploadResult[] }>(
      `/api/admin/events/${eventId}/photos${params}`,
      { method: 'POST', admin: true, formData: fd },
    );
    return res.results;
  };

  const uploadFiles = async (fileList: File[], target: UploadTarget) => {
    const files = fileList.filter((f) => f.type.startsWith('image/') || /\.(jpe?g|png|webp|heic|tiff?)$/i.test(f.name));
    if (files.length === 0) return;
    setError('');
    setNotice('');
    setUploadProgress({ done: 0, total: files.length });
    const results: UploadResult[] = [];
    const failed: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        results.push(...(await uploadOne(file, target)));
      } catch {
        try {
          results.push(...(await uploadOne(file, target)));
        } catch {
          failed.push(file.name);
        }
      }
      setUploadProgress({ done: i + 1, total: files.length });
    }
    const ok = results.filter((r) => r.ok).length;
    const matched = results.filter((r) => r.matchedChildId).length;
    const dupes = results.filter((r) => r.duplicate).map((r) => r.filename);
    const targetLabel =
      target === 'group'
        ? ' als Gruppen-/Klassenfoto'
        : target !== 'auto'
          ? ` und „${data?.children.find((c) => c.id === target)?.name ?? 'Kind'}“ zugeordnet`
          : matched > 0
            ? `, ${matched} davon automatisch einem Kind zugeordnet (Dateiname)`
            : '';
    setNotice(
      `${ok} von ${files.length} Foto(s) hochgeladen${targetLabel}.` +
        (dupes.length > 0
          ? ` Doppelter Dateiname bei: ${dupes.join(', ')} – bitte prüfen, ob dasselbe Kind doppelt hochgeladen wurde.`
          : ''),
    );
    if (failed.length > 0) {
      setError(`${failed.length} Foto(s) konnten nicht hochgeladen werden: ${failed.join(', ')}.`);
    }
    if (ok > 0) dirtyRef.current = true;
    setUploadProgress(null);
    if (fileRef.current) fileRef.current.value = '';
    await load(true);
  };

  const q = query.trim().toLowerCase();
  const filteredChildren = useMemo(() => {
    if (!data) return [];
    if (!q) return data.children;
    return data.children.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.emails.some(
          (e) => e.email.toLowerCase().includes(q) || e.name.toLowerCase().includes(q),
        ) ||
        c.photos.some((p) => p.original_filename.toLowerCase().includes(q)),
    );
  }, [data, q]);

  const openZoom = (p: OverviewPhoto) =>
    setZoom({
      id: p.id,
      child_id: p.child_id,
      is_class_photo: p.is_class_photo,
      visible_to_event: p.visible_to_event,
      original_filename: p.original_filename,
      status: p.status,
      width: p.width,
      height: p.height,
    });

  const uploading = uploadProgress !== null;
  const children = data?.children ?? [];

  const renderTile = (p: OverviewPhoto) => (
    <EditTile
      key={p.id}
      photo={p}
      childList={children}
      busy={busyIds.has(p.id)}
      onZoom={() => openZoom(p)}
      onReassign={(value) => reassign(p, value)}
      onToggleDisabled={() => toggleDisabled(p)}
      onDelete={() => void remove(p)}
    />
  );

  return (
    <Modal title={`Auftrag bearbeiten – ${eventName}`} onClose={close} width={1080}>
      {loading ? (
        <p className="muted">Auftrag wird geladen …</p>
      ) : error && !data ? (
        <Alert kind="error">{error}</Alert>
      ) : data ? (
        <div className="photo-overview">
          <p className="muted event-edit-intro">
            {data.counts.photos} Foto(s), {data.counts.children} Kind(er),{' '}
            {data.counts.emails} E-Mail-Adresse(n)
            {data.counts.unassigned > 0 ? ` · ${data.counts.unassigned} noch nicht zugeordnet` : ''}
            {data.counts.disabled > 0 ? ` · ${data.counts.disabled} deaktiviert` : ''}. Änderungen
            wirken sofort – auch wenn der Auftrag bereits veröffentlicht ist.
          </p>

          {error && <Alert kind="error">{error}</Alert>}
          {notice && <Alert kind="success">{notice}</Alert>}

          {/* Fotos hinzufügen */}
          <section className="photo-overview-section event-edit-upload">
            <h3 className="photo-overview-h">Fotos hinzufügen</h3>
            <div className="event-edit-upload-target">
              <label htmlFor={`upload-target-${eventId}`}>Zuordnung der neuen Fotos</label>
              <select
                id={`upload-target-${eventId}`}
                value={uploadTarget}
                onChange={(e) => setUploadTarget(e.target.value)}
                disabled={uploading}
              >
                <option value="auto">Automatisch nach Dateiname</option>
                {children.map((c) => (
                  <option key={c.id} value={c.id}>
                    Kind: {c.name}
                  </option>
                ))}
                <option value="group">Gruppen-/Klassenfoto (für die ganze Klasse)</option>
              </select>
            </div>
            <div
              className={`dropzone${dragOver ? ' is-dragover' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                if (!uploading) setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                if (uploading) return;
                void uploadFiles(Array.from(e.dataTransfer.files), uploadTarget);
              }}
            >
              <p className="muted" style={{ margin: '0 0 10px', fontSize: '0.85rem' }}>
                Fotos hierher ziehen &amp; ablegen – oder Dateien auswählen. Mit „Automatisch nach
                Dateiname“ werden Fotos wie beim Erfassen dem Kind im Dateinamen zugeordnet
                (z. B. <code>Elin 3.jpg</code>).
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
                <button
                  className="btn"
                  type="button"
                  disabled={uploading}
                  onClick={() => {
                    const files = fileRef.current?.files;
                    if (files && files.length > 0) void uploadFiles(Array.from(files), uploadTarget);
                  }}
                >
                  {uploading
                    ? `Wird hochgeladen … (${uploadProgress?.done}/${uploadProgress?.total})`
                    : 'Hochladen & verarbeiten'}
                </button>
              </div>
            </div>
          </section>

          <div className="field" style={{ marginBottom: 16 }}>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Nach Kind, E-Mail-Adresse oder Dateiname filtern …"
            />
          </div>

          {/* Fotos je Kind */}
          <section className="photo-overview-section">
            <h3 className="photo-overview-h">Fotos je Kind</h3>
            {filteredChildren.length === 0 ? (
              <p className="muted" style={{ fontSize: '0.85rem' }}>
                {data.children.length === 0
                  ? 'Für diesen Auftrag sind noch keine Kinder erfasst.'
                  : 'Kein Kind passt zum Filter.'}
              </p>
            ) : (
              <div className="photo-overview-children">
                {filteredChildren.map((c) => (
                  <div key={c.id} className="photo-overview-child">
                    <div className="event-edit-child-head">
                      <div className="photo-overview-child-info">
                        <strong>{c.name}</strong>
                        {c.emails.length === 0 ? (
                          <span className="muted photo-overview-child-noemail">
                            – keine E-Mail-Adresse zugeordnet
                          </span>
                        ) : (
                          c.emails.map((e) =>
                            emailEdit?.emailId === e.id ? (
                              <span key={e.id} className="photo-overview-child-email event-edit-email-edit">
                                <span aria-hidden>–</span>
                                <input
                                  type="email"
                                  value={emailEdit.value}
                                  autoFocus
                                  disabled={emailBusy}
                                  aria-label={`E-Mail-Adresse ${e.email} korrigieren`}
                                  onChange={(ev) =>
                                    setEmailEdit({ emailId: e.id, value: ev.target.value })
                                  }
                                  onKeyDown={(ev) => {
                                    if (ev.key === 'Enter') {
                                      ev.preventDefault();
                                      void saveEmailEdit();
                                    }
                                    if (ev.key === 'Escape') setEmailEdit(null);
                                  }}
                                />
                                <button
                                  type="button"
                                  className="btn small"
                                  disabled={emailBusy}
                                  onClick={() => void saveEmailEdit()}
                                >
                                  Speichern
                                </button>
                                <button
                                  type="button"
                                  className="btn ghost small"
                                  disabled={emailBusy}
                                  onClick={() => setEmailEdit(null)}
                                >
                                  Abbrechen
                                </button>
                              </span>
                            ) : (
                              <span key={e.id} className="photo-overview-child-email">
                                <span aria-hidden>–</span>
                                <span className="photo-overview-child-email-addr">{e.email}</span>
                                <StatusBadge status={e.status} />
                                <DeliveryProblemBadge problem={e.delivery_problem} />
                                <span className="event-edit-email-actions">
                                  <button
                                    type="button"
                                    className="event-edit-icon-btn"
                                    title="E-Mail-Adresse korrigieren (z. B. Schreibfehler)"
                                    aria-label={`E-Mail-Adresse ${e.email} korrigieren`}
                                    disabled={emailBusy}
                                    onClick={() => setEmailEdit({ emailId: e.id, value: e.email })}
                                  >
                                    ✎
                                  </button>
                                  <button
                                    type="button"
                                    className="event-edit-icon-btn danger"
                                    title={`Verknüpfung mit „${c.name}“ entfernen`}
                                    aria-label={`Verknüpfung zwischen ${e.email} und ${c.name} entfernen`}
                                    disabled={emailBusy}
                                    onClick={() => void unlinkEmail(c, e)}
                                  >
                                    ×
                                  </button>
                                </span>
                              </span>
                            ),
                          )
                        )}
                      </div>
                      <div className="row" style={{ gap: 8 }}>
                        <span className="muted" style={{ fontSize: '0.8rem' }}>
                          {c.photos.length} Foto(s)
                        </span>
                        <button
                          type="button"
                          className="btn secondary small"
                          title={`Weitere E-Mail-Adresse (z. B. zweiter Elternteil) mit „${c.name}“ verknüpfen`}
                          disabled={emailBusy}
                          onClick={() => {
                            setEmailEdit(null);
                            setEmailFormChildId((cur) => (cur === c.id ? null : c.id));
                          }}
                        >
                          + E-Mail-Adresse
                        </button>
                        <UploadButton
                          label="+ Fotos"
                          title={`Fotos hochladen und direkt „${c.name}“ zuordnen`}
                          disabled={uploading}
                          onFiles={(files) => void uploadFiles(files, c.id)}
                        />
                      </div>
                    </div>
                    {emailFormChildId === c.id && (
                      <ChildEmailForm
                        childName={c.name}
                        published={data.event.status === 'published'}
                        busy={emailBusy}
                        onSubmit={(email, name, sendInvitation) =>
                          void addEmail(c, email, name, sendInvitation)
                        }
                        onCancel={() => setEmailFormChildId(null)}
                      />
                    )}
                    {c.photos.length === 0 ? (
                      <p className="photo-overview-warn">⚠ Keine Fotos zugeordnet</p>
                    ) : (
                      <div className="event-edit-tiles">{c.photos.map(renderTile)}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Gruppen-/Klassenfotos */}
          {!q && (
            <section className="photo-overview-section">
              <div className="event-edit-child-head">
                <h3 className="photo-overview-h" style={{ margin: 0, border: 'none', padding: 0 }}>
                  Gruppen-/Klassenfotos ({data.classPhotos.length})
                </h3>
                <UploadButton
                  label="+ Gruppenfoto"
                  title="Fotos hochladen und als Gruppen-/Klassenfoto für die ganze Klasse freischalten"
                  disabled={uploading}
                  onFiles={(files) => void uploadFiles(files, 'group')}
                />
              </div>
              {data.classPhotos.length === 0 ? (
                <p className="event-edit-empty">Keine Gruppen-/Klassenfotos.</p>
              ) : (
                <div className="event-edit-tiles">{data.classPhotos.map(renderTile)}</div>
              )}
            </section>
          )}

          {/* Nicht zugeordnete Fotos */}
          {!q && data.unassignedPhotos.length > 0 && (
            <section className="photo-overview-section">
              <h3 className="photo-overview-h" style={{ color: 'var(--danger)' }}>
                Noch nicht zugeordnet ({data.unassignedPhotos.length})
              </h3>
              <p className="muted" style={{ fontSize: '0.82rem', marginTop: 0 }}>
                Diese Fotos sind weder einem Kind zugeordnet noch als Gruppenfoto markiert – die
                Eltern sehen sie nicht. Zuordnung direkt in der Kachel wählen.
              </p>
              <div className="event-edit-tiles">{data.unassignedPhotos.map(renderTile)}</div>
            </section>
          )}
        </div>
      ) : null}

      {zoom && <AdminPhotoLightbox photo={zoom} onClose={() => setZoom(null)} />}
    </Modal>
  );
}

/**
 * Inline-Formular „+ E-Mail-Adresse“ unter dem Kind: Adresse (Pflicht), Name
 * (optional) und – bei veröffentlichtem Auftrag – die Option, die Einladung
 * sofort an diese Adresse zu schicken.
 */
function ChildEmailForm({
  childName,
  published,
  busy,
  onSubmit,
  onCancel,
}: {
  childName: string;
  published: boolean;
  busy: boolean;
  onSubmit: (email: string, name: string, sendInvitation: boolean) => void;
  onCancel: () => void;
}) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [sendInvitation, setSendInvitation] = useState(published);
  return (
    <form
      className="event-edit-email-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!email.trim()) return;
        onSubmit(email, name, published && sendInvitation);
      }}
    >
      <div className="row" style={{ alignItems: 'flex-end', flexWrap: 'wrap', gap: 10 }}>
        <div className="field" style={{ marginBottom: 0, minWidth: 240, flex: 1 }}>
          <label style={{ fontSize: '0.8rem' }}>E-Mail-Adresse für „{childName}“</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="zweiter-elternteil@beispiel.ch"
            autoFocus
            required
            disabled={busy}
          />
        </div>
        <div className="field" style={{ marginBottom: 0, minWidth: 180 }}>
          <label style={{ fontSize: '0.8rem' }}>Name (optional)</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="z. B. Familie Muster"
            disabled={busy}
          />
        </div>
        <button className="btn small" type="submit" disabled={busy || !email.trim()}>
          {busy ? 'Wird hinzugefügt …' : 'Hinzufügen'}
        </button>
        <button type="button" className="btn ghost small" onClick={onCancel} disabled={busy}>
          Abbrechen
        </button>
      </div>
      {published ? (
        <label
          style={{
            display: 'grid',
            gridTemplateColumns: 'auto minmax(0, 1fr)',
            alignItems: 'center',
            gap: 8,
            marginTop: 8,
            fontSize: '0.82rem',
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={sendInvitation}
            onChange={(e) => setSendInvitation(e.target.checked)}
            style={{ width: 'auto', margin: 0 }}
            disabled={busy}
          />
          <span>Einladung („Ihre Fotos sind bereit“) sofort an diese Adresse senden</span>
        </label>
      ) : (
        <p className="muted" style={{ fontSize: '0.8rem', marginTop: 8, marginBottom: 0 }}>
          Existiert die Adresse bereits (z. B. bei einem Geschwisterkind), wird sie übernommen und nur
          mit diesem Kind verknüpft. Die Einladung geht erst nach dem Veröffentlichen raus.
        </p>
      )}
    </form>
  );
}

/** Small button that opens a hidden file picker and hands the chosen files back. */
function UploadButton({
  label,
  title,
  disabled,
  onFiles,
}: {
  label: string;
  title?: string;
  disabled?: boolean;
  onFiles: (files: File[]) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => {
          const files = e.target.files ? Array.from(e.target.files) : [];
          e.target.value = '';
          if (files.length > 0) onFiles(files);
        }}
      />
      <button
        type="button"
        className="btn secondary small"
        title={title}
        disabled={disabled}
        onClick={() => ref.current?.click()}
      >
        {label}
      </button>
    </>
  );
}

/** One editable photo: preview, badges, assignment select and the deactivate/delete actions. */
function EditTile({
  photo,
  childList,
  busy,
  onZoom,
  onReassign,
  onToggleDisabled,
  onDelete,
}: {
  photo: OverviewPhoto;
  childList: OverviewChild[];
  busy: boolean;
  onZoom: () => void;
  onReassign: (value: string) => void;
  onToggleDisabled: () => void;
  onDelete: () => void;
}) {
  const disabled = photo.status === 'disabled';
  const assignment = photo.is_class_photo ? 'group' : (photo.child_id ?? '');
  return (
    <div
      className={`event-edit-tile${disabled ? ' is-disabled' : ''}${busy ? ' is-busy' : ''}`}
    >
      <div className="event-edit-thumb">
        <AdminThumb photoId={photo.id} size={150} onClick={onZoom} />
      </div>
      <div className="event-edit-tile-name" title={photo.original_filename}>
        {photo.original_filename}
      </div>
      <div className="event-edit-badges">
        {disabled && <span className="badge red">Deaktiviert</span>}
        {photo.ordered_count > 0 && (
          <span
            className="badge green"
            title={`In ${photo.ordered_count} bestätigten Bestellposition(en) enthalten`}
          >
            Bestellt ×{photo.ordered_count}
          </span>
        )}
        {photo.duplicate_filename === 1 && (
          <span
            className="badge amber"
            title="Ein weiteres Foto in diesem Auftrag hat denselben Dateinamen."
          >
            Doppelter Name
          </span>
        )}
      </div>
      <select
        value={assignment}
        onChange={(e) => onReassign(e.target.value)}
        disabled={busy}
        aria-label={`Zuordnung von ${photo.original_filename}`}
        title="Zuordnung ändern"
      >
        <option value="">— Nicht zugeordnet —</option>
        {childList.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
        <option value="group">Gruppen-/Klassenfoto</option>
      </select>
      <div className="event-edit-actions">
        <button
          type="button"
          className="btn secondary small"
          onClick={onToggleDisabled}
          disabled={busy}
          title={
            disabled
              ? 'Foto wieder für die Eltern sichtbar machen'
              : 'Foto für die Eltern ausblenden (Datei und Bestellungen bleiben erhalten)'
          }
        >
          {disabled ? 'Aktivieren' : 'Deaktivieren'}
        </button>
        <button
          type="button"
          className="btn ghost small"
          style={{ color: 'var(--danger)' }}
          onClick={onDelete}
          disabled={busy}
          title="Foto endgültig löschen"
        >
          Löschen
        </button>
      </div>
    </div>
  );
}
