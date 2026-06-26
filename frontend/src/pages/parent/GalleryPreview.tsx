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

/** Real modulo (always non-negative). */
function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

/** Decode an image fully so it never has to load/decode mid-animation. */
function preload(src: string): Promise<void> {
  return new Promise((resolve) => {
    const img = new Image();
    const done = () => resolve();
    img.onload = () => {
      // `decode()` guarantees the bitmap is ready to paint — no first-paint jank.
      if (typeof img.decode === 'function') img.decode().then(done, done);
      else done();
    };
    img.onerror = done;
    img.src = src;
  });
}

/**
 * Galerie-Vorschau — an immersive, text-free "wow" showcase shown when the
 * gallery is opened. Modelled on the buttery-smooth 3-D coverflow carousel from
 * the DreamTeam project: the photos are *not* a native scroll list. Instead they
 * are absolutely-stacked cards driven by a single continuous requestAnimationFrame
 * momentum loop, each transformed with translate3d + rotateY in a shared
 * perspective. The centre photo stands forward while its neighbours tuck slightly
 * behind it (closer together, partly overlapped) and recede in depth with a touch
 * of rotation, fade and blur — a genuine 3-D carousel.
 *
 * Because every frame is pure GPU transform work (no layout, no scroll events,
 * no lazy image loads), the motion stays perfectly fluid. All hero images are
 * fully preloaded/decoded *before* the stage is revealed, so there is never any
 * stutter or pop-in once the carousel is on screen.
 */
