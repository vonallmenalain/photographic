import { imageUrl } from '../api/client';

interface Props {
  src: string;
  alt?: string;
  className?: string;
}

/**
 * Renders a watermarked preview/thumbnail. The watermark is baked into the
 * image server-side; here we additionally discourage dragging, right-click
 * saving and selection. This never receives an original image.
 */
export function ProtectedImage({ src, alt = 'Foto-Vorschau', className }: Props) {
  return (
    <div className={`photo-frame ${className ?? ''}`}>
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
