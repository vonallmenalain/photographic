import { collection, getDocs, query, where } from "firebase/firestore";
import { Heart, ImageIcon, ShoppingBag, X } from "lucide-react";
import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { useParams } from "react-router-dom";
import { useAuth } from "../app/AuthProvider";
import { EmptyState, ErrorState, LoadingState } from "../components/PageState";
import { db } from "../firebase/config";
import { chunk, getJob, listGuardianAccess, listPhotosForAdmin, withId } from "../services/firestore";
import { callFunction, type PreviewUrlResponse } from "../services/functions";
import type { Job, PhotoRecord } from "../types/domain";

type UrlMap = Record<string, string>;

export function GalleryPage() {
  const { jobId = "" } = useParams();
  const { user, isAdmin } = useAuth();
  const [job, setJob] = useState<Job | null>(null);
  const [photos, setPhotos] = useState<PhotoRecord[]>([]);
  const [thumbUrls, setThumbUrls] = useState<UrlMap>({});
  const [previewUrl, setPreviewUrl] = useState("");
  const [selectedPhoto, setSelectedPhoto] = useState<PhotoRecord | null>(null);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [cart, setCart] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const cartTotal = useMemo(() => cart.size * 12, [cart]);

  useEffect(() => {
    if (!user || !jobId) {
      return;
    }

    const currentUser = user;

    async function loadGallery() {
      setLoading(true);
      setError("");

      try {
        const [jobRecord, photoRecords] = await Promise.all([
          getJob(jobId),
          isAdmin ? loadAdminPhotos(jobId) : loadGuardianPhotos(currentUser.uid, jobId)
        ]);

        setJob(jobRecord);
        setPhotos(photoRecords);

        const token = await currentUser.getIdToken();
        const urls = await Promise.all(
          photoRecords.map(async (photo) => {
            try {
              const result = await callFunction<PreviewUrlResponse>(
                "create-preview-url",
                { photoId: photo.id, variant: "thumb" },
                token
              );
              return [photo.id, result.url] as const;
            } catch {
              return [photo.id, ""] as const;
            }
          })
        );

        setThumbUrls(Object.fromEntries(urls.filter(([, url]) => Boolean(url))));
      } catch (currentError) {
        setError(currentError instanceof Error ? currentError.message : "Die Galerie konnte nicht geladen werden.");
      } finally {
        setLoading(false);
      }
    }

    void loadGallery();
  }, [isAdmin, jobId, user]);

  async function openPhoto(photo: PhotoRecord) {
    if (!user) {
      return;
    }

    setSelectedPhoto(photo);
    setPreviewUrl("");
    try {
      const token = await user.getIdToken();
      const result = await callFunction<PreviewUrlResponse>(
        "create-preview-url",
        { photoId: photo.id, variant: "preview" },
        token
      );
      setPreviewUrl(result.url);
    } catch {
      setPreviewUrl("");
    }
  }

  function toggleSet(setter: Dispatch<SetStateAction<Set<string>>>, photoId: string) {
    setter((current) => {
      const next = new Set(current);
      if (next.has(photoId)) {
        next.delete(photoId);
      } else {
        next.add(photoId);
      }
      return next;
    });
  }

  if (loading) {
    return <LoadingState label="Galerie wird geladen..." />;
  }

  if (error) {
    return <ErrorState message={error} />;
  }

  return (
    <section className="page">
      <div className="page-header">
        <div>
          <p className="eyebrow">Galerie</p>
          <h1>{job?.title ?? "Freigegebene Fotos"}</h1>
        </div>
        <div className="cart-pill">
          <ShoppingBag size={18} aria-hidden="true" />
          {cart.size} Artikel · CHF {cartTotal}
        </div>
      </div>

      {photos.length === 0 ? (
        <EmptyState title="Keine Fotos sichtbar" body="Für diesen Zugang sind noch keine veröffentlichten Fotos freigegeben." />
      ) : (
        <div className="photo-grid">
          {photos.map((photo) => (
            <article className="photo-card" key={photo.id}>
              <button className="photo-thumb" type="button" onClick={() => void openPhoto(photo)}>
                {thumbUrls[photo.id] ? (
                  <img src={thumbUrls[photo.id]} alt="" />
                ) : (
                  <span>
                    <ImageIcon size={26} aria-hidden="true" />
                  </span>
                )}
              </button>
              <div className="photo-card-actions">
                <button
                  className={favorites.has(photo.id) ? "round active" : "round"}
                  type="button"
                  title="Favorit"
                  aria-label="Favorit markieren"
                  onClick={() => toggleSet(setFavorites, photo.id)}
                >
                  <Heart size={18} aria-hidden="true" />
                </button>
                <button
                  className={cart.has(photo.id) ? "round active" : "round"}
                  type="button"
                  title="Warenkorb"
                  aria-label="In den Warenkorb"
                  onClick={() => toggleSet(setCart, photo.id)}
                >
                  <ShoppingBag size={18} aria-hidden="true" />
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {selectedPhoto ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="photo-modal">
            <button className="round close" type="button" onClick={() => setSelectedPhoto(null)} aria-label="Schließen">
              <X size={18} aria-hidden="true" />
            </button>
            {previewUrl ? (
              <img src={previewUrl} alt="" />
            ) : (
              <div className="preview-placeholder">
                <ImageIcon size={32} aria-hidden="true" />
              </div>
            )}
            <div className="button-row">
              <button
                className={favorites.has(selectedPhoto.id) ? "button secondary active" : "button secondary"}
                type="button"
                onClick={() => toggleSet(setFavorites, selectedPhoto.id)}
              >
                <Heart size={18} aria-hidden="true" />
                Favorit
              </button>
              <button
                className={cart.has(selectedPhoto.id) ? "button primary active" : "button primary"}
                type="button"
                onClick={() => toggleSet(setCart, selectedPhoto.id)}
              >
                <ShoppingBag size={18} aria-hidden="true" />
                Warenkorb
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

async function loadAdminPhotos(jobId: string): Promise<PhotoRecord[]> {
  const photos = await listPhotosForAdmin(jobId);
  return photos.filter((photo) => photo.status === "published");
}

async function loadGuardianPhotos(uid: string, jobId: string): Promise<PhotoRecord[]> {
  const access = await listGuardianAccess(uid, jobId);
  const childIds = [...new Set(access.map((item) => item.childId).filter(Boolean))] as string[];
  const classIds = [...new Set(access.map((item) => item.classId).filter(Boolean))] as string[];
  const hasJobAccess = access.some((item) => item.scope === "job");
  const photoMap = new Map<string, PhotoRecord>();

  for (const childGroup of chunk(childIds, 10)) {
    const snapshot = await getDocs(
      query(
        collection(db, "photos"),
        where("jobId", "==", jobId),
        where("status", "==", "published"),
        where("visibility", "==", "child"),
        where("childIds", "array-contains-any", childGroup)
      )
    );
    snapshot.docs.forEach((item) => photoMap.set(item.id, withId<PhotoRecord>(item)));
  }

  for (const classGroup of chunk(classIds, 10)) {
    const snapshot = await getDocs(
      query(
        collection(db, "photos"),
        where("jobId", "==", jobId),
        where("status", "==", "published"),
        where("visibility", "==", "class"),
        where("classId", "in", classGroup)
      )
    );
    snapshot.docs.forEach((item) => photoMap.set(item.id, withId<PhotoRecord>(item)));
  }

  if (hasJobAccess) {
    const snapshot = await getDocs(
      query(
        collection(db, "photos"),
        where("jobId", "==", jobId),
        where("status", "==", "published"),
        where("visibility", "==", "job")
      )
    );
    snapshot.docs.forEach((item) => photoMap.set(item.id, withId<PhotoRecord>(item)));
  }

  return [...photoMap.values()];
}
