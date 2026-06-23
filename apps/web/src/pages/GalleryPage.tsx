import { Download, Filter, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { apiGet, fetchAuthorizedBlob } from "../api/photosApi";
import { useAuth } from "../auth/useAuth";
import { Button } from "../components/Button";
import { EmptyState } from "../components/EmptyState";
import { ErrorState } from "../components/ErrorState";
import { Loading } from "../components/Loading";
import { PhotoGrid } from "../components/PhotoGrid";
import {
  AdminData,
  CartItem,
  GalleryPhoto,
  GalleryResponse,
  GuardianLink,
  Photo
} from "../types/domain";
import { labelForPhotoType } from "../utils/format";

const ALL = "all";

type AdminGalleryFilters = {
  orgId: string;
  jobId: string;
  classId: string;
  emailLower: string;
};

const initialAdminFilters: AdminGalleryFilters = {
  orgId: ALL,
  jobId: ALL,
  classId: ALL,
  emailLower: ALL
};

function linkMatchesPhoto(link: GuardianLink, photo: GalleryPhoto, metadata?: Photo) {
  if (metadata?.childIds.includes(link.childId)) {
    return true;
  }

  if (photo.visibility === "class") {
    return photo.classId === link.classId;
  }

  if (photo.visibility === "job") {
    return photo.jobId === link.jobId && photo.classId === link.classId;
  }

  return photo.jobId === link.jobId && photo.classId === link.classId;
}

function uniqueGuardianEmails(links: GuardianLink[]) {
  const emails = new Map<string, string>();
  links
    .filter((link) => !link.revokedAt)
    .forEach((link) => {
      emails.set(link.emailLower, link.email || link.emailLower);
    });
  return [...emails.entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export function GalleryPage({ adminView = false }: { adminView?: boolean }) {
  const { getIdToken } = useAuth();
  const [gallery, setGallery] = useState<GalleryResponse | null>(null);
  const [adminData, setAdminData] = useState<AdminData | null>(null);
  const [filters, setFilters] = useState<AdminGalleryFilters>(initialAdminFilters);
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
    if (!adminView) {
      return undefined;
    }

    let active = true;
    apiGet<AdminData>("/api/admin/data", getIdToken)
      .then((result) => {
        if (active) setAdminData(result);
      })
      .catch((loadError: Error) => {
        if (active) setError(loadError.message);
      });

    return () => {
      active = false;
    };
  }, [adminView, getIdToken]);

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
          try {
            const blob = await fetchAuthorizedBlob(`/api/photos/${photo.photoId}/thumb`, getIdToken);
            const url = URL.createObjectURL(blob);
            createdUrls.push(url);
            nextThumbs[photo.photoId] = url;
          } catch (thumbError) {
            console.warn("[thumbnail-load-failed]", photo.photoId, thumbError);
          }
        })
      );
      if (active) {
        setThumbs(nextThumbs);
      } else {
        createdUrls.forEach((url) => URL.revokeObjectURL(url));
      }
    };

    void loadThumbs();

    return () => {
      active = false;
      createdUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [gallery, getIdToken]);

  const adminPhotoById = useMemo(() => {
    return new Map((adminData?.photos ?? []).map((photo) => [photo.id, photo]));
  }, [adminData]);

  const organizationNameById = useMemo(() => {
    return new Map((adminData?.organizations ?? []).map((organization) => [organization.id, organization.name]));
  }, [adminData]);

  const classNameById = useMemo(() => {
    return new Map((adminData?.classes ?? []).map((schoolClass) => [schoolClass.id, schoolClass.name]));
  }, [adminData]);

  const emailOptions = useMemo(() => uniqueGuardianEmails(adminData?.guardianLinks ?? []), [adminData]);

  const visiblePhotos = useMemo(() => {
    const photos = gallery?.photos ?? [];
    if (!adminView || !adminData) {
      return photos;
    }

    return photos.filter((photo) => {
      const metadata = adminPhotoById.get(photo.photoId);

      if (filters.orgId !== ALL && metadata?.orgId !== filters.orgId) {
        return false;
      }

      if (filters.jobId !== ALL && photo.jobId !== filters.jobId) {
        return false;
      }

      if (filters.classId !== ALL && photo.classId !== filters.classId) {
        return false;
      }

      if (filters.emailLower !== ALL) {
        const linksForEmail = adminData.guardianLinks.filter(
          (link) => link.emailLower === filters.emailLower && !link.revokedAt
        );
        return linksForEmail.some((link) => linkMatchesPhoto(link, photo, metadata));
      }

      return true;
    });
  }, [adminData, adminPhotoById, adminView, filters, gallery]);

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

  async function downloadOriginal(photo: GalleryPhoto) {
    setError("");
    try {
      const blob = await fetchAuthorizedBlob(`/api/photos/${photo.photoId}/original`, getIdToken);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `foto-${photo.photoId}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (downloadError) {
      setError(
        downloadError instanceof Error
          ? downloadError.message
          : "Das Original konnte nicht heruntergeladen werden."
      );
    }
  }

  if (!gallery || (adminView && !adminData && !error)) {
    return error ? <ErrorState message={error} /> : <Loading label="Galerie wird geladen..." />;
  }

  const selectedMetadata = selected && adminData ? adminPhotoById.get(selected.photoId) : undefined;
  const selectedChildNames = selected?.childNames ?? [];
  const selectedEmails =
    selected && adminData
      ? uniqueGuardianEmails(
          adminData.guardianLinks.filter((link) =>
            linkMatchesPhoto(link, selected, selectedMetadata)
          )
        )
      : [];

  return (
    <div className="grid">
      <div className="page-heading">
        <div>
          <h1>{adminView ? "Admin-Galerie" : "Meine Galerie"}</h1>
          <p>
            {adminView
              ? "Alle hochgeladenen Fotos pruefen und gezielt nach Schule, Klasse oder E-Mail filtern."
              : gallery.message || "Freigegebene Fotos werden geschuetzt geladen."}
          </p>
        </div>
        {adminView ? (
          <span className="pill">{visiblePhotos.length} von {gallery.photos.length} Fotos</span>
        ) : null}
      </div>

      {adminView && adminData ? (
        <div className="filter-panel">
          <div className="filter-panel-heading">
            <Filter size={18} />
            <strong>Filter</strong>
          </div>
          <div className="grid four">
            <div className="form-row">
              <label htmlFor="filter-org">Schule</label>
              <select
                id="filter-org"
                value={filters.orgId}
                onChange={(event) => setFilters({ ...filters, orgId: event.target.value })}
              >
                <option value={ALL}>Alle Schulen</option>
                {adminData.organizations.map((organization) => (
                  <option key={organization.id} value={organization.id}>
                    {organization.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-row">
              <label htmlFor="filter-job">Auftrag</label>
              <select
                id="filter-job"
                value={filters.jobId}
                onChange={(event) => setFilters({ ...filters, jobId: event.target.value })}
              >
                <option value={ALL}>Alle Auftraege</option>
                {adminData.jobs.map((job) => (
                  <option key={job.id} value={job.id}>
                    {job.title}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-row">
              <label htmlFor="filter-class">Klasse</label>
              <select
                id="filter-class"
                value={filters.classId}
                onChange={(event) => setFilters({ ...filters, classId: event.target.value })}
              >
                <option value={ALL}>Alle Klassen</option>
                {adminData.classes.map((schoolClass) => (
                  <option key={schoolClass.id} value={schoolClass.id}>
                    {schoolClass.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-row">
              <label htmlFor="filter-email">E-Mail-Adresse</label>
              <select
                id="filter-email"
                value={filters.emailLower}
                onChange={(event) => setFilters({ ...filters, emailLower: event.target.value })}
              >
                <option value={ALL}>Alle E-Mails</option>
                {emailOptions.map((email) => (
                  <option key={email.value} value={email.value}>
                    {email.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="actions compact-actions">
            <Button type="button" variant="secondary" onClick={() => setFilters(initialAdminFilters)}>
              Filter zuruecksetzen
            </Button>
          </div>
        </div>
      ) : null}

      {error ? <ErrorState message={error} /> : null}
      {message ? <div className="success-box">{message}</div> : null}
      {visiblePhotos.length === 0 ? (
        <EmptyState title="Noch keine Fotos">
          {adminView ? "Keine Fotos passen zu den aktuellen Filtern." : gallery.message || "Fuer diese E-Mail-Adresse wurden noch keine Fotos freigegeben."}
        </EmptyState>
      ) : (
        <PhotoGrid photos={visiblePhotos} thumbnails={thumbs} onOpen={openPreview} />
      )}

      {selected ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal">
            {previewUrl ? <img src={previewUrl} alt="" /> : <Loading label="Vorschau wird geladen..." />}
            <div className="modal-body">
              <div className="card-header">
                <div>
                  <h2>{labelForPhotoType(selected.type)}</h2>
                  {selectedChildNames.length > 0 ? (
                    <p>Kinder: {selectedChildNames.join(", ")}</p>
                  ) : null}
                  <p>Original-Download wird erst nach Zahlung aktiviert.</p>
                </div>
                <button className="icon-button" type="button" onClick={closePreview} title="Schliessen">
                  <X size={20} />
                </button>
              </div>
              {adminView && selectedMetadata ? (
                <div className="meta-grid">
                  <span>Schule: {organizationNameById.get(selectedMetadata.orgId) || selectedMetadata.orgId}</span>
                  <span>Klasse: {classNameById.get(selected.classId) || selected.classId}</span>
                  <span>Kinder: {selectedChildNames.join(", ") || "Keine direkte Kindzuordnung"}</span>
                  <span>E-Mail: {selectedEmails.map((email) => email.label).join(", ") || "Keine aktive Zuordnung"}</span>
                </div>
              ) : null}
              <div className="actions">
                <Button type="button" onClick={() => addToCart(selected)}>In den Warenkorb</Button>
                <Button
                  type="button"
                  variant="secondary"
                  icon={<Download size={18} />}
                  onClick={() => downloadOriginal(selected)}
                >
                  Original herunterladen
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
