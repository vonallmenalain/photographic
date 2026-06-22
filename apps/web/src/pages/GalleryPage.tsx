import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { apiGet, fetchAuthorizedBlob } from "../api/photosApi";
import { useAuth } from "../auth/useAuth";
import { Button } from "../components/Button";
import { EmptyState } from "../components/EmptyState";
import { ErrorState } from "../components/ErrorState";
import { Loading } from "../components/Loading";
import { PhotoGrid } from "../components/PhotoGrid";
import { CartItem, GalleryPhoto, GalleryResponse } from "../types/domain";
import { labelForPhotoType } from "../utils/format";

export function GalleryPage() {
  const { getIdToken } = useAuth();
  const [gallery, setGallery] = useState<GalleryResponse | null>(null);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<GalleryPhoto | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    apiGet<GalleryResponse>("/api/gallery", getIdToken)
      .then((result) => {
        if (active) setGallery(result);
      })
      .catch((loadError: Error) => {
        if (active) setError(loadError.message);
      });
    return () => {
      active = false;
    };
  }, [getIdToken]);

  useEffect(() => {
    if (!gallery?.photos.length) {
      return;
    }

    let active = true;
    const createdUrls: string[] = [];
    const loadThumbs = async () => {
      const nextThumbs: Record<string, string> = {};
      await Promise.all(
        gallery.photos.map(async (photo) => {
          const blob = await fetchAuthorizedBlob(`/api/photos/${photo.photoId}/thumb`, getIdToken);
          const url = URL.createObjectURL(blob);
          createdUrls.push(url);
          nextThumbs[photo.photoId] = url;
        })
      );
      if (active) {
        setThumbs(nextThumbs);
      } else {
        createdUrls.forEach((url) => URL.revokeObjectURL(url));
      }
    };

    loadThumbs().catch((thumbError: Error) => setError(thumbError.message));

    return () => {
      active = false;
      createdUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [gallery, getIdToken]);

  async function openPreview(photo: GalleryPhoto) {
    setSelected(photo);
    setPreviewUrl("");
    setError("");
    try {
      const blob = await fetchAuthorizedBlob(`/api/photos/${photo.photoId}/preview`, getIdToken);
      setPreviewUrl(URL.createObjectURL(blob));
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : "Die Vorschau konnte nicht geladen werden.");
    }
  }

  function closePreview() {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setPreviewUrl("");
    setSelected(null);
  }

  function addToCart(photo: GalleryPhoto) {
    const current = JSON.parse(window.localStorage.getItem("photographicCart") || "[]") as CartItem[];
    const existing = current.find((item) => item.photoId === photo.photoId);
    const next = existing
      ? current.map((item) => item.photoId === photo.photoId ? { ...item, quantity: item.quantity + 1 } : item)
      : [...current, { photoId: photo.photoId, jobId: photo.jobId, type: photo.type, quantity: 1 }];
    window.localStorage.setItem("photographicCart", JSON.stringify(next));
    setMessage("Foto wurde in den Warenkorb gelegt.");
  }

  if (!gallery) {
    return error ? <ErrorState message={error} /> : <Loading label="Galerie wird geladen..." />;
  }

  return (
    <div className="grid">
      <div className="page-heading">
        <div>
          <h1>Meine Galerie</h1>
          <p>{gallery.message || "Freigegebene Fotos werden geschuetzt geladen."}</p>
        </div>
      </div>
      {error ? <ErrorState message={error} /> : null}
      {message ? <div className="success-box">{message}</div> : null}
      {gallery.photos.length === 0 ? (
        <EmptyState title="Noch keine Fotos">{gallery.message || "Fuer diese E-Mail-Adresse wurden noch keine Fotos freigegeben."}</EmptyState>
      ) : (
        <PhotoGrid photos={gallery.photos} thumbnails={thumbs} onOpen={openPreview} />
      )}

      {selected ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal">
            {previewUrl ? <img src={previewUrl} alt="" /> : <Loading label="Vorschau wird geladen..." />}
            <div className="modal-body">
              <div className="card-header">
                <div>
                  <h2>{labelForPhotoType(selected.type)}</h2>
                  <p>Original-Download wird erst nach Zahlung aktiviert.</p>
                </div>
                <button className="icon-button" type="button" onClick={closePreview} title="Schliessen">
                  <X size={20} />
                </button>
              </div>
              <div className="actions">
                <Button type="button" onClick={() => addToCart(selected)}>In den Warenkorb</Button>
                <Button type="button" variant="secondary" disabled>
                  Digitaler Download spaeter verfuegbar
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
