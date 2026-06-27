import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { api, imageUrl } from '../../api/client';

interface Photo {
  id: string;
  thumbUrl: string;
  previewUrl: string;
}
interface PhotoGroup {
  id: string;
  title: string;
  kind: 'order' | 'group';
  photos: Photo[];
}

const HERO_COUNT = 24; // how many photos fill the preview grid

/** Real modulo (always non-negative). */
function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

/** Fisher–Yates shuffle so the preview feels fresh on every reload. */
function shuffle<T>(input: T[]): T[] {
  const arr = [...input];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * A single masonry cell. Each photo fades in once it has decoded, so the grid
 * never "pops". This is a one-shot opacity transition (no continuous animation,
 * no 3-D transforms, no per-frame `filter` toggling), which is exactly why this
 * layout stays perfectly stable on mobile where the old coverflow flickered.
 */
function GalleryCell({
  photo,
  index,
  onOpen,
}: {
  photo: Photo;
  index: number;
  onOpen: (index: number) => void;
}) {
  const [loaded, setLoaded] = useState(false);
  return (
    <button
      type="button"
      className={`gp-cell${loaded ? ' is-loaded' : ''}`}
      onClick={() => onOpen(index)}
      aria-label={`Foto ${index + 1} ansehen`}
    >
      <img
        src={imageUrl(photo.thumbUrl)}
        alt=""
        loading="lazy"
        decoding="async"
        draggable={false}
        onContextMenu={(e) => e.preventDefault()}
        onLoad={() => setLoaded(true)}
        onError={() => setLoaded(true)}
      />
      <span className="gp-cell-overlay" aria-hidden="true" />
    </button>
  );
}

/**
 * Galerie-Vorschau — an immersive, Elfsight-style photo gallery shown when the
 * gallery is opened. The photos sit in a responsive masonry grid (CSS columns)
 * on a dark stage; tapping one opens a simple lightbox with prev/next.
 *
 * This intentionally avoids the previous 3-D coverflow carousel. That carousel
 * relied on `transform-style: preserve-3d`, a continuous requestAnimationFrame
 * transform loop and toggling `filter: blur()` per frame — all of which make
 * tile-based mobile GPUs flip paint order and flicker. A plain grid with pure
 * CSS hover/entrance transitions has none of those failure modes, so it is
 * rock-solid on phones while still looking premium.
 */
export default function GalleryPreview() {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [lightbox, setLightbox] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await api<{ groups: PhotoGroup[] }>('/api/parent/photos');
        // The backend already de-duplicates group photos (so siblings sharing an
        // e-mail don't see the same group photo twice). Guard once more on the id
        // here so the preview never repeats a photo even if a future grouping
        // change reintroduces overlaps.
        const all: Photo[] = [];
        const seen = new Set<string>();
        for (const g of res.groups) {
          for (const p of g.photos) {
            if (seen.has(p.id)) continue;
            seen.add(p.id);
            all.push(p);
          }
        }
        setPhotos(all);
      } catch {
        setFailed(true);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Pick the preview selection once, shuffled for variety.
  const heroPhotos = useMemo(() => shuffle(photos).slice(0, HERO_COUNT), [photos]);

  // ── Lightbox navigation ───────────────────────────────────────────────────
  const close = useCallback(() => setLightbox(null), []);
  const step = useCallback(
    (dir: number) =>
      setLightbox((cur) => (cur === null ? cur : mod(cur + dir, heroPhotos.length))),
    [heroPhotos.length]
  );

  useEffect(() => {
    if (lightbox === null) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowLeft') step(-1);
      else if (e.key === 'ArrowRight') step(1);
    }
    window.addEventListener('keydown', onKey);
    // Prevent the page behind the lightbox from scrolling.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [lightbox, close, step]);

  // Touch swipe inside the lightbox.
  const touchX = useRef<number | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    touchX.current = e.touches[0]?.clientX ?? null;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchX.current === null) return;
    const dx = (e.changedTouches[0]?.clientX ?? touchX.current) - touchX.current;
    if (Math.abs(dx) > 40) step(dx < 0 ? 1 : -1);
    touchX.current = null;
  };

  // Wait for the photo list before revealing the stage.
  if (loading) {
    return (
      <div className="gp-stage is-loading">
        <span className="spinner light" />
      </div>
    );
  }

  // No photos (or the request failed) → send the parent straight to the gallery,
  // which already explains the empty state nicely.
  if (failed || photos.length === 0) {
    return <Navigate to="/galerie/fotos" replace />;
  }

  const current = lightbox === null ? null : heroPhotos[lightbox];

  return (
    <div className="gp-stage">
      <div className="gp-scroll">
        <div className="gp-grid">
          {heroPhotos.map((p, i) => (
            <GalleryCell key={`${p.id}-${i}`} photo={p} index={i} onOpen={setLightbox} />
          ))}
        </div>
        {/* Spacer so the last row clears the floating call-to-action bar. */}
        <div className="gp-grid-spacer" aria-hidden="true" />
      </div>

      <div className="gp-foot">
        <Link to="/galerie/fotos" className="preview-enter">
          Zur Auswahl
          <span aria-hidden="true">→</span>
        </Link>
      </div>

      {current && (
        <div
          className="gp-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label="Foto-Ansicht"
          onClick={close}
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
        >
          <button
            type="button"
            className="gp-lb-close"
            onClick={close}
            aria-label="Schliessen"
          >
            ×
          </button>
          <button
            type="button"
            className="gp-lb-nav gp-lb-prev"
            onClick={(e) => {
              e.stopPropagation();
              step(-1);
            }}
            aria-label="Vorheriges Foto"
          >
            ‹
          </button>
          <img
            key={current.id}
            className="gp-lb-img"
            src={imageUrl(current.previewUrl)}
            alt="Vergrösserte Vorschau des Fotos (mit Wasserzeichen)"
            draggable={false}
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.preventDefault()}
          />
          <button
            type="button"
            className="gp-lb-nav gp-lb-next"
            onClick={(e) => {
              e.stopPropagation();
              step(1);
            }}
            aria-label="Nächstes Foto"
          >
            ›
          </button>
          <div className="gp-lb-count" aria-hidden="true">
            {lightbox! + 1} / {heroPhotos.length}
          </div>
        </div>
      )}
    </div>
  );
}
