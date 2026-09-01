import { imageUrl } from '../api/client';

/**
 * "So könnte es aussehen" – mockups of the sticker sheet and the magnet set,
 * built from the parent's OWN photo.
 *
 * Nothing is rendered server-side for this: the white sheet, the 4×4 grid of
 * cut-out stickers, the fanned stack of three magnets and all the shadows are
 * plain CSS (see index.css, "Produkt-Vorschauen"). The photo inside is the same
 * watermarked, reduced-quality thumbnail the gallery already shows, so the
 * mockup is protected exactly like every other preview – the "Vorschau"
 * watermark is baked into the image. The centre-cropped cut-out (3:4 for the
 * stickers, 1:1 for the magnets) only approximates the final product.
 */

function Photo({ src }: { src: string }) {
  return <img src={imageUrl(src)} alt="" draggable={false} loading="lazy" />;
}

/** A sheet with 16 rectangular 3×4 cm stickers of the same photo. */
export function StickerSheetMockup({ src, className }: { src: string; className?: string }) {
  return (
    <div
      className={`mock-sheet ${className ?? ''}`}
      role="img"
      aria-label="Vorschau des Sticker-Bogens mit Ihrem Foto"
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="mock-sheet-grid">
        {Array.from({ length: 16 }, (_, i) => (
          <div className="mock-sticker" key={i}>
            <Photo src={src} />
          </div>
        ))}
      </div>
      <div className="mock-overlay" aria-hidden="true" />
    </div>
  );
}

/** A fanned stack of three square 5×5 cm magnets of the same photo. */
export function MagnetSetMockup({ src, className }: { src: string; className?: string }) {
  return (
    <div
      className={`mock-magnets ${className ?? ''}`}
      role="img"
      aria-label="Vorschau des Magnete-Sets mit Ihrem Foto"
      onContextMenu={(e) => e.preventDefault()}
    >
      {[1, 2, 3].map((n) => (
        <div className={`mock-magnet m${n}`} key={n}>
          <Photo src={src} />
        </div>
      ))}
      <div className="mock-overlay" aria-hidden="true" />
    </div>
  );
}

/** Whether a product kind has a visual mockup. */
export function hasMockup(kind: string | undefined | null): kind is 'sticker' | 'magnet' {
  return kind === 'sticker' || kind === 'magnet';
}

/** Mockup for a product kind, or nothing for kinds without one (prints, downloads). */
export function ProductMockup({
  kind,
  src,
  className,
}: {
  kind: string | undefined | null;
  src: string;
  className?: string;
}) {
  if (kind === 'sticker') return <StickerSheetMockup src={src} className={className} />;
  if (kind === 'magnet') return <MagnetSetMockup src={src} className={className} />;
  return null;
}
