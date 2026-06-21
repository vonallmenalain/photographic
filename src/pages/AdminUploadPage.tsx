import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { ArrowLeft, Upload } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../app/AuthProvider";
import { ErrorState, LoadingState } from "../components/PageState";
import { db } from "../firebase/config";
import { getJob, listChildren, listClasses } from "../services/firestore";
import { callFunction, type UploadUrlResponse } from "../services/functions";
import type { ChildRecord, Job, PhotoStatus, PhotoType, PhotoVisibility, SchoolClass } from "../types/domain";

type Variant = "thumb" | "preview" | "original";

export function AdminUploadPage() {
  const { jobId = "" } = useParams();
  const { user } = useAuth();
  const [job, setJob] = useState<Job | null>(null);
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [children, setChildren] = useState<ChildRecord[]>([]);
  const [classId, setClassId] = useState("");
  const [childIds, setChildIds] = useState<string[]>([]);
  const [photoType, setPhotoType] = useState<PhotoType>("portrait");
  const [visibility, setVisibility] = useState<PhotoVisibility>("child");
  const [status, setStatus] = useState<PhotoStatus>("review");
  const [files, setFiles] = useState<Record<Variant, File | null>>({
    thumb: null,
    preview: null,
    original: null
  });
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const classChildren = useMemo(
    () => children.filter((child) => child.classId === classId),
    [children, classId]
  );

  useEffect(() => {
    async function loadData() {
      setLoading(true);
      setError("");
      try {
        const [jobRecord, classRecords, childRecords] = await Promise.all([
          getJob(jobId),
          listClasses(jobId),
          listChildren(jobId)
        ]);
        setJob(jobRecord);
        setClasses(classRecords);
        setChildren(childRecords);
        setClassId(classRecords[0]?.id ?? "");
      } catch {
        setError("Upload-Daten konnten nicht geladen werden.");
      } finally {
        setLoading(false);
      }
    }

    void loadData();
  }, [jobId]);

  function setFile(variant: Variant, fileList: FileList | null) {
    setFiles((current) => ({ ...current, [variant]: fileList?.[0] ?? null }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user || !job) {
      return;
    }

    if (!classId) {
      setError("Bitte wähle eine Klasse.");
      return;
    }

    if (visibility === "child" && childIds.length === 0) {
      setError("Bitte wähle mindestens ein Pseudonym.");
      return;
    }

    if (!files.thumb || !files.preview || !files.original) {
      setError("Bitte wähle Thumbnail, Preview und Original.");
      return;
    }

    setUploading(true);
    setError("");
    setMessage("");

    try {
      const token = await user.getIdToken();
      const photoId = crypto.randomUUID();
      const keys: Partial<Record<Variant, string>> = {};

      for (const variant of ["thumb", "preview", "original"] as Variant[]) {
        const file = files[variant];
        if (!file) {
          continue;
        }

        const result = await callFunction<UploadUrlResponse>(
          "create-upload-url",
          {
            jobId,
            photoId,
            variant,
            contentType: file.type
          },
          token
        );

        const uploadResponse = await fetch(result.uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": file.type },
          body: file
        });

        if (!uploadResponse.ok) {
          throw new Error("Upload fehlgeschlagen.");
        }

        keys[variant] = result.key;
      }

      await setDoc(doc(db, "photos", photoId), {
        orgId: job.orgId,
        jobId,
        classId,
        childIds: visibility === "child" ? childIds : [],
        type: photoType,
        visibility,
        status,
        originalKey: keys.original,
        previewKey: keys.preview,
        thumbKey: keys.thumb,
        createdAt: serverTimestamp()
      });

      setFiles({ thumb: null, preview: null, original: null });
      setChildIds([]);
      setMessage("Foto gespeichert.");
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "Foto konnte nicht gespeichert werden.");
    } finally {
      setUploading(false);
    }
  }

  if (loading) {
    return <LoadingState label="Upload wird vorbereitet..." />;
  }

  return (
    <section className="page narrow">
      <Link className="text-link" to="/admin">
        <ArrowLeft size={16} aria-hidden="true" />
        Zurück
      </Link>
      <div className="panel">
        <p className="eyebrow">Admin Upload</p>
        <h1>{job?.title ?? "Job"}</h1>
        <form className="stack" onSubmit={handleSubmit}>
          <label>
            Klasse
            <select value={classId} onChange={(event) => setClassId(event.target.value)} required>
              <option value="">Auswählen</option>
              {classes.map((schoolClass) => (
                <option key={schoolClass.id} value={schoolClass.id}>
                  {schoolClass.name}
                </option>
              ))}
            </select>
          </label>
          <div className="split-fields">
            <label>
              Typ
              <select value={photoType} onChange={(event) => setPhotoType(event.target.value as PhotoType)}>
                <option value="portrait">Portrait</option>
                <option value="sibling">Geschwister</option>
                <option value="class">Klasse</option>
                <option value="event">Event</option>
              </select>
            </label>
            <label>
              Sichtbarkeit
              <select
                value={visibility}
                onChange={(event) => {
                  setVisibility(event.target.value as PhotoVisibility);
                  setChildIds([]);
                }}
              >
                <option value="child">Kind</option>
                <option value="class">Klasse</option>
                <option value="job">Job</option>
              </select>
            </label>
          </div>
          <label>
            Status
            <select value={status} onChange={(event) => setStatus(event.target.value as PhotoStatus)}>
              <option value="hidden">Versteckt</option>
              <option value="review">Review</option>
              <option value="published">Veröffentlicht</option>
            </select>
          </label>
          {visibility === "child" ? (
            <label>
              Pseudonyme
              <select
                multiple
                value={childIds}
                onChange={(event) =>
                  setChildIds(Array.from(event.currentTarget.selectedOptions).map((option) => option.value))
                }
              >
                {classChildren.map((child) => (
                  <option key={child.id} value={child.id}>
                    {child.pseudonym}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <div className="file-grid">
            <label>
              Thumbnail
              <input type="file" accept="image/*" onChange={(event) => setFile("thumb", event.target.files)} />
            </label>
            <label>
              Preview
              <input type="file" accept="image/*" onChange={(event) => setFile("preview", event.target.files)} />
            </label>
            <label>
              Original
              <input type="file" accept="image/*" onChange={(event) => setFile("original", event.target.files)} />
            </label>
          </div>
          <button className="button primary" type="submit" disabled={uploading}>
            <Upload size={18} aria-hidden="true" />
            Hochladen
          </button>
        </form>
        {message ? <p className="inline-note success">{message}</p> : null}
        {error ? <ErrorState message={error} /> : null}
      </div>
    </section>
  );
}
