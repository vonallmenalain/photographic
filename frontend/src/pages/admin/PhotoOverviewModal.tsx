import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../../api/client';
import { Alert, Modal, StatusBadge } from '../../components/common';
import { AdminThumb } from '../../components/AdminThumb';
import { AdminPhotoLightbox, type ManagedPhoto } from './PhotoManager';

interface OverviewPhoto {
  id: string;
  original_filename: string;
  status: string;
  is_class_photo: number;
  child_id: string | null;
}
interface OverviewChildEmail {
  id: string;
  email: string;
  name: string;
  status: string;
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
  childNames: string[];
  directPhotoCount: number;
}
interface PhotoOverview {
  event: { id: string; name: string; status: string };
  emails: OverviewEmail[];
  children: OverviewChild[];
  classPhotos: OverviewPhoto[];
  unassignedPhotos: OverviewPhoto[];
  counts: { photos: number; children: number; emails: number; unassigned: number };
}

/**
 * Read-only "Fotos"-Kontrollansicht eines Auftrags. Zeigt in einem grossen
 * Popup alle E-Mail-Adressen der Klasse sowie sämtliche Fotos – gruppiert nach
 * Kind plus Gruppen-/Klassenfotos und nicht zugeordnete Fotos. Dient dem Admin
 * als schnelle Kontrolle, ob alle Fotos korrekt zugewiesen sind. Ein Klick auf
 * eine Vorschau öffnet das Foto gross (Lightbox).
 */
export function PhotoOverviewModal({
  eventId,
  eventName,
  onClose,
}: {
  eventId: string;
  eventName: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<PhotoOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [zoom, setZoom] = useState<ManagedPhoto | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    api<PhotoOverview>(`/api/admin/events/${eventId}/photo-overview`, { admin: true })
      .then((res) => {
        if (active) setData(res);
      })
      .catch((err) => {
        if (active)
          setError(err instanceof ApiError ? err.message : 'Übersicht konnte nicht geladen werden.');
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [eventId]);

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
      visible_to_event: 0,
      original_filename: p.original_filename,
      status: p.status,
      width: null,
      height: null,
    });

  return (
    <Modal title={`Fotos – ${eventName}`} onClose={onClose} width={1040}>
      {loading ? (
        <p className="muted">Übersicht wird geladen …</p>
      ) : error ? (
        <Alert kind="error">{error}</Alert>
      ) : data ? (
        <div className="photo-overview">
          <p className="muted" style={{ marginTop: 0, fontSize: '0.85rem' }}>
            Kontrollansicht: {data.counts.photos} Foto(s), {data.counts.children} Kind(er),{' '}
            {data.counts.emails} E-Mail-Adresse(n)
            {data.counts.unassigned > 0
              ? ` · ${data.counts.unassigned} Foto(s) noch nicht zugeordnet`
              : ''}
            .
          </p>

          <div className="field" style={{ marginBottom: 16 }}>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Nach Kind, E-Mail-Adresse oder Dateiname filtern …"
              autoFocus
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
                    <div className="photo-overview-child-head">
                      <div className="photo-overview-child-info">
                        <strong>{c.name}</strong>
                        {c.emails.length === 0 ? (
                          <span className="muted photo-overview-child-noemail">
                            – keine E-Mail-Adresse zugeordnet
                          </span>
                        ) : (
                          c.emails.map((e) => (
                            <span key={e.id} className="photo-overview-child-email">
                              <span aria-hidden>–</span>
                              <span className="photo-overview-child-email-addr">{e.email}</span>
                              <StatusBadge status={e.status} />
                            </span>
                          ))
                        )}
                      </div>
                      <span className="muted" style={{ fontSize: '0.8rem' }}>
                        {c.photos.length} Foto(s)
                      </span>
                    </div>
                    {c.photos.length === 0 ? (
                      <p className="photo-overview-warn">⚠ Keine Fotos zugeordnet</p>
                    ) : (
                      <div className="photo-overview-thumbs">
                        {c.photos.map((p) => (
                          <PhotoTile key={p.id} photo={p} onZoom={() => openZoom(p)} />
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Gruppen-/Klassenfotos */}
          {!q && data.classPhotos.length > 0 && (
            <section className="photo-overview-section">
              <h3 className="photo-overview-h">
                Gruppen-/Klassenfotos ({data.classPhotos.length})
              </h3>
              <div className="photo-overview-thumbs">
                {data.classPhotos.map((p) => (
                  <PhotoTile key={p.id} photo={p} onZoom={() => openZoom(p)} />
                ))}
              </div>
            </section>
          )}

          {/* Nicht zugeordnete Fotos */}
          {!q && data.unassignedPhotos.length > 0 && (
            <section className="photo-overview-section">
              <h3 className="photo-overview-h" style={{ color: 'var(--danger)' }}>
                Noch nicht zugeordnet ({data.unassignedPhotos.length})
              </h3>
              <p className="muted" style={{ fontSize: '0.82rem', marginTop: 0 }}>
                Diese Fotos sind weder einem Kind zugeordnet noch als Gruppenfoto markiert.
              </p>
              <div className="photo-overview-thumbs">
                {data.unassignedPhotos.map((p) => (
                  <PhotoTile key={p.id} photo={p} onZoom={() => openZoom(p)} />
                ))}
              </div>
            </section>
          )}
        </div>
      ) : null}

      {zoom && <AdminPhotoLightbox photo={zoom} onClose={() => setZoom(null)} />}
    </Modal>
  );
}

function PhotoTile({ photo, onZoom }: { photo: OverviewPhoto; onZoom: () => void }) {
  return (
    <div className="photo-overview-tile">
      <AdminThumb photoId={photo.id} size={104} onClick={onZoom} />
      <div className="photo-overview-tile-name" title={photo.original_filename}>
        {photo.original_filename}
      </div>
    </div>
  );
}
