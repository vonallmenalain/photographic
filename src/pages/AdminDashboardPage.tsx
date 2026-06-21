import {
  addDoc,
  collection,
  doc,
  serverTimestamp,
  updateDoc
} from "firebase/firestore";
import {
  Building2,
  CalendarDays,
  GraduationCap,
  Plus,
  QrCode,
  Upload,
  Users
} from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { EmptyState, ErrorState, LoadingState } from "../components/PageState";
import { db } from "../firebase/config";
import { listChildren, listClasses, listJobs, listOrganizations } from "../services/firestore";
import type {
  ChildRecord,
  ConsentStatus,
  Job,
  JobStatus,
  Organization,
  OrganizationType,
  SchoolClass
} from "../types/domain";

function dateAfterMonths(months: number) {
  const date = new Date();
  date.setMonth(date.getMonth() + months);
  return date.toISOString().slice(0, 10);
}

export function AdminDashboardPage() {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [children, setChildren] = useState<ChildRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [orgForm, setOrgForm] = useState({ name: "", type: "school" as OrganizationType });
  const [jobForm, setJobForm] = useState({
    orgId: "",
    title: "",
    date: new Date().toISOString().slice(0, 10),
    retentionUntil: dateAfterMonths(6)
  });
  const [classForm, setClassForm] = useState({ jobId: "", name: "", teacherName: "" });
  const [childForm, setChildForm] = useState({
    classId: "",
    pseudonym: "",
    consentStatus: "unknown" as ConsentStatus
  });

  const selectedJob = useMemo(
    () => jobs.find((job) => job.id === classForm.jobId) ?? jobs[0],
    [classForm.jobId, jobs]
  );
  const classOptions = useMemo(() => {
    const jobId = selectedJob?.id ?? "";
    return classes.filter((schoolClass) => schoolClass.jobId === jobId);
  }, [classes, selectedJob]);
  const publishedJobs = jobs.filter((job) => job.status === "published").length;

  async function loadData() {
    setLoading(true);
    setError("");
    try {
      const [nextOrganizations, nextJobs, nextClasses, nextChildren] = await Promise.all([
        listOrganizations(),
        listJobs(),
        listClasses(),
        listChildren()
      ]);
      setOrganizations(nextOrganizations);
      setJobs(nextJobs);
      setClasses(nextClasses);
      setChildren(nextChildren);
      setJobForm((current) => ({ ...current, orgId: current.orgId || nextOrganizations[0]?.id || "" }));
      setClassForm((current) => ({ ...current, jobId: current.jobId || nextJobs[0]?.id || "" }));
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "Admin-Daten konnten nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  async function handleCreateOrganization(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await addDoc(collection(db, "organizations"), {
        name: orgForm.name.trim(),
        type: orgForm.type,
        createdAt: serverTimestamp()
      });
      setOrgForm({ name: "", type: "school" });
      setMessage("Organisation erstellt.");
      await loadData();
    } catch {
      setError("Organisation konnte nicht erstellt werden.");
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateJob(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await addDoc(collection(db, "jobs"), {
        orgId: jobForm.orgId,
        title: jobForm.title.trim(),
        date: jobForm.date,
        status: "draft" satisfies JobStatus,
        retentionUntil: jobForm.retentionUntil,
        createdAt: serverTimestamp()
      });
      setJobForm((current) => ({ ...current, title: "" }));
      setMessage("Job erstellt.");
      await loadData();
    } catch {
      setError("Job konnte nicht erstellt werden.");
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateClass(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const job = jobs.find((item) => item.id === classForm.jobId);
    if (!job) {
      setError("Bitte wähle einen Job.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      await addDoc(collection(db, "classes"), {
        orgId: job.orgId,
        jobId: job.id,
        name: classForm.name.trim(),
        teacherName: classForm.teacherName.trim()
      });
      setClassForm((current) => ({ ...current, name: "", teacherName: "" }));
      setMessage("Klasse erstellt.");
      await loadData();
    } catch {
      setError("Klasse konnte nicht erstellt werden.");
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateChild(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const schoolClass = classes.find((item) => item.id === childForm.classId);
    if (!schoolClass) {
      setError("Bitte wähle eine Klasse.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      await addDoc(collection(db, "children"), {
        orgId: schoolClass.orgId,
        jobId: schoolClass.jobId,
        classId: schoolClass.id,
        pseudonym: childForm.pseudonym.trim(),
        consentStatus: childForm.consentStatus,
        createdAt: serverTimestamp()
      });
      setChildForm((current) => ({ ...current, pseudonym: "" }));
      setMessage("Pseudonym erstellt.");
      await loadData();
    } catch {
      setError("Pseudonym konnte nicht erstellt werden.");
    } finally {
      setSaving(false);
    }
  }

  async function setJobStatus(job: Job, status: JobStatus) {
    setError("");
    try {
      await updateDoc(doc(db, "jobs", job.id), { status });
      setMessage(status === "published" ? "Galerie veröffentlicht." : "Galerie zurückgestellt.");
      await loadData();
    } catch {
      setError("Status konnte nicht geändert werden.");
    }
  }

  if (loading) {
    return <LoadingState label="Admin-Daten werden geladen..." />;
  }

  return (
    <section className="page">
      <div className="page-header">
        <div>
          <p className="eyebrow">Admin</p>
          <h1>Dashboard</h1>
        </div>
        <div className="stat-row">
          <span>{jobs.length} Jobs</span>
          <span>{publishedJobs} veröffentlicht</span>
        </div>
      </div>

      {error ? <ErrorState message={error} /> : null}
      {message ? <p className="inline-note success">{message}</p> : null}

      <div className="admin-grid">
        <form className="panel stack" onSubmit={handleCreateOrganization}>
          <h2>
            <Building2 size={20} aria-hidden="true" />
            Organisation
          </h2>
          <label>
            Name
            <input
              required
              value={orgForm.name}
              onChange={(event) => setOrgForm((current) => ({ ...current, name: event.target.value }))}
              placeholder="Schule Musterhof"
            />
          </label>
          <label>
            Typ
            <select
              value={orgForm.type}
              onChange={(event) =>
                setOrgForm((current) => ({ ...current, type: event.target.value as OrganizationType }))
              }
            >
              <option value="school">Schule</option>
              <option value="kindergarten">Kindergarten</option>
            </select>
          </label>
          <button className="button primary" type="submit" disabled={saving}>
            <Plus size={18} aria-hidden="true" />
            Erstellen
          </button>
        </form>

        <form className="panel stack" onSubmit={handleCreateJob}>
          <h2>
            <CalendarDays size={20} aria-hidden="true" />
            Job
          </h2>
          <label>
            Organisation
            <select
              required
              value={jobForm.orgId}
              onChange={(event) => setJobForm((current) => ({ ...current, orgId: event.target.value }))}
            >
              <option value="">Auswählen</option>
              {organizations.map((organization) => (
                <option key={organization.id} value={organization.id}>
                  {organization.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Titel
            <input
              required
              value={jobForm.title}
              onChange={(event) => setJobForm((current) => ({ ...current, title: event.target.value }))}
              placeholder="Fototag Frühling"
            />
          </label>
          <div className="split-fields">
            <label>
              Datum
              <input
                required
                type="date"
                value={jobForm.date}
                onChange={(event) => setJobForm((current) => ({ ...current, date: event.target.value }))}
              />
            </label>
            <label>
              Aufbewahren bis
              <input
                required
                type="date"
                value={jobForm.retentionUntil}
                onChange={(event) =>
                  setJobForm((current) => ({ ...current, retentionUntil: event.target.value }))
                }
              />
            </label>
          </div>
          <button className="button primary" type="submit" disabled={saving || organizations.length === 0}>
            <Plus size={18} aria-hidden="true" />
            Erstellen
          </button>
        </form>

        <form className="panel stack" onSubmit={handleCreateClass}>
          <h2>
            <GraduationCap size={20} aria-hidden="true" />
            Klasse
          </h2>
          <label>
            Job
            <select
              required
              value={classForm.jobId}
              onChange={(event) => setClassForm((current) => ({ ...current, jobId: event.target.value }))}
            >
              <option value="">Auswählen</option>
              {jobs.map((job) => (
                <option key={job.id} value={job.id}>
                  {job.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            Klassenname
            <input
              required
              value={classForm.name}
              onChange={(event) => setClassForm((current) => ({ ...current, name: event.target.value }))}
              placeholder="Klasse A"
            />
          </label>
          <label>
            Lehrperson
            <input
              value={classForm.teacherName}
              onChange={(event) =>
                setClassForm((current) => ({ ...current, teacherName: event.target.value }))
              }
              placeholder="Lehrperson A"
            />
          </label>
          <button className="button primary" type="submit" disabled={saving || jobs.length === 0}>
            <Plus size={18} aria-hidden="true" />
            Erstellen
          </button>
        </form>

        <form className="panel stack" onSubmit={handleCreateChild}>
          <h2>
            <Users size={20} aria-hidden="true" />
            Pseudonym
          </h2>
          <label>
            Klasse
            <select
              required
              value={childForm.classId}
              onChange={(event) => setChildForm((current) => ({ ...current, classId: event.target.value }))}
            >
              <option value="">Auswählen</option>
              {classOptions.map((schoolClass) => (
                <option key={schoolClass.id} value={schoolClass.id}>
                  {schoolClass.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Pseudonym
            <input
              required
              value={childForm.pseudonym}
              onChange={(event) => setChildForm((current) => ({ ...current, pseudonym: event.target.value }))}
              placeholder="Kind A-01"
            />
          </label>
          <label>
            Einwilligung
            <select
              value={childForm.consentStatus}
              onChange={(event) =>
                setChildForm((current) => ({ ...current, consentStatus: event.target.value as ConsentStatus }))
              }
            >
              <option value="unknown">Unbekannt</option>
              <option value="granted">Erteilt</option>
              <option value="denied">Abgelehnt</option>
            </select>
          </label>
          <button className="button primary" type="submit" disabled={saving || classOptions.length === 0}>
            <Plus size={18} aria-hidden="true" />
            Erstellen
          </button>
        </form>
      </div>

      <section className="panel list-panel">
        <h2>Jobs</h2>
        {jobs.length === 0 ? (
          <EmptyState title="Noch keine Jobs" body="Erstelle zuerst eine Organisation und danach einen Job." />
        ) : (
          <div className="job-list">
            {jobs.map((job) => (
              <article className="job-row" key={job.id}>
                <div>
                  <strong>{job.title}</strong>
                  <span>{job.date} · {job.status}</span>
                </div>
                <div className="job-actions">
                  <Link className="button secondary small" to={`/admin/jobs/${job.id}/upload`}>
                    <Upload size={16} aria-hidden="true" />
                    Upload
                  </Link>
                  <Link className="button secondary small" to={`/admin/jobs/${job.id}/access-codes`}>
                    <QrCode size={16} aria-hidden="true" />
                    Codes
                  </Link>
                  <button
                    className="button primary small"
                    type="button"
                    onClick={() => void setJobStatus(job, job.status === "published" ? "review" : "published")}
                  >
                    {job.status === "published" ? "Zurückstellen" : "Veröffentlichen"}
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="metrics-grid" aria-label="Bestand">
        <div>
          <strong>{organizations.length}</strong>
          <span>Organisationen</span>
        </div>
        <div>
          <strong>{classes.length}</strong>
          <span>Klassen</span>
        </div>
        <div>
          <strong>{children.length}</strong>
          <span>Pseudonyme</span>
        </div>
      </section>
    </section>
  );
}
