import { useEffect, useMemo, useRef, useState } from 'react';
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

const HERO_COUNT = 18; // how many photos ride the carousel

/** Deterministic-ish shuffle so the order feels fresh on every reload. */
function shuffle<T>(input: T[]): T[] {
  const arr = [...input];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Wrap any signed index into [0, total). */
function wrapIdx(i: number, total: number): number {
  return ((i % total) + total) % total;
}

/**
 * Galerie-Vorschau — an immersive, text-free "wow" showcase shown when the
 * gallery is opened. Modelled on the 3-D coverflow carousel from the DreamTeam
 * project: the photos sit on a horizontal, snap-scrolling track; the photo in
 * the centre stands full-height while its neighbours recede with a slight
 * rotation and fade. An ambient blur of the centred photo tints the stage. The
 * photos themselves are not clickable — a single glass button at the bottom
 * lets the parent switch over to the shopping gallery.
 */
export default function GalleryPreview() {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const viewportRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const ambientRef = useRef<HTMLDivElement>(null);
  const dotsRef = useRef<HTMLDivElement>(null);

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

  // Pick the carousel rotation once, shuffled for variety.
  const heroPhotos = useMemo(() => shuffle(photos).slice(0, HERO_COUNT), [photos]);

  // For an endless loop we render three back-to-back copies of the photos and
  // silently recentre onto the middle copy whenever scrolling drifts too far.
  const isInfinite = heroPhotos.length > 1;
  const copies = isInfinite ? 3 : 1;
  const real = heroPhotos.length;
  const offset = isInfinite ? real : 0; // first slide of the middle copy
  const slides = useMemo(() => {
    const out: Photo[] = [];
    for (let c = 0; c < copies; c++) out.push(...heroPhotos);
    return out;
  }, [heroPhotos, copies]);

  // ── Carousel engine (ported from the DreamTeam coverflow) ─────────────────
  useEffect(() => {
    const viewport = viewportRef.current;
    const track = trackRef.current;
    if (!viewport || !track || real === 0) return;

    const abort = new AbortController();
    const { signal } = abort;
    const totalSlides = slides.length;

    let slideEls = Array.from(track.querySelectorAll<HTMLElement>('.gp-slide'));
    const ambientEls = ambientRef.current
      ? Array.from(ambientRef.current.querySelectorAll<HTMLElement>('img'))
      : [];
    const dotEls = dotsRef.current
      ? Array.from(dotsRef.current.querySelectorAll<HTMLElement>('.gp-dot'))
      : [];

    let lastRealIdx = -1;

    // Size each slide so a landscape photo can fill (almost) the full stage
    // height, then centre the track so the middle slide sits in the viewport.
    function sizeSlides() {
      const h = viewport!.clientHeight;
      const slideH = Math.round(h * 0.9);
      const slideW = Math.round(Math.min(slideH * 1.4, viewport!.clientWidth * 0.84));
      track!.style.setProperty('--gp-slide-w', slideW + 'px');
      track!.style.setProperty('--gp-slide-h', slideH + 'px');
      return slideW;
    }

    function setPadding(slideW: number) {
      const P = Math.max(0, (viewport!.clientWidth - slideW) / 2);
      track!.style.paddingLeft = P + 'px';
      const existing = track!.querySelector('.gp-track-spacer');
      if (existing) existing.remove();
      const spacer = document.createElement('div');
      spacer.className = 'gp-track-spacer';
      spacer.style.cssText = `flex-shrink:0;width:${P}px;min-width:${P}px;pointer-events:none;`;
      track!.appendChild(spacer);
    }

    // Content-space centre of a slide (its midpoint within the track).
    function slideCenter(i: number) {
      const s = slideEls[i];
      return s.offsetLeft + s.offsetWidth / 2;
    }

    // Even spacing between consecutive slide centres (all slides equal width).
    function getUnit() {
      if (slideEls.length < 2) return 1;
      return slideCenter(1) - slideCenter(0) || 1;
    }

    // Fractional index of the slide whose centre sits at the viewport centre.
    function getCenterFloat() {
      if (slideEls.length === 0) return 0;
      const viewCenter = viewport!.scrollLeft + viewport!.clientWidth / 2;
      return (viewCenter - slideCenter(0)) / getUnit();
    }

    // Scroll so that slide `slideIdx` is exactly centred in the viewport.
    function scrollToSlideIdx(slideIdx: number, behavior: ScrollBehavior) {
      if (!slideEls.length) return;
      const idx = Math.max(0, Math.min(slideEls.length - 1, slideIdx));
      const left = slideCenter(idx) - viewport!.clientWidth / 2;
      if (behavior === 'auto') viewport!.scrollLeft = left;
      else viewport!.scrollTo({ left, behavior });
    }

    function scrollToReal(realIdx: number, behavior: ScrollBehavior) {
      scrollToSlideIdx(offset + wrapIdx(realIdx, real), behavior);
    }

    // 3-D coverflow: scale, rotate and fade each slide by its distance from
    // the current centre. The centred slide stands tall and straight.
    function apply3D() {
      const cf = getCenterFloat();
      const nearest = Math.max(0, Math.min(totalSlides - 1, Math.round(cf)));
      for (let i = 0; i < totalSlides; i++) {
        const slide = slideEls[i];
        if (!slide) continue;
        const dist = i - cf;
        const a = Math.abs(dist);
        const scale = Math.max(0.7, 1 - a * 0.14);
        const ry = Math.max(-22, Math.min(22, -dist * 15));
        const op = Math.max(0.32, 1 - a * 0.34);
        const isC = i === nearest;
        if (isC !== slide.classList.contains('is-center')) {
          slide.classList.toggle('is-center', isC);
        }
        slide.style.transform = `perspective(1200px) rotateY(${ry.toFixed(2)}deg) scale(${scale.toFixed(3)})`;
        slide.style.opacity = op.toFixed(3);
        slide.style.zIndex = String(Math.round(10 - a * 2));
      }
      updateCenter(nearest);
    }

    // Reflect the centred photo in the ambient backdrop and the dots.
    function updateCenter(nearestSlideIdx: number) {
      const realIdx = isInfinite
        ? wrapIdx(nearestSlideIdx - offset, real)
        : Math.max(0, Math.min(real - 1, nearestSlideIdx));
      if (realIdx === lastRealIdx) return;
      lastRealIdx = realIdx;
      ambientEls.forEach((el, i) => el.classList.toggle('on', i === realIdx));
      dotEls.forEach((dot, i) => {
        const active = i === realIdx;
        dot.classList.toggle('on', active);
        dot.setAttribute('aria-selected', active ? 'true' : 'false');
      });
    }

    function recenterIfNeeded() {
      if (!isInfinite) return;
      const cf = getCenterFloat();
      const jump = real * getUnit();
      if (cf >= offset + real) viewport!.scrollLeft -= jump;
      else if (cf < offset) viewport!.scrollLeft += jump;
    }

    // ── Scroll lifecycle (single passive listener + rAF) ──
    let rafPending = false;
    let scrollTimer: number | null = null;
    let isScrolling = false;
    const supportsScrollEnd = 'onscrollend' in window;

    function onScrollFrame() {
      rafPending = false;
      apply3D();
    }

    function onScrollEnd() {
      isScrolling = false;
      viewport!.classList.remove('is-scrolling');
      recenterIfNeeded();
      const nearest = Math.round(getCenterFloat());
      const target = slideCenter(nearest) - viewport!.clientWidth / 2;
      if (Math.abs(viewport!.scrollLeft - target) > 4) {
        viewport!.scrollTo({ left: target, behavior: 'smooth' });
      }
      requestAnimationFrame(apply3D);
    }

    viewport.addEventListener(
      'scroll',
      () => {
        if (!isScrolling) {
          isScrolling = true;
          viewport.classList.add('is-scrolling');
        }
        if (!rafPending) {
          rafPending = true;
          requestAnimationFrame(onScrollFrame);
        }
        if (!supportsScrollEnd) {
          if (scrollTimer) clearTimeout(scrollTimer);
          scrollTimer = window.setTimeout(onScrollEnd, 120);
        }
      },
      { passive: true, signal }
    );
    if (supportsScrollEnd) {
      viewport.addEventListener('scrollend', onScrollEnd, { passive: true, signal });
    }

    // ── Arrow, wheel & keyboard nav ──
    function step(dir: number) {
      const nearest = Math.round(getCenterFloat());
      const targetSlideIdx = isInfinite
        ? nearest + dir
        : Math.max(0, Math.min(totalSlides - 1, nearest + dir));
      scrollToSlideIdx(targetSlideIdx, 'smooth');
    }

    viewport.setAttribute('tabindex', '0');
    viewport.addEventListener(
      'keydown',
      (e) => {
        if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
        else if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
      },
      { signal }
    );
    viewport.addEventListener(
      'wheel',
      (e) => {
        if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return; // already horizontal
        e.preventDefault();
        step(e.deltaY > 0 ? 1 : -1);
      },
      { passive: false, signal }
    );

    // ── Dot taps ──
    dotEls.forEach((dot) => {
      const idx = Number(dot.dataset.dot);
      dot.addEventListener('click', () => scrollToReal(idx, 'smooth'), { signal });
    });

    // ── Initial layout & resize ──
    // `targetIdx` keeps the same slide centred across re-layouts. Re-sizing the
    // slides and the centring padding together (against the *current* viewport
    // width) keeps all geometry consistent.
    function layout(targetIdx: number) {
      const slideW = sizeSlides();
      setPadding(slideW);
      slideEls = Array.from(track!.querySelectorAll<HTMLElement>('.gp-slide'));
      scrollToSlideIdx(targetIdx, 'auto');
      apply3D();
    }

    // A ResizeObserver fires once the viewport has its real width — avoiding the
    // race where slides get sized against a stale measurement — and again on
    // any later width change, re-laying-out around the currently centred slide.
    let didInit = false;
    let lastW = 0;
    let resizeT: number | null = null;
    const ro = new ResizeObserver(() => {
      const w = viewport.clientWidth;
      if (w === 0) return;
      if (!didInit) {
        didInit = true;
        lastW = w;
        layout(offset);
        return;
      }
      if (Math.abs(w - lastW) < 1) return; // height-only change → ignore
      lastW = w;
      if (resizeT) clearTimeout(resizeT);
      resizeT = window.setTimeout(() => layout(Math.round(getCenterFloat())), 120);
    });
    ro.observe(viewport);

    // Provide nav buttons a way to drive the engine.
    const prev = document.getElementById('gp-prev');
    const next = document.getElementById('gp-next');
    prev?.addEventListener('click', () => step(-1), { signal });
    next?.addEventListener('click', () => step(1), { signal });

    return () => {
      ro.disconnect();
      if (resizeT) clearTimeout(resizeT);
      if (scrollTimer) clearTimeout(scrollTimer);
      abort.abort();
    };
  }, [slides, real, offset, isInfinite]);

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

  return (
    <div className="gp-stage">
      {/* Ambient backdrop: a blurred, enlarged copy of the centred photo tints
          the whole stage with whatever is in focus right now. */}
      <div className="gp-ambient" aria-hidden="true" ref={ambientRef}>
        {heroPhotos.map((p, i) => (
          <img
            key={p.id}
            src={imageUrl(p.previewUrl)}
            alt=""
            className={i === 0 ? 'on' : ''}
            draggable={false}
          />
        ))}
      </div>

      <div className="gp-vignette" aria-hidden="true" />

      {/* The coverflow track. Photos are decorative only — not clickable. */}
      <div className="gp-carousel">
        <button
          type="button"
          id="gp-prev"
          className="gp-arrow gp-arrow-prev"
          aria-label="Vorheriges Foto"
        >
          ‹
        </button>
        <div className="gp-outer">
          <div className="gp-viewport" ref={viewportRef} aria-label="Fotovorschau">
            <div className="gp-track" ref={trackRef}>
              {slides.map((p, i) => (
                <div className="gp-slide" key={`${p.id}-${i}`} aria-hidden="true">
                  <img
                    src={imageUrl(p.previewUrl)}
                    alt=""
                    draggable={false}
                    onContextMenu={(e) => e.preventDefault()}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
        <button
          type="button"
          id="gp-next"
          className="gp-arrow gp-arrow-next"
          aria-label="Nächstes Foto"
        >
          ›
        </button>
      </div>

      <div className="gp-foot">
        <div className="gp-dots" role="tablist" aria-label="Fotos" ref={dotsRef}>
          {heroPhotos.map((p, i) => (
            <button
              key={p.id}
              type="button"
              className={`gp-dot${i === 0 ? ' on' : ''}`}
              data-dot={i}
              aria-label={`Foto ${i + 1}`}
              aria-selected={i === 0}
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