export default function GalleryPreview() {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false); // all hero images decoded
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

  // ── Preload every hero image up-front ────────────────────────────────────
  // Highest priority for this view: no stutter, no pop-in. We decode all the
  // photos (and therefore warm the ambient backdrop, which reuses the same
  // URLs) before the stage appears. A safety timeout keeps a flaky image from
  // blocking the reveal forever.
  useEffect(() => {
    if (heroPhotos.length === 0) return;
    let cancelled = false;
    setReady(false);
    const urls = heroPhotos.map((p) => imageUrl(p.previewUrl));
    const safety = window.setTimeout(() => {
      if (!cancelled) setReady(true);
    }, 7000);
    Promise.all(urls.map(preload)).then(() => {
      if (!cancelled) {
        window.clearTimeout(safety);
        setReady(true);
      }
    });
    return () => {
      cancelled = true;
      window.clearTimeout(safety);
    };
  }, [heroPhotos]);

  // ── 3-D coverflow engine (transform + momentum, ported from DreamTeam) ────
  useEffect(() => {
    if (!ready) return;
    const viewport = viewportRef.current;
    const track = trackRef.current;
    if (!viewport || !track) return;

    const n = heroPhotos.length;
    if (n === 0) return;

    // On phones (and when the user prefers reduced motion) we drop the per-card
    // blur. Toggling a CSS `filter` between a blur value and `none` repeatedly
    // promotes/demotes the GPU layer of a card, which is the main cause of the
    // intermittent "flicker" seen on mobile during the animation. Keeping the
    // filter permanently off there means the layer stays stable → no flicker.
    // The desktop experience (where everything is already buttery) is untouched.
    const reduceFx =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      (window.matchMedia('(max-width: 760px)').matches ||
        window.matchMedia('(pointer: coarse)').matches ||
        window.matchMedia('(prefers-reduced-motion: reduce)').matches);

    const abort = new AbortController();
    const { signal } = abort;

    const cards = Array.from(track.querySelectorAll<HTMLElement>('.gp-slide'));
    const ambientEls = ambientRef.current
      ? Array.from(ambientRef.current.querySelectorAll<HTMLElement>('img'))
      : [];
    const dotEls = dotsRef.current
      ? Array.from(dotsRef.current.querySelectorAll<HTMLElement>('.gp-dot'))
      : [];

    // ── Geometry ───────────────────────────────────────────────────────────
    // `gap` is the horizontal distance between two neighbouring card centres.
    // Keeping it well below the card width is what makes the neighbours sit
    // close and tuck partly behind the centred photo (the "näher nebeneinander"
    // / slightly-overlapped look).
    let gap = 200;
    function sizeCards() {
      const vw = viewport!.clientWidth;
      const vh = viewport!.clientHeight;
      const cardH = Math.round(vh * 0.82);
      const cardW = Math.round(Math.min(cardH * 1.35, vw * 0.66));
      track!.style.setProperty('--gp-slide-w', cardW + 'px');
      track!.style.setProperty('--gp-slide-h', cardH + 'px');
      // Closer + overlapped: neighbour centres sit at ~52% of the card width.
      gap = Math.max(120, cardW * 0.52);
    }

    // ── Engine state ─────────────────────────────────────────────────────────
    const state = {
      pos: 0, // fractional index currently centred
      vel: 0,
      drag: false,
      snapTo: null as number | null, // target index (may be outside [0,n))
      lastX: 0,
      lastT: 0,
    };

    const CLAMP = 4; // how many neighbours fan out before being capped
    let lastActive = -1;

    function setActive(idx: number) {
      if (idx === lastActive) return;
      lastActive = idx;
      ambientEls.forEach((el, i) => el.classList.toggle('on', i === idx));
      dotEls.forEach((dot, i) => {
        const on = i === idx;
        dot.classList.toggle('on', on);
        dot.setAttribute('aria-selected', on ? 'true' : 'false');
      });
    }

    function render() {
      for (let i = 0; i < n; i++) {
        const card = cards[i];
        if (!card) continue;
        // Signed distance from the centred position, wrapped into [-n/2, n/2]
        // so the loop is seamless in both directions.
        let delta = i - state.pos;
        delta = mod(delta + n / 2, n) - n / 2;

        const abs = Math.abs(delta);
        const clamped = Math.min(abs, CLAMP);
        const dirClamped = Math.max(-CLAMP, Math.min(CLAMP, delta));

        const x = delta * gap;
        // Depth recedes monotonically behind the centre photo. The extra term
        // past CLAMP keeps even the far-back cards on their own distinct depth
        // planes (the old flat plateau left them all coplanar), and the small
        // direction-based bias guarantees the two cards straddling the centre
        // during a transition are never exactly coplanar either.
        //
        // Coplanar, overlapping slides are precisely what make tile-based mobile
        // GPUs flip their paint order every frame inside a `preserve-3d` context
        // — that is the rapid "flicker" where 2–3 images alternate when a new
        // photo moves to the front. A few pixels of guaranteed depth separation
        // is imperceptible but ends the z-fighting completely. Desktop already
        // looked smooth and is visually unchanged by these sub-perceptual nudges.
        const recede = clamped * 130 + Math.max(0, abs - CLAMP) * 6;
        const z = -recede + dirClamped * 10;
        const scale = 1 - clamped * 0.12;
        const rotY = -dirClamped * 11;
        const y = clamped * 7;
        const op = Math.max(0, 1 - clamped * 0.2);
        const blur = reduceFx ? 0 : Math.max(0, clamped - 1.5) * 1.1;

        card.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, ${z.toFixed(2)}px) rotateY(${rotY.toFixed(2)}deg) scale(${scale.toFixed(3)})`;
        card.style.opacity = op.toFixed(3);
        card.style.filter = blur > 0.05 ? `blur(${blur.toFixed(2)}px)` : 'none';
        // Strictly-monotonic stacking as a fallback for any engine that still
        // honours z-index inside a preserve-3d context.
        card.style.zIndex = String(10000 - Math.round(recede * 10));
        const isCenter = abs < 0.5;
        if (isCenter !== card.classList.contains('is-center')) {
          card.classList.toggle('is-center', isCenter);
        }
      }
      setActive(mod(Math.round(state.pos), n));
    }

    // ── Continuous momentum loop ─────────────────────────────────────────────
    let raf = 0;
    function tick() {
      if (state.drag) {
        // position is updated directly by the pointer handler
      } else if (state.snapTo !== null) {
        // Smoothly ease toward an explicit target (arrows / dots / keys).
        state.pos += (state.snapTo - state.pos) * 0.16;
        if (Math.abs(state.snapTo - state.pos) < 0.001) {
          state.pos = state.snapTo;
          state.snapTo = null;
        }
      } else {
        state.pos += state.vel;
        state.vel *= 0.92;
        if (Math.abs(state.vel) < 0.0006) {
          state.vel = 0;
          // gently settle on the nearest photo
          const target = Math.round(state.pos);
          state.pos += (target - state.pos) * 0.12;
          if (Math.abs(target - state.pos) < 0.001) state.pos = target;
        }
      }

      // Keep `pos` in a sane numeric range while idle (render uses mod anyway).
      if (!state.drag && state.snapTo === null) {
        if (state.pos >= n) state.pos -= n;
        else if (state.pos < 0) state.pos += n;
      }

      render();
      raf = requestAnimationFrame(tick);
    }

    // ── Interaction ──────────────────────────────────────────────────────────
    function goTo(index: number) {
      // Choose the nearest equivalent target so we never spin the long way.
      let delta = index - state.pos;
      delta = mod(delta + n / 2, n) - n / 2;
      state.vel = 0;
      state.snapTo = state.pos + delta;
    }
    function step(dir: number) {
      state.vel = 0;
      state.snapTo = Math.round(state.snapTo ?? state.pos) + dir;
    }

    function onPointerDown(e: PointerEvent) {
      viewport!.setPointerCapture(e.pointerId);
      state.drag = true;
      state.snapTo = null;
      state.vel = 0;
      state.lastX = e.clientX;
      state.lastT = performance.now();
    }
    function onPointerMove(e: PointerEvent) {
      if (!state.drag) return;
      const now = performance.now();
      const dx = e.clientX - state.lastX;
      const dt = Math.max(8, now - state.lastT);
      const units = dx / gap;
      state.pos -= units;
      // Blend velocity for a natural fling on release.
      state.vel = state.vel * 0.6 + (-units / dt) * 16 * 0.4;
      state.lastX = e.clientX;
      state.lastT = now;
    }
    function onPointerUp() {
      state.drag = false;
    }

    viewport.addEventListener('pointerdown', onPointerDown, { signal });
    viewport.addEventListener('pointermove', onPointerMove, { signal });
    viewport.addEventListener('pointerup', onPointerUp, { signal });
    viewport.addEventListener('pointercancel', onPointerUp, { signal });
    viewport.addEventListener('lostpointercapture', onPointerUp, { signal });

    viewport.addEventListener(
      'wheel',
      (e) => {
        const d = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
        e.preventDefault();
        state.snapTo = null;
        state.vel += d * 0.0015;
      },
      { passive: false, signal }
    );

    viewport.setAttribute('tabindex', '0');
    viewport.addEventListener(
      'keydown',
      (e) => {
        if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
        else if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
      },
      { signal }
    );

    dotEls.forEach((dot) => {
      const idx = Number(dot.dataset.dot);
      dot.addEventListener('click', () => goTo(idx), { signal });
    });
    document.getElementById('gp-prev')?.addEventListener('click', () => step(-1), { signal });
    document.getElementById('gp-next')?.addEventListener('click', () => step(1), { signal });

    // ── Layout + lifecycle ───────────────────────────────────────────────────
    let lastW = 0;
    const ro = new ResizeObserver(() => {
      const w = viewport.clientWidth;
      if (w === 0 || Math.abs(w - lastW) < 1) return;
      lastW = w;
      sizeCards();
      render();
    });
    ro.observe(viewport);

    sizeCards();
    render();
    // The carousel never autoplays — it only moves on user input — so a single
    // continuous loop is fine even with prefers-reduced-motion.
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      abort.abort();
    };
  }, [ready, heroPhotos]);

  // Loading: wait for both the photo list *and* full image decode before we
  // reveal the stage, so the first frame is already perfect.
  if (loading || (!ready && !failed && photos.length > 0)) {
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
              {heroPhotos.map((p, i) => (
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
