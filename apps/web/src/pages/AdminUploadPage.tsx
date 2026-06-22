import { FormEvent, useEffect, useState } from "react";
import { UploadCloud } from "lucide-react";
import { apiGet, apiUploadFormData } from "../api/photosApi";
import { useAuth } from "../auth/useAuth";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { ErrorState } from "../components/ErrorState";
import { Loading } from "../components/Loading";
import { AdminData, PhotoType, PhotoVisibility } from "../types/domain";

const legacyIdPattern = /^[A-Za-z0-9_-]{6,80}$/;

export function AdminUploadPage() {
  const { getIdToken } = useAuth();
  const [data, setData] = useState<AdminData | null>(null);
  const [error, setError] = useState("");
  const [progressMessage, setProgressMessage] = useState("");
  const [form, setForm] = useState({
    orgId: "",
    jobId: "",
    classId: "",
    childIds: [] as string[],
    type: "portrait" as PhotoType,
    visibility: "child" as PhotoVisibility,
    file: null as File | null
  });

  useEffect(() => {
    void apiGet<AdminData>("/api/admin/data", getIdToken).then(setData).catch((loadError: Error) => setError(loadError.message));
  }, [getIdToken]);

  const availableOrganizations = data?.organizations.filter((organization) => legacyIdPattern.test(organization.id)) ?? [];
  const availableJobs = data?.jobs.filter((job) => legacyIdPattern.test(job.id) && (!form.orgId || job.orgId === form.orgId)) ?? [];
  const availableClasses =
    data?.classes.filter(
      (schoolClass) =>
        legacyIdPattern.test(schoolClass.id) &&
        (!form.orgId || schoolClass.orgId === form.orgId) &&
        (!form.jobId || schoolClass.jobId === form.jobId)
    ) ?? [];
  const availableChildren =
    data?.children.filter(
      (child) =>
        legacyIdPattern.test(child.id) &&
        (!form.orgId || child.orgId === form.orgId) &&
        (!form.jobId || child.jobId === form.jobId) &&
        (!form.classId || child.classId === form.classId)
    ) ?? [];

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!form.file) {
      setError("Bitte waehle eine Bilddatei aus.");
      return;
    }

    if (!legacyIdPattern.test(form.orgId) || !legacyIdPattern.test(form.jobId) || !legacyIdPattern.test(form.classId)) {
      setError("Bitte waehle Stammdaten aus, die ueber die aktuelle Stammdaten-Erfassung oder den Excel-Import angelegt wurden.");
      return;
    }

    if (form.visibility === "child" && form.childIds.length === 0) {
      setError("Bitte waehle fuer ein Portrait mindestens ein Kind aus.");
      return;
    }

    if (!form.childIds.every((childId) => legacyIdPattern.test(childId))) {
      setError("Bitte waehle Kinder aus, die ueber die aktuelle Stammdaten-Erfassung oder den Excel-Import angelegt wurden.");
      return;
    }

    const body = new FormData();
    body.append("orgId", form.orgId);
    body.append("jobId", form.jobId);
    body.append("classId", form.classId);
    body.append("childIds", JSON.stringify(form.childIds));
    body.append("type", form.type);
    body.append("visibility", form.visibility);
    body.append("status", "published");
    body.append("file", form.file);

    setError("");
    setProgressMessage("Datei wird an das lokale Foto-Backend uebertragen...");
    try {
      window.setTimeout(() => setProgressMessage("Vorschau und Thumbnail werden erzeugt..."), 350);
      await apiUploadFormData("/api/admin/photos/upload", body, getIdToken);
      setProgressMessage("Metadaten werden gespeichert...");
      window.setTimeout(() => setProgressMessage("Foto gespeichert."), 250);
      setForm({ ...form, file: null });
    } catch (uploadError) {
      setProgressMessage("");
      setError(uploadError instanceof Error ? uploadError.message : "Das Foto konnte nicht gespeichert werden.");
    }
  }

  if (!data) {
    return error ? <ErrorState message={error} /> : <Loading label="Uploadformular wird geladen..." />;
  }

  return (
    <div className="grid">
      <div className="page-heading">
        <div>
          <h1>Fotos hochladen</h1>
          <p>Originale werden lokal gespeichert; Vorschau und Thumbnail entstehen serverseitig.</p>
        </div>
      </div>
      {error ? <ErrorState message={error} /> : null}
      {progressMessage ? <div className={progressMessage === "Foto gespeichert." ? "success-box" : "notice"}>{progressMessage}</div> : null}
      <Card>
        <form className="form" onSubmit={handleSubmit}>
          <Select
            label="Organisation"
            value={form.orgId}
            items={availableOrganizations}
            onChange={(orgId) => setForm({ ...form, orgId, jobId: "", classId: "", childIds: [] })}
          />
          <Select
            label="Auftrag"
            value={form.jobId}
            items={availableJobs}
            onChange={(jobId) => setForm({ ...form, jobId, classId: "", childIds: [] })}
          />
          <Select
            label="Klasse"
            value={form.classId}
            items={availableClasses}
            onChange={(classId) => setForm({ ...form, classId, childIds: [] })}
          />
          <div className="form-row">
            <label>Kinder oder Klassenzuordnung</label>
            <select
              multiple
              value={form.childIds}
              onChange={(event) =>
                setForm({
                  ...form,
                  childIds: Array.from(event.target.selectedOptions).map((option) => option.value)
                })
              }
            >
              {availableChildren.map((child) => (
                <option key={child.id} value={child.id}>
                  {child.displayName || child.pseudonym || child.id}
                </option>
              ))}
            </select>
          </div>
          <div className="grid two">
            <div className="form-row">
              <label>Typ</label>
              <select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value as PhotoType })}>
                <option value="portrait">Portrait</option>
                <option value="sibling">Geschwister</option>
                <option value="class">Klasse</option>
                <option value="classMirror">Klassenspiegel</option>
                <option value="event">Anlass</option>
              </select>
            </div>
            <div className="form-row">
              <label>Sichtbarkeit</label>
              <select value={form.visibility} onChange={(event) => setForm({ ...form, visibility: event.target.value as PhotoVisibility })}>
                <option value="child">Kind</option>
                <option value="class">Klasse</option>
                <option value="job">Auftrag</option>
              </select>
            </div>
          </div>
          <div className="form-row">
            <label>Bilddatei</label>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/tiff"
              required
              onChange={(event) => setForm({ ...form, file: event.target.files?.[0] ?? null })}
            />
          </div>
          <Button icon={<UploadCloud size={18} />}>Foto hochladen</Button>
        </form>
      </Card>
    </div>
  );
}

function Select({
  label,
  value,
  items,
  onChange
}: {
  label: string;
  value: string;
  items: Array<{ id: string; name?: string; title?: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <div className="form-row">
      <label>{label}</label>
      <select required value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Bitte waehlen</option>
        {items.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name || item.title || item.id}
          </option>
        ))}
      </select>
    </div>
  );
}
