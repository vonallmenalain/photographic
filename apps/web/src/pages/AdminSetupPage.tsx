import { FormEvent, useEffect, useMemo, useState } from "react";
import { FileSpreadsheet, TableProperties, Upload } from "lucide-react";
import { ApiError, apiGet, apiPost, apiUploadFormData } from "../api/photosApi";
import { useAuth } from "../auth/useAuth";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { EmptyState } from "../components/EmptyState";
import { ErrorState } from "../components/ErrorState";
import { Loading } from "../components/Loading";
import { AdminData, Job, Organization, OrganizationType, RosterImportResult, SchoolClass } from "../types/domain";
import { formatDate } from "../utils/format";

const emptyData: AdminData = {
  organizations: [],
  jobs: [],
  classes: [],
  children: [],
  guardianLinks: [],
  photos: []
};

const samplePaste = [
  "Organisation\tFotoauftrag\tKlasse\tName\tE-Mail",
  "Schule Muster\tFotos 2026\t1A\tMia Beispiel\tmama@example.com",
  "Schule Muster\tFotos 2026\t1A\tNoah Beispiel\tpapa@example.com"
].join("\n");

function splitDelimitedLine(line: string, delimiter: string) {
  const cells: string[] = [];
  let current = "";
  let quoted = false;

  for (const character of line) {
    if (character === '"') {
      quoted = !quoted;
      continue;
    }

    if (character === delimiter && !quoted) {
      cells.push(current.trim());
      current = "";
      continue;
    }

    current += character;
  }

  cells.push(current.trim());
  return cells;
}

function delimiterForLine(line: string) {
  if (line.includes("\t")) return "\t";
  if (line.includes(";")) return ";";
  return ",";
}

function parsePastedTable(value: string) {
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    throw new Error("Bitte fuege eine Tabelle mit Kopfzeile und mindestens einer Datenzeile ein.");
  }

  const delimiter = delimiterForLine(lines[0]);
  const headers = splitDelimitedLine(lines[0], delimiter);

  return lines.slice(1).map((line) => {
    const cells = splitDelimitedLine(line, delimiter);
    return Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""]));
  });
}

