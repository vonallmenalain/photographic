import { GalleryPhoto } from "../types/domain";
import { labelForPhotoType } from "../utils/format";
import { Loading } from "./Loading";

export function PhotoGrid({
  photos,
  thumbnails,
  onOpen
}: {
  photos: GalleryPhoto[];
  thumbnails: Record<string, string>;
  onOpen: (photo: GalleryPhoto) => void;
}) {
  return (
    <div className="photo-grid">
      {photos.map((photo) => {
        const childNames = photo.childNames ?? [];

        return (
          <button
            className="photo-tile"
            key={photo.photoId}
            type="button"
            onClick={() => onOpen(photo)}
            aria-label={`${labelForPhotoType(photo.type)} öffnen`}
          >
            {thumbnails[photo.photoId] ? (
              <img src={thumbnails[photo.photoId]} alt="" />
            ) : (
              <Loading label="Bild..." />
            )}
            <span className="photo-tile-meta">
              {labelForPhotoType(photo.type)}
              {childNames.length > 0 ? <small>{childNames.join(", ")}</small> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}
