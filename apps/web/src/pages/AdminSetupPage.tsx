import { FormEvent, useEffect, useState } from "react";
import { apiGet, apiPost } from "../api/photosApi";
import { useAuth } from "../auth/useAuth";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { EmptyState } from "../components/EmptyState";
import { ErrorState } from "../components/ErrorState";
import { Loading } from "../components/Loading";
import { AdminData, OrganizationType } from "../types/domain";
import { formatDate } from "../utils/format";

const emptyData: AdminData = {
  organizations: [],
  jobs: [],
  classes: [],
  children: [],
  guardianLinks: [],
  photos: []
};

export function AdminSetupPage() {
  const { getIdToken } = useAuth();
  const [data, setData] = useState<AdminData>(emptyData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [suggestedUrl, setSuggestedUrl] = useState("");

  const [orgForm, setOrgForm] = useState({ name: "", type: "school" as OrganizationType });
  const [jobForm, setJobForm] = useState({ orgId: "", title: "", date: "", retentionUntil: "" });
  const [classForm, setClassForm] = useState({ orgId: "", jobId: "", name: "", teacherName: "" });
  const [childForm, setChildForm] = useState({
    orgId: "",
    jobId: "",
    classId: "",
    displayName: ""
  });
  const [linkForm, setLinkForm] = useState({
    email: "",
    orgId: "",
    jobId: "",
    classId: "",
    childId: ""
  });

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      const nextData = await apiGet<AdminData>("/api/admin/data", getIdToken);
      setData(nextData);
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "Stammdaten konnten nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit<T>(event: FormEvent, path: string, body: T, done: string) {
    event.preventDefault();
    setMessage("");
    setError("");
    try {
      const result = await apiPost<{ suggestedLoginUrl?: string }>(path, body, getIdToken);
      setMessage(done);
      if (result.suggestedLoginUrl) {
        setSuggestedUrl(result.suggestedLoginUrl);
      }
      await refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Die Aktion ist fehlgeschlagen.");
    }
  }

  if (loading) {
    return <Loading label="Stammdaten werden geladen..." />;
  }

  return (
    <div className="grid">
      <div className="page-heading">
        <div>
          <h1>Stammdaten erfassen</h1>
          <p>Alle Namen bleiben in Firestore. Dateipfade nutzen nur zufaellige IDs.</p>
        </div>
      </div>
      {error ? <ErrorState message={error} /> : null}
      {message ? <div className="success-box">{message}</div> : null}
      {suggestedUrl ? (
        <div className="notice">
          <strong>Vorgeschlagener Login-Link:</strong>
          <br />
          <code>{suggestedUrl}</code>
          <p>Der echte Klassen-Mailversand wird spaeter ergaenzt.</p>
        </div>
      ) : null}

      <div className="grid two">
        <Card>
          <h2>Organisation / Schule</h2>
          <form className="form" onSubmit={(event) => submit(event, "/api/admin/organizations", orgForm, "Organisation gespeichert.")}>
            <div className="form-row">
              <label>Name</label>
              <input required value={orgForm.name} onChange={(event) => setOrgForm({ ...orgForm, name: event.target.value })} />
            </div>
            <div className="form-row">
              <label>Typ</label>
              <select value={orgForm.type} onChange={(event) => setOrgForm({ ...orgForm, type: event.target.value as OrganizationType })}>
                <option value="school">Schule</option>
                <option value="kindergarten">Kindergarten</option>
              </select>
            </div>
            <Button>Organisation erstellen</Button>
          </form>
        </Card>

        <Card>
          <h2>Fotoauftrag</h2>
          <form className="form" onSubmit={(event) => submit(event, "/api/admin/jobs", { ...jobForm, retentionUntil: jobForm.retentionUntil || undefined }, "Fotoauftrag gespeichert.")}>
            <Select label="Organisation" value={jobForm.orgId} items={data.organizations} onChange={(orgId) => setJobForm({ ...jobForm, orgId })} />
            <div className="form-row">
              <label>Titel</label>
              <input required value={jobForm.title} onChange={(event) => setJobForm({ ...jobForm, title: event.target.value })} />
            </div>
            <div className="form-row">
              <label>Datum</label>
              <input required type="date" value={jobForm.date} onChange={(event) => setJobForm({ ...jobForm, date: event.target.value })} />
            </div>
            <div className="form-row">
              <label>Aufbewahrung bis</label>
              <input type="date" value={jobForm.retentionUntil} onChange={(event) => setJobForm({ ...jobForm, retentionUntil: event.target.value })} />
            </div>
            <Button>Auftrag erstellen</Button>
          </form>
        </Card>

        <Card>
          <h2>Klasse</h2>
          <form className="form" onSubmit={(event) => submit(event, "/api/admin/classes", classForm, "Klasse gespeichert.")}>
            <Select label="Organisation" value={classForm.orgId} items={data.organizations} onChange={(orgId) => setClassForm({ ...classForm, orgId })} />
            <Select label="Auftrag" value={classForm.jobId} items={data.jobs} onChange={(jobId) => setClassForm({ ...classForm, jobId })} />
            <div className="form-row">
              <label>Klassenname</label>
              <input required value={classForm.name} onChange={(event) => setClassForm({ ...classForm, name: event.target.value })} />
            </div>
            <div className="form-row">
              <label>Lehrperson optional</label>
              <input value={classForm.teacherName} onChange={(event) => setClassForm({ ...classForm, teacherName: event.target.value })} />
            </div>
            <Button>Klasse erstellen</Button>
          </form>
        </Card>

        <Card>
          <h2>Kind</h2>
          <form className="form" onSubmit={(event) => submit(event, "/api/admin/children", childForm, "Kind gespeichert.")}>
            <Select label="Organisation" value={childForm.orgId} items={data.organizations} onChange={(orgId) => setChildForm({ ...childForm, orgId })} />
            <Select label="Auftrag" value={childForm.jobId} items={data.jobs} onChange={(jobId) => setChildForm({ ...childForm, jobId })} />
            <Select label="Klasse" value={childForm.classId} items={data.classes} onChange={(classId) => setChildForm({ ...childForm, classId })} />
            <div className="form-row">
              <label>Name</label>
              <input required value={childForm.displayName} onChange={(event) => setChildForm({ ...childForm, displayName: event.target.value })} />
            </div>
            <Button>Kind erstellen</Button>
          </form>
        </Card>

        <Card>
          <h2>Elternzugriff verknuepfen</h2>
          <form className="form" onSubmit={(event) => submit(event, "/api/admin/guardian-links", linkForm, "Elternzugriff gespeichert.")}>
            <div className="form-row">
              <label>E-Mail</label>
              <input required type="email" value={linkForm.email} onChange={(event) => setLinkForm({ ...linkForm, email: event.target.value })} />
            </div>
            <Select label="Organisation" value={linkForm.orgId} items={data.organizations} onChange={(orgId) => setLinkForm({ ...linkForm, orgId })} />
            <Select label="Auftrag" value={linkForm.jobId} items={data.jobs} onChange={(jobId) => setLinkForm({ ...linkForm, jobId })} />
            <Select label="Klasse" value={linkForm.classId} items={data.classes} onChange={(classId) => setLinkForm({ ...linkForm, classId })} />
            <Select label="Kind" value={linkForm.childId} items={data.children.map((child) => ({ id: child.id, name: child.displayName || child.pseudonym || child.id }))} onChange={(childId) => setLinkForm({ ...linkForm, childId })} />
            <Button>Link erstellen</Button>
          </form>
        </Card>

        <Card>
          <h2>Uebersicht</h2>
          {data.organizations.length === 0 ? (
            <EmptyState title="Noch keine Stammdaten">Lege zuerst eine Organisation an.</EmptyState>
          ) : (
            <div className="table-list">
              <span className="pill">{data.organizations.length} Organisationen</span>
              <span className="pill">{data.jobs.length} Auftraege</span>
              <span className="pill">{data.classes.length} Klassen</span>
              <span className="pill">{data.children.length} Kinder</span>
              <span className="pill">{data.guardianLinks.length} Elternlinks</span>
              {data.jobs.map((job) => (
                <p key={job.id}>
                  {job.title} · {formatDate(job.date)}
                </p>
              ))}
            </div>
          )}
        </Card>
      </div>
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