function ImportResult({ result }: { result: RosterImportResult }) {
  return (
    <div className="notice">
      <strong>
        Importiert: {result.importedRows} von {result.receivedRows} Zeilen
      </strong>
      <div className="import-summary">
        <span>Schulen: {result.created.organizations}</span>
        <span>Auftraege: {result.created.jobs}</span>
        <span>Klassen: {result.created.classes}</span>
        <span>Kinder: {result.created.children}</span>
        <span>Elternlinks: {result.created.guardianLinks}</span>
      </div>
      {result.errors.length > 0 ? (
        <div className="error-box">
          {result.errors.slice(0, 6).map((error) => (
            <p key={`${error.rowNumber}-${error.message}`}>
              Zeile {error.rowNumber}: {error.message}
            </p>
          ))}
          {result.errors.length > 6 ? <p>Weitere Fehler: {result.errors.length - 6}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

type ClassChoice = {
  organization: Organization;
  job: Job;
  schoolClass: SchoolClass;
};

type ChildLinkPayload = {
  email: string;
  orgId: string;
  jobId: string;
  classId: string;
  displayName: string;
};

type SaveChildResult = {
  suggestedLoginUrl?: string;
  importResult?: RosterImportResult;
};

export function AdminSetupPage() {
  const { getIdToken } = useAuth();
  const [data, setData] = useState<AdminData>(emptyData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [suggestedUrl, setSuggestedUrl] = useState("");
  const [importResult, setImportResult] = useState<RosterImportResult | null>(null);
  const [importing, setImporting] = useState(false);
  const [excelFile, setExcelFile] = useState<File | null>(null);
  const [pastedTable, setPastedTable] = useState(samplePaste);

  const [structureForm, setStructureForm] = useState({
    orgName: "",
    orgType: "school" as OrganizationType,
    jobTitle: "",
    date: "",
    retentionUntil: "",
    className: "",
    teacherName: ""
  });
  const [childLinkForm, setChildLinkForm] = useState({
    email: "",
    orgId: "",
    jobId: "",
    classId: "",
    displayName: ""
  });
  const classChoices = useMemo(() => {
    return data.classes
      .map((schoolClass) => {
        const organization = data.organizations.find((entry) => entry.id === schoolClass.orgId);
        const job = data.jobs.find((entry) => entry.id === schoolClass.jobId);
        if (!organization || !job) {
          return null;
        }

        return { organization, job, schoolClass };
      })
      .filter((choice): choice is ClassChoice => Boolean(choice))
      .sort((left, right) => {
        const leftDate = Date.parse(left.schoolClass.createdAt ?? left.job.createdAt ?? left.job.date ?? "");
        const rightDate = Date.parse(right.schoolClass.createdAt ?? right.job.createdAt ?? right.job.date ?? "");
        return (Number.isNaN(rightDate) ? 0 : rightDate) - (Number.isNaN(leftDate) ? 0 : leftDate);
      });
  }, [data.classes, data.jobs, data.organizations]);
  const recentClassChoices = classChoices.slice(0, 5);
  const availableJobs = data.jobs.filter((job) => !childLinkForm.orgId || job.orgId === childLinkForm.orgId);
  const availableClasses = data.classes.filter(
    (schoolClass) =>
      (!childLinkForm.orgId || schoolClass.orgId === childLinkForm.orgId) &&
      (!childLinkForm.jobId || schoolClass.jobId === childLinkForm.jobId)
  );

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

  async function submitStructure(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    setError("");
    setSuggestedUrl("");

    try {
      const organization = await apiPost<{ id: string }>(
        "/api/admin/organizations",
        { name: structureForm.orgName, type: structureForm.orgType },
        getIdToken
      );
      const job = await apiPost<{ id: string }>(
        "/api/admin/jobs",
        {
          orgId: organization.id,
          title: structureForm.jobTitle,
          date: structureForm.date,
          retentionUntil: structureForm.retentionUntil || undefined
        },
        getIdToken
      );
      const schoolClass = await apiPost<{ id: string }>(
        "/api/admin/classes",
        {
          orgId: organization.id,
          jobId: job.id,
          name: structureForm.className,
          teacherName: structureForm.teacherName || undefined
        },
        getIdToken
      );

      setMessage("Schule, Fotoauftrag und Klasse gespeichert.");
      setChildLinkForm({
        ...childLinkForm,
        orgId: organization.id,
        jobId: job.id,
        classId: schoolClass.id
      });
      await refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Die Stammdaten konnten nicht gespeichert werden.");
    }
  }

  async function submitChildAndLink(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    setError("");
    setSuggestedUrl("");
    setImportResult(null);

    try {
      const link = await saveChildAndGuardianLink();

      setMessage("Kind und Elternzugriff gespeichert.");
      if (link.suggestedLoginUrl) {
        setSuggestedUrl(link.suggestedLoginUrl);
      }
      if (link.importResult) {
        setImportResult(link.importResult);
      }
      setChildLinkForm({ ...childLinkForm, email: "", displayName: "" });
      await refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Kind oder Elternzugriff konnte nicht gespeichert werden.");
    }
  }

  async function saveChildAndGuardianLink(): Promise<SaveChildResult> {
    const payload = {
      email: childLinkForm.email,
      orgId: childLinkForm.orgId,
      jobId: childLinkForm.jobId,
      classId: childLinkForm.classId,
      displayName: childLinkForm.displayName
    };
    const selectedContext = getSelectedClassChoice(payload);

    try {
      return await apiPost<{ suggestedLoginUrl?: string }>(
        "/api/admin/children-with-guardian-link",
        payload,
        getIdToken
      );
    } catch (saveError) {
      if (!isMissingRouteError(saveError)) {
        throw saveError;
      }

      return saveViaLegacyEndpoints(payload, selectedContext);
    }
  }

  async function saveViaLegacyEndpoints(payload: ChildLinkPayload, selectedContext: ClassChoice) {
    try {
      const child = await apiPost<{ id: string }>(
        "/api/admin/children",
        {
          orgId: payload.orgId,
          jobId: payload.jobId,
          classId: payload.classId,
          displayName: payload.displayName
        },
        getIdToken
      );
      return apiPost<{ suggestedLoginUrl?: string }>(
        "/api/admin/guardian-links",
        {
          email: payload.email,
          orgId: payload.orgId,
          jobId: payload.jobId,
          classId: payload.classId,
          childId: child.id
        },
        getIdToken
      );
    } catch (legacyError) {
      if (!isValidationError(legacyError)) {
        throw legacyError;
      }

      return saveViaRosterImport(payload, selectedContext);
    }
  }

  async function saveViaRosterImport(payload: ChildLinkPayload, selectedContext: ClassChoice): Promise<SaveChildResult> {
    try {
      const result = await apiPost<RosterImportResult>(
        "/api/admin/import/roster",
        {
          rows: [
            {
              Organisation: selectedContext.organization.name,
              Typ: selectedContext.organization.type,
              Fotoauftrag: selectedContext.job.title,
              Datum: selectedContext.job.date,
              Klasse: selectedContext.schoolClass.name,
              Lehrperson: selectedContext.schoolClass.teacherName ?? "",
              Name: payload.displayName,
              "E-Mail": payload.email
            }
          ]
        },
        getIdToken
      );

      if (result.importedRows < 1) {
        const firstError = result.errors[0]?.message;
        throw new Error(firstError || "Kind und Elternzugriff konnten nicht importiert werden.");
      }

      return {
        suggestedLoginUrl: buildSuggestedLoginUrl(payload.email, payload.jobId),
        importResult: result
      };
    } catch (importError) {
      if (!isMissingRouteError(importError)) {
        throw importError;
      }

      return saveViaFreshStructure(payload, selectedContext);
    }
  }

  async function saveViaFreshStructure(payload: ChildLinkPayload, selectedContext: ClassChoice) {
    const organization = await apiPost<{ id: string }>(
      "/api/admin/organizations",
      { name: selectedContext.organization.name, type: selectedContext.organization.type },
      getIdToken
    );
    const job = await apiPost<{ id: string }>(
      "/api/admin/jobs",
      {
        orgId: organization.id,
        title: selectedContext.job.title,
        date: selectedContext.job.date,
        retentionUntil: selectedContext.job.retentionUntil || undefined
      },
      getIdToken
    );
    const schoolClass = await apiPost<{ id: string }>(
      "/api/admin/classes",
      {
        orgId: organization.id,
        jobId: job.id,
        name: selectedContext.schoolClass.name,
        teacherName: selectedContext.schoolClass.teacherName || undefined
      },
      getIdToken
    );
    const child = await apiPost<{ id: string }>(
      "/api/admin/children",
      {
        orgId: organization.id,
        jobId: job.id,
        classId: schoolClass.id,
        displayName: payload.displayName
      },
      getIdToken
    );

    return apiPost<{ suggestedLoginUrl?: string }>(
      "/api/admin/guardian-links",
      {
        email: payload.email,
        orgId: organization.id,
        jobId: job.id,
        classId: schoolClass.id,
        childId: child.id
      },
      getIdToken
    );
  }

  function getSelectedClassChoice(payload: ChildLinkPayload) {
    const organization = data.organizations.find((entry) => entry.id === payload.orgId);
    const job = data.jobs.find((entry) => entry.id === payload.jobId);
    const schoolClass = data.classes.find((entry) => entry.id === payload.classId);

    if (!organization || !job || !schoolClass) {
      throw new Error("Bitte waehle Organisation, Auftrag und Klasse aus.");
    }

    return { organization, job, schoolClass };
  }

  function isMissingRouteError(error: unknown) {
    return error instanceof ApiError && error.status === 404;
  }

  function isValidationError(error: unknown) {
    return error instanceof ApiError && error.status === 400 && error.code === "VALIDATION_ERROR";
  }

  function buildSuggestedLoginUrl(email: string, jobId: string) {
    const loginUrl = new URL("/login", window.location.origin);
    loginUrl.searchParams.set("email", email.trim());
    loginUrl.searchParams.set("jobId", jobId);
    return loginUrl.toString();
  }

  function selectOrganization(orgId: string) {
    setChildLinkForm((current) => {
      const jobStillFits = data.jobs.some((job) => job.id === current.jobId && job.orgId === orgId);
      const jobId = jobStillFits ? current.jobId : "";
      const classStillFits = data.classes.some(
        (schoolClass) =>
          schoolClass.id === current.classId &&
          schoolClass.orgId === orgId &&
          (!jobId || schoolClass.jobId === jobId)
      );

      return {
        ...current,
        orgId,
        jobId,
        classId: classStillFits ? current.classId : ""
      };
    });
  }

  function selectJob(jobId: string) {
    setChildLinkForm((current) => {
      const job = data.jobs.find((entry) => entry.id === jobId);
      const orgId = job?.orgId ?? current.orgId;
      const classStillFits = data.classes.some(
        (schoolClass) =>
          schoolClass.id === current.classId &&
          schoolClass.jobId === jobId &&
          (!orgId || schoolClass.orgId === orgId)
      );

      return {
        ...current,
        orgId,
        jobId,
        classId: classStillFits ? current.classId : ""
      };
    });
  }

  function selectClass(classId: string) {
    const schoolClass = data.classes.find((entry) => entry.id === classId);
    setChildLinkForm((current) => ({
      ...current,
      orgId: schoolClass?.orgId ?? current.orgId,
      jobId: schoolClass?.jobId ?? current.jobId,
      classId
    }));
  }

  function applyClassChoice(choice: ClassChoice) {
    setChildLinkForm((current) => ({
      ...current,
      orgId: choice.organization.id,
      jobId: choice.job.id,
      classId: choice.schoolClass.id
    }));
  }

  async function importFromPaste(event: FormEvent) {
    event.preventDefault();
    setError("");
    setMessage("");
    setImportResult(null);
    setImporting(true);

    try {
      const rows = parsePastedTable(pastedTable);
      const result = await apiPost<RosterImportResult>("/api/admin/import/roster", { rows }, getIdToken);
      setImportResult(result);
      setMessage("Tabelle importiert.");
      await refresh();
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "Die Tabelle konnte nicht importiert werden.");
    } finally {
      setImporting(false);
    }
  }

  async function importFromExcel(event: FormEvent) {
    event.preventDefault();
    setError("");
    setMessage("");
    setImportResult(null);

    if (!excelFile) {
      setError("Bitte waehle eine .xlsx-Datei aus.");
      return;
    }

    setImporting(true);
    try {
      const body = new FormData();
      body.append("file", excelFile);
      const result = await apiUploadFormData<RosterImportResult>("/api/admin/import/roster-file", body, getIdToken);
      setImportResult(result);
      setMessage("Excel-Datei importiert.");
      await refresh();
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "Die Excel-Datei konnte nicht importiert werden.");
    } finally {
      setImporting(false);
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
          <p>Die Namen sind in der App sichtbar. Dateipfade nutzen weiterhin nur zufaellige IDs.</p>
        </div>
      </div>
      {error ? <ErrorState message={error} /> : null}
      {message ? <div className="success-box">{message}</div> : null}
      {suggestedUrl ? (
        <div className="notice">
          <strong>Vorgeschlagener Login-Link:</strong>
          <br />
          <code>{suggestedUrl}</code>
        </div>
      ) : null}
      {importResult ? <ImportResult result={importResult} /> : null}

      <div className="grid two">
        <Card>
          <h2>Schule, Auftrag und Klasse</h2>
          <form className="form" onSubmit={submitStructure}>
            <div className="grid two">
              <div className="form-row">
                <label>Organisation / Schule</label>
                <input required value={structureForm.orgName} onChange={(event) => setStructureForm({ ...structureForm, orgName: event.target.value })} />
              </div>
              <div className="form-row">
                <label>Typ</label>
                <select value={structureForm.orgType} onChange={(event) => setStructureForm({ ...structureForm, orgType: event.target.value as OrganizationType })}>
                  <option value="school">Schule</option>
                  <option value="kindergarten">Kindergarten</option>
                </select>
              </div>
              <div className="form-row">
                <label>Fotoauftrag</label>
                <input required value={structureForm.jobTitle} onChange={(event) => setStructureForm({ ...structureForm, jobTitle: event.target.value })} />
              </div>
              <div className="form-row">
                <label>Datum</label>
                <input required type="date" value={structureForm.date} onChange={(event) => setStructureForm({ ...structureForm, date: event.target.value })} />
              </div>
              <div className="form-row">
                <label>Klasse</label>
                <input required value={structureForm.className} onChange={(event) => setStructureForm({ ...structureForm, className: event.target.value })} />
              </div>
              <div className="form-row">
                <label>Lehrperson optional</label>
                <input value={structureForm.teacherName} onChange={(event) => setStructureForm({ ...structureForm, teacherName: event.target.value })} />
              </div>
            </div>
            <Button>Speichern</Button>
          </form>
        </Card>

        <Card>
          <h2>Kind und Elternzugriff</h2>
          <form className="form" onSubmit={submitChildAndLink}>
            {recentClassChoices.length > 0 ? (
              <div className="quick-picks">
                <span>Zuletzt verwendet</span>
                <div className="quick-pick-list">
                  {recentClassChoices.map((choice) => (
                    <button
                      key={choice.schoolClass.id}
                      className="quick-pick"
                      type="button"
                      onClick={() => applyClassChoice(choice)}
                    >
                      <span>{choice.schoolClass.name}</span>
                      <small>
                        {choice.organization.name} | {choice.job.title}
                      </small>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            <Select label="Organisation" value={childLinkForm.orgId} items={data.organizations} onChange={selectOrganization} />
            <Select label="Auftrag" value={childLinkForm.jobId} items={availableJobs} onChange={selectJob} />
            <Select label="Klasse" value={childLinkForm.classId} items={availableClasses} onChange={selectClass} />
            <div className="form-row">
              <label>Name Kind</label>
              <input required value={childLinkForm.displayName} onChange={(event) => setChildLinkForm({ ...childLinkForm, displayName: event.target.value })} />
            </div>
            <div className="form-row">
              <label>E-Mail Eltern</label>
              <input required type="email" value={childLinkForm.email} onChange={(event) => setChildLinkForm({ ...childLinkForm, email: event.target.value })} />
            </div>
            <Button>Kind und Elternzugriff speichern</Button>
          </form>
        </Card>
      </div>

      <div className="grid two">
        <Card>
          <div className="card-header">
            <div>
              <h2>Excel importieren</h2>
              <p>Unterstuetzt .xlsx mit Kopfzeile.</p>
            </div>
            <FileSpreadsheet aria-hidden="true" />
          </div>
          <form className="form" onSubmit={importFromExcel}>
            <div className="form-row">
              <label>Excel-Datei</label>
              <input
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={(event) => setExcelFile(event.target.files?.[0] ?? null)}
              />
            </div>
            <Button disabled={importing} icon={<Upload size={18} />}>
              {importing ? "Import laeuft..." : "Excel importieren"}
            </Button>
          </form>
        </Card>

        <Card>
          <div className="card-header">
            <div>
              <h2>Tabelle einfuegen</h2>
              <p>Aus Excel, Numbers oder Google Sheets kopieren und einfuegen.</p>
            </div>
            <TableProperties aria-hidden="true" />
          </div>
          <form className="form" onSubmit={importFromPaste}>
            <div className="form-row">
              <label>Tabellendaten</label>
              <textarea rows={8} value={pastedTable} onChange={(event) => setPastedTable(event.target.value)} />
            </div>
            <Button disabled={importing} icon={<TableProperties size={18} />}>
              {importing ? "Import laeuft..." : "Tabelle importieren"}
            </Button>
          </form>
        </Card>
      </div>

      <Card>
        <h2>Uebersicht</h2>
        {data.organizations.length === 0 ? (
          <EmptyState title="Noch keine Stammdaten">Lege zuerst eine Schule oder importiere eine Tabelle.</EmptyState>
        ) : (
          <div className="table-list">
            <span className="pill">{data.organizations.length} Organisationen</span>
            <span className="pill">{data.jobs.length} Auftraege</span>
            <span className="pill">{data.classes.length} Klassen</span>
            <span className="pill">{data.children.length} Kinder</span>
            <span className="pill">{data.guardianLinks.length} Elternlinks</span>
            {data.jobs.map((job) => (
              <p key={job.id}>
                {job.title} | {formatDate(job.date)}
              </p>
            ))}
          </div>
        )}
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
