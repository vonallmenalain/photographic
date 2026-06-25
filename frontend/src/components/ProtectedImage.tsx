import { imageUrl } from '../api/client';

interface Props {
  src: string;
  alt?: string;
  className?: string;
  /**
   * Original aspect ratio (width / height). When provided, the frame reserves
   * exactly that shape so portrait and landscape photos are shown in their true
   * orientation, uncropped and without any layout shift while loading.
   */
  ratio?: number;
}

/**
 * Renders a watermarked preview/thumbnail. The watermark is baked into the
 * image server-side; here we additionally discourage dragging, right-click
 * saving and selection. This never receives an original image.
 */
export function ProtectedImage({ src, alt = 'Foto-Vorschau', className, ratio }: Props) {
  const style = ratio && Number.isFinite(ratio) && ratio > 0 ? { aspectRatio: String(ratio) } : undefined;
  return (
    <div className={`photo-frame ${className ?? ''}`} style={style}>
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
