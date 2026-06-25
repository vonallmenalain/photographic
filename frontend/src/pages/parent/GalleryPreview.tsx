import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { api, imageUrl } from '../../api/client';

interface Photo {
  id: string;
  thumbUrl: string;
  previewUrl: string;
}
interface EventGroup {
  id: string;
  photos: Photo[];
}

const HERO_COUNT = 14; // how many photos take turns centre stage
const MOSAIC_COUNT = 22; // background collage tiles
const INTERVAL_MS = 4200; // time each photo stays centre stage

/** Deterministic-ish shuffle so the order feels fresh on every reload. */
function shuffle<T>(input: T[]): T[] {
  const arr = [...input];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Galerie-Vorschau — an immersive, text-free "wow" showcase shown when the
 * gallery is opened/reloaded. A cinematic centre stage cycles through the
 * photos one after another (slow Ken-Burns zoom + cross-fade) while an ambient
 * blur of the current photo and a slowly drifting collage of all the other
 * photos frame it. The photos are the only content; a single glass button lets
 * the parent switch over to the shopping gallery.
 */
export default function GalleryPreview() {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    (async () => {
      try {
        const res = await api<{ events: EventGroup[] }>('/api/parent/photos');
        const all: Photo[] = [];
        for (const ev of res.events) for (const p of ev.photos) all.push(p);
        setPhotos(all);
      } catch {
        setFailed(true);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Pick the hero rotation and the collage tiles once, shuffled for variety.
  const heroPhotos = useMemo(() => shuffle(photos).slice(0, HERO_COUNT), [photos]);
  const mosaicPhotos = useMemo(() => {
    if (photos.length === 0) return [];
    const pool = shuffle(photos);
    const tiles: Photo[] = [];
    while (tiles.length < MOSAIC_COUNT) tiles.push(pool[tiles.length % pool.length]);
    return tiles;
  }, [photos]);

  useEffect(() => {
    if (heroPhotos.length < 2) return;
    const t = window.setInterval(() => {
      setIndex((i) => (i + 1) % heroPhotos.length);
    }, INTERVAL_MS);
    return () => window.clearInterval(t);
  }, [heroPhotos]);

  if (loading) {
    return (
      <div className="preview-stage is-loading">
        <span className="spinner light" />
      </div>
    );
  }

  // No photos (or the request failed) → send the parent straight to the gallery,
  // which already explains the empty state nicely.
  if (failed || photos.length === 0) {
    return <Navigate to="/galerie/fotos" replace />;
  }

  return (
    <div className="preview-stage">
      {/* Ambient backdrop: a blurred, enlarged copy of the current photo gives
          the whole stage the colour of whatever is centre stage right now. */}
      <div className="preview-ambient" aria-hidden="true">
        {heroPhotos.map((p, i) => (
          <img
            key={p.id}
            src={imageUrl(p.previewUrl)}
            alt=""
            className={i === index ? 'on' : ''}
            draggable={false}
          />
        ))}
      </div>

      {/* Drifting collage of all the other photos, dim and softly blurred. */}
      <div className="preview-mosaic" aria-hidden="true">
        <div className="preview-mosaic-track">
          {mosaicPhotos.concat(mosaicPhotos).map((p, i) => (
            <div className="preview-mosaic-tile" key={`${p.id}-${i}`}>
              <img src={imageUrl(p.thumbUrl)} alt="" draggable={false} />
            </div>
          ))}
        </div>
      </div>

      <div className="preview-vignette" aria-hidden="true" />

      {/* Centre stage — photos take turns, one after another. */}
      <div className="preview-hero">
        {heroPhotos.map((p, i) => (
          <figure
            key={p.id}
            className={`preview-hero-photo ${i === index ? 'is-active' : ''}`}
            aria-hidden={i === index ? undefined : true}
          >
            <img
              src={imageUrl(p.previewUrl)}
              alt=""
              draggable={false}
              onContextMenu={(e) => e.preventDefault()}
            />
          </figure>
        ))}
      </div>

      <div className="preview-foot">
        <div className="preview-dots" role="tablist" aria-label="Fotos">
          {heroPhotos.map((p, i) => (
            <button
              key={p.id}
              type="button"
              className={i === index ? 'on' : ''}
              aria-label={`Foto ${i + 1}`}
              aria-selected={i === index}
              onClick={() => setIndex(i)}
            />
          ))}
        </div>
        <Link to="/galerie/fotos" className="preview-enter">
          Zur Galerie
          <span aria-hidden="true">→</span>
        </Link>
      </div>
    </div>
  );
}
