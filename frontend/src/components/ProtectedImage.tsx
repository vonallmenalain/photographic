import { imageUrl } from '../api/client';

interface Props {
  src: string;
  alt?: string;
  className?: string;
  /**
   * Original aspect ratio (width / height). When provided (and not in `cover`
   * mode), the frame reserves exactly that shape so portrait and landscape
   * photos are shown in their true orientation, uncropped and without any
   * layout shift while loading.
   */
  ratio?: number;
  /**
   * Uniform-tile mode: every frame uses the same fixed shape and the photo
   * fills it edge to edge, centred (`object-fit: cover`). Used in the gallery
   * so all photos take up exactly the same amount of space and are shown from
   * their centre instead of only the top edge.
   */
  cover?: boolean;
}

/**
 * Renders a watermarked preview/thumbnail. The watermark is baked into the
 * image server-side; here we additionally discourage dragging, right-click
 * saving and selection. This never receives an original image.
 */
export function ProtectedImage({ src, alt = 'Foto-Vorschau', className, ratio, cover }: Props) {
  const style =
    !cover && ratio && Number.isFinite(ratio) && ratio > 0 ? { aspectRatio: String(ratio) } : undefined;
  return (
    <div className={`photo-frame ${cover ? 'cover' : ''} ${className ?? ''}`} style={style}>
      <img
        src={imageUrl(src)}
        alt={alt}
        draggable={false}
        onContextMenu={(e) => e.preventDefault()}
        loading="lazy"
      />
      {/* transparent overlay swallows long-press / drag interactions */}
      <div className="overlay" onContextMenu={(e) => e.preventDefault()} />
    </div>
  );
}
