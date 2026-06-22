import { AlertTriangle, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { apiDelete, apiGet, apiPatch, apiPost } from "../api/photosApi";
import { useAuth } from "../auth/useAuth";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { EmptyState } from "../components/EmptyState";
import { ErrorState } from "../components/ErrorState";
import { Loading } from "../components/Loading";
import { AdminData, Photo, PhotoStatus, PhotoType, PhotoVisibility } from "../types/domain";
import { compactId, labelForPhotoType } from "../utils/format";

export function AdminPhotosPage() {
  const { getIdToken } = useAuth();
  const [data, setData] = useState<AdminData | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function refresh() {
    try {
      setData(await apiGet<AdminData>("/api/admin/data", getIdToken));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Fotos konnten nicht geladen werden.");
    }
  }

  async function cleanupMissingPhotos() {
    setError("");
    setMessage("");

    if (!window.confirm("Verwaiste Fotoeintraege ohne vollstaendige Dateien oder Stammdaten wirklich entfernen?")) {
      return;
    }

    try {
      const result = await apiPost<{ deletedCount: number }>(
        "/api/admin/maintenance/cleanup-missing-photos",
        {},
        getIdToken
      );
      setMessage(`${result.deletedCount} verwaiste Fotoeintraege entfernt.`);
      await refresh();
    } catch (cleanupError) {
      setError(
        cleanupError instanceof Error
          ? cleanupError.message
          : "Verwaiste Fotoeintraege konnten nicht bereinigt werden."
      );
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!data) {
    return error ? <ErrorState message={error} /> : <Loading label="Fotos werden geladen..." />;
  }

  return (
    <div className="grid">
      <div className="page-heading">
        <div>
          <h1>Fotos verwalten</h1>
          <p>Status, Typ, Sichtbarkeit und Zuordnungen einfach korrigieren.</p>
        </div>
        <Button type="button" variant="secondary" icon={<RefreshCw size={18} />} onClick={cleanupMissingPhotos}>
          Fehlende bereinigen
        </Button>
      </div>
      {error ? <ErrorState message={error} /> : null}
      {message ? <div className="success-box">{message}</div> : null}
      {data.photos.length === 0 ? (
        <EmptyState title="Noch keine Fotos">Lade zuerst Fotos im Adminbereich hoch.</EmptyState>
      ) : (
        <div className="table-list">
          {data.photos.map((photo) => (
            <PhotoEditor key={photo.id} photo={photo} data={data} onSaved={refresh} getIdToken={getIdToken} />
          ))}
        </div>
      )}
    </div>
  );
}

function PhotoEditor({
  photo,
  data,
  onSaved,
  getIdToken
}: {
  photo: Photo;
  data: AdminData;
  onSaved: () => Promise<void>;
  getIdToken: () => Promise<string>;
}) {
  const [draft, setDraft] = useState({
    status: photo.status,
    type: photo.type,
    visibility: photo.visibility,
    classId: photo.classId,
    childIds: photo.childIds.join(",")
  });
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const storageStatus = photo.storageStatus;
  const metadataStatus = photo.metadataStatus;
  const hasMissingFiles = storageStatus ? !storageStatus.complete : false;
  const hasMissingMetadata = metadataStatus ? !metadataStatus.complete : false;

  async function save() {
    setError("");
    setMessage("");
    try {
      await apiPatch(`/api/admin/photos/${photo.id}`, {
        ...draft,
        childIds: draft.childIds
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
      }, getIdToken);
      setMessage("Gespeichert.");
      await onSaved();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Foto konnte nicht gespeichert werden.");
    }
  }

  async function deletePhoto() {
    setError("");
    setMessage("");

    if (!window.confirm(`Foto "${photo.originalFilename || photo.id}" wirklich loeschen?`)) {
      return;
    }

    try {
      await apiDelete(`/api/admin/photos/${photo.id}`, getIdToken);
      setMessage("Foto geloescht.");
      await onSaved();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Foto konnte nicht geloescht werden.");
    }
  }

  return (
    <Card className="compact">
      <div className="card-header">
        <div>
          <h3>{photo.originalFilename || `Foto ${compactId(photo.id)}`}</h3>
          <p>{labelForPhotoType(photo.type)} · {compactId(photo.id)}</p>
        </div>
        <div className="status-pills">
          <span className="pill">{photo.status}</span>
          {hasMissingFiles ? (
            <span className="pill warning">
              <AlertTriangle size={14} /> Datei fehlt
            </span>
          ) : null}
          {hasMissingMetadata ? (
            <span className="pill warning">
              <AlertTriangle size={14} /> Stammdaten fehlen
            </span>
          ) : null}
        </div>
      </div>
      {storageStatus || metadataStatus ? (
        <div className="meta-grid compact-meta">
          {storageStatus ? (
            <>
              <span>Original: {storageStatus.original ? "vorhanden" : "fehlt"}</span>
              <span>Preview: {storageStatus.preview ? "vorhanden" : "fehlt"}</span>
              <span>Thumb: {storageStatus.thumb ? "vorhanden" : "fehlt"}</span>
            </>
          ) : null}
          {metadataStatus ? (
            <>
              <span>Schule: {metadataStatus.organization ? "vorhanden" : "fehlt"}</span>
              <span>Auftrag: {metadataStatus.job ? "vorhanden" : "fehlt"}</span>
              <span>Klasse: {metadataStatus.class ? "vorhanden" : "fehlt"}</span>
            </>
          ) : null}
        </div>
      ) : null}
      <div className="grid three">
        <div className="form-row">
          <label>Status</label>
          <select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as PhotoStatus })}>
            <option value="hidden">Versteckt</option>
            <option value="review">Pruefung</option>
            <option value="published">Veroeffentlicht</option>
          </select>
        </div>
        <div className="form-row">
          <label>Typ</label>
          <select value={draft.type} onChange={(event) => setDraft({ ...draft, type: event.target.value as PhotoType })}>
            <option value="portrait">Portrait</option>
            <option value="sibling">Geschwister</option>
            <option value="class">Klasse</option>
            <option value="classMirror">Klassenspiegel</option>
            <option value="event">Anlass</option>
          </select>
        </div>
        <div className="form-row">
          <label>Sichtbarkeit</label>
          <select value={draft.visibility} onChange={(event) => setDraft({ ...draft, visibility: event.target.value as PhotoVisibility })}>
            <option value="child">Kind</option>
            <option value="class">Klasse</option>
            <option value="job">Auftrag</option>
          </select>
        </div>
      </div>
      <div className="grid two">
        <div className="form-row">
          <label>Klasse</label>
          <select value={draft.classId} onChange={(event) => setDraft({ ...draft, classId: event.target.value })}>
            {data.classes.map((schoolClass) => (
              <option key={schoolClass.id} value={schoolClass.id}>
                {schoolClass.name}
              </option>
            ))}
          </select>
        </div>
        <div className="form-row">
          <label>Kind-IDs, kommagetrennt</label>
          <input value={draft.childIds} onChange={(event) => setDraft({ ...draft, childIds: event.target.value })} />
        </div>
      </div>
      <div className="actions">
        <Button type="button" onClick={save}>Speichern</Button>
        <Button type="button" variant="danger" icon={<Trash2 size={18} />} onClick={deletePhoto}>
          Foto loeschen
        </Button>
      </div>
      {message ? <div className="success-box">{message}</div> : null}
      {error ? <ErrorState message={error} /> : null}
    </Card>
  );
}
