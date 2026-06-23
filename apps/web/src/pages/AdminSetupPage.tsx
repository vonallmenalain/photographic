import { FormEvent, useEffect, useMemo, useState } from "react";
import { FileSpreadsheet, TableProperties, Upload } from "lucide-react";
import { ApiError, apiGet, apiPost } from "../api/photosApi";
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
    throw new Error("Bitte füge eine Tabelle mit Kopfzeile und mindestens einer Datenzeile ein.");
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
        <span>Aufträge: {result.created.jobs}</span>
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

type ParsedRosterRow = {
  rowNumber: number;
  organizationName: string;
  organizationType: OrganizationType;
  jobTitle: string;
  jobDate: string;
  className: string;
  teacherName: string;
  childName: string;
  guardianEmail: string;
};

type MutableAdminData = {
  organizations: Organization[];
  jobs: Job[];
  classes: SchoolClass[];
  children: AdminData["children"];
  guardianLinks: AdminData["guardianLinks"];
};

const legacyIdPattern = /^[A-Za-z0-9_-]{6,80}$/;

const rosterAliases = {
  organizationName: ["organisation", "organization", "schule", "kita", "kindergarten"],
  organizationType: ["typ", "organisationstyp", "schultyp"],
  jobTitle: ["fotoauftrag", "auftrag", "job", "fototag", "shooting"],
  jobDate: ["datum", "fotodatum", "auftragsdatum", "date"],
  className: ["klasse", "class", "gruppe"],
  teacherName: ["lehrperson", "lehrer", "lehrerin", "teacher"],
  childName: ["name", "name kind", "kind", "kindname", "kind name", "kindernamen"],
  guardianEmail: ["email", "e-mail", "e mail", "email eltern", "e-mail eltern", "eltern email", "eltern-e-mail", "elternmail", "eltern"]
};

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeLookupKey(value: unknown) {
  return normalizeText(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[_./-]+/g, " ")
    .replace(/\s+/g, " ");
}

function organizationMatchKey(value: unknown) {
  return normalizeLookupKey(value).replace(/^(schule|kindergarten|kita) /, "");
}

function lookupRowValue(row: Record<string, unknown>, aliases: string[]) {
  const entries = Object.entries(row).map(([key, value]) => [normalizeLookupKey(key), value] as const);
  const normalizedAliases = aliases.map(normalizeLookupKey);
  const found = entries.find(([key]) => normalizedAliases.includes(key));
  return normalizeText(found?.[1]);
}

function normalizeOrganizationType(value: string): OrganizationType {
  const normalized = normalizeLookupKey(value);
  return normalized.includes("kita") || normalized.includes("kindergarten") ? "kindergarten" : "school";
}

function parseRosterRow(row: Record<string, unknown>, index: number): ParsedRosterRow {
  const parsed = {
    rowNumber: index + 2,
    organizationName: lookupRowValue(row, rosterAliases.organizationName),
    organizationType: normalizeOrganizationType(lookupRowValue(row, rosterAliases.organizationType)),
    jobTitle: lookupRowValue(row, rosterAliases.jobTitle),
    jobDate: lookupRowValue(row, rosterAliases.jobDate) || todayIsoDate(),
    className: lookupRowValue(row, rosterAliases.className),
    teacherName: lookupRowValue(row, rosterAliases.teacherName),
    childName: lookupRowValue(row, rosterAliases.childName),
    guardianEmail: lookupRowValue(row, rosterAliases.guardianEmail)
  };

  const missing = [
    ["Organisation/Schule", parsed.organizationName],
    ["Fotoauftrag/Auftrag", parsed.jobTitle],
    ["Klasse", parsed.className],
    ["Name Kind", parsed.childName],
    ["E-Mail Eltern", parsed.guardianEmail]
  ]
    .filter(([, value]) => !value)
    .map(([label]) => label);

  if (missing.length > 0) {
    throw new Error(`Pflichtfelder fehlen: ${missing.join(", ")}`);
  }

  return parsed;
}

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

    return saveViaLegacyEndpoints(payload, selectedContext);
  }

  async function saveViaLegacyEndpoints(payload: ChildLinkPayload, selectedContext: ClassChoice) {
    try {
      if (!hasLegacySafeIds(payload.orgId, payload.jobId, payload.classId)) {
        throw new ApiError("Bestehende IDs sind nicht mit der alten API kompatibel.", "VALIDATION_ERROR", 400);
      }

      return saveChildWithResolvedIds(payload, {
        orgId: payload.orgId,
        jobId: payload.jobId,
        classId: payload.classId
      });
    } catch (legacyError) {
      if (!isValidationError(legacyError)) {
        throw legacyError;
      }

      const resolved = await ensureLegacyCompatibleContext(selectedContext, {
        organizations: [...data.organizations],
        jobs: [...data.jobs],
        classes: [...data.classes],
        children: [...data.children],
        guardianLinks: [...data.guardianLinks]
      });
      return saveChildWithResolvedIds(payload, resolved);
    }
  }

  async function saveChildWithResolvedIds(
    payload: ChildLinkPayload,
    resolved: { orgId: string; jobId: string; classId: string }
  ) {
    const child = await apiPost<{ id: string }>(
      "/api/admin/children",
      {
        orgId: resolved.orgId,
        jobId: resolved.jobId,
        classId: resolved.classId,
        displayName: payload.displayName,
        pseudonym: payload.displayName.slice(0, 80),
        consentStatus: "granted"
      },
      getIdToken
    );

    return apiPost<{ suggestedLoginUrl?: string }>(
      "/api/admin/guardian-links",
      {
        email: payload.email,
        orgId: resolved.orgId,
        jobId: resolved.jobId,
        classId: resolved.classId,
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
      throw new Error("Bitte wähle Organisation, Auftrag und Klasse aus.");
    }

    return { organization, job, schoolClass };
  }

  function isValidationError(error: unknown) {
    return error instanceof ApiError && error.status === 400 && error.code === "VALIDATION_ERROR";
  }

  function hasLegacySafeIds(...ids: string[]) {
    return ids.every((id) => legacyIdPattern.test(id));
  }

  async function ensureLegacyCompatibleContext(choice: ClassChoice, workingData: MutableAdminData) {
    let organization = workingData.organizations.find(
      (entry) => entry.id === choice.organization.id && legacyIdPattern.test(entry.id)
    );
    organization ??= workingData.organizations.find(
      (entry) => legacyIdPattern.test(entry.id) && organizationMatchKey(entry.name) === organizationMatchKey(choice.organization.name)
    );

    if (!organization) {
      const created = await apiPost<{ id: string }>(
        "/api/admin/organizations",
        { name: choice.organization.name, type: choice.organization.type },
        getIdToken
      );
      organization = {
        id: created.id,
        name: choice.organization.name,
        type: choice.organization.type
      };
      workingData.organizations.push(organization);
    }

    let job = workingData.jobs.find(
      (entry) =>
        entry.id === choice.job.id &&
        entry.orgId === organization.id &&
        legacyIdPattern.test(entry.id)
    );
    job ??= workingData.jobs.find(
      (entry) =>
        entry.orgId === organization.id &&
        legacyIdPattern.test(entry.id) &&
        normalizeLookupKey(entry.title) === normalizeLookupKey(choice.job.title)
    );

    if (!job) {
      const created = await apiPost<{ id: string }>(
        "/api/admin/jobs",
        {
          orgId: organization.id,
          title: choice.job.title,
          date: choice.job.date || todayIsoDate(),
          retentionUntil: choice.job.retentionUntil || undefined
        },
        getIdToken
      );
      job = {
        id: created.id,
        orgId: organization.id,
        title: choice.job.title,
        date: choice.job.date || todayIsoDate(),
        status: choice.job.status || "draft",
        retentionUntil: choice.job.retentionUntil
      };
      workingData.jobs.push(job);
    }

    let schoolClass = workingData.classes.find(
      (entry) =>
        entry.id === choice.schoolClass.id &&
        entry.orgId === organization.id &&
        entry.jobId === job.id &&
        legacyIdPattern.test(entry.id)
    );
    schoolClass ??= workingData.classes.find(
      (entry) =>
        entry.orgId === organization.id &&
        entry.jobId === job.id &&
        legacyIdPattern.test(entry.id) &&
        normalizeLookupKey(entry.name) === normalizeLookupKey(choice.schoolClass.name)
    );

    if (!schoolClass) {
      const created = await apiPost<{ id: string }>(
        "/api/admin/classes",
        {
          orgId: organization.id,
          jobId: job.id,
          name: choice.schoolClass.name,
          teacherName: choice.schoolClass.teacherName || undefined
        },
        getIdToken
      );
      schoolClass = {
        id: created.id,
        orgId: organization.id,
        jobId: job.id,
        name: choice.schoolClass.name,
        teacherName: choice.schoolClass.teacherName
      };
      workingData.classes.push(schoolClass);
    }

    return {
      orgId: organization.id,
      jobId: job.id,
      classId: schoolClass.id
    };
  }

  async function ensureRosterContext(parsed: ParsedRosterRow, workingData: MutableAdminData, result: RosterImportResult) {
    let organization = workingData.organizations.find(
      (entry) => legacyIdPattern.test(entry.id) && organizationMatchKey(entry.name) === organizationMatchKey(parsed.organizationName)
    );

    if (!organization) {
      const created = await apiPost<{ id: string }>(
        "/api/admin/organizations",
        { name: parsed.organizationName, type: parsed.organizationType },
        getIdToken
      );
      organization = {
        id: created.id,
        name: parsed.organizationName,
        type: parsed.organizationType
      };
      workingData.organizations.push(organization);
      result.created.organizations += 1;
    }

    let job = workingData.jobs.find(
      (entry) =>
        entry.orgId === organization.id &&
        legacyIdPattern.test(entry.id) &&
        normalizeLookupKey(entry.title) === normalizeLookupKey(parsed.jobTitle)
    );

    if (!job) {
      const created = await apiPost<{ id: string }>(
        "/api/admin/jobs",
        {
          orgId: organization.id,
          title: parsed.jobTitle,
          date: parsed.jobDate,
          retentionUntil: undefined
        },
        getIdToken
      );
      job = {
        id: created.id,
        orgId: organization.id,
        title: parsed.jobTitle,
        date: parsed.jobDate,
        status: "draft",
        retentionUntil: null
      };
      workingData.jobs.push(job);
      result.created.jobs += 1;
    }

    let schoolClass = workingData.classes.find(
      (entry) =>
        entry.orgId === organization.id &&
        entry.jobId === job.id &&
        legacyIdPattern.test(entry.id) &&
        normalizeLookupKey(entry.name) === normalizeLookupKey(parsed.className)
    );

    if (!schoolClass) {
      const created = await apiPost<{ id: string }>(
        "/api/admin/classes",
        {
          orgId: organization.id,
          jobId: job.id,
          name: parsed.className,
          teacherName: parsed.teacherName || undefined
        },
        getIdToken
      );
      schoolClass = {
        id: created.id,
        orgId: organization.id,
        jobId: job.id,
        name: parsed.className,
        teacherName: parsed.teacherName
      };
      workingData.classes.push(schoolClass);
      result.created.classes += 1;
    }

    return { organization, job, schoolClass };
  }

  async function importRosterRowsLocally(rows: Array<Record<string, unknown>>) {
    const workingData: MutableAdminData = {
      organizations: [...data.organizations],
      jobs: [...data.jobs],
      classes: [...data.classes],
      children: [...data.children],
      guardianLinks: [...data.guardianLinks]
    };
    const result: RosterImportResult = {
      receivedRows: rows.length,
      importedRows: 0,
      skippedRows: 0,
      created: {
        organizations: 0,
        jobs: 0,
        classes: 0,
        children: 0,
        guardianLinks: 0
      },
      errors: []
    };

    for (const [index, row] of rows.entries()) {
      let parsed: ParsedRosterRow;
      try {
        parsed = parseRosterRow(row, index);
      } catch (parseError) {
        result.skippedRows += 1;
        result.errors.push({
          rowNumber: index + 2,
          message: parseError instanceof Error ? parseError.message : "Zeile konnte nicht gelesen werden."
        });
        continue;
      }

      try {
        const { organization, job, schoolClass } = await ensureRosterContext(parsed, workingData, result);
        let child = workingData.children.find(
          (entry) =>
            entry.orgId === organization.id &&
            entry.jobId === job.id &&
            entry.classId === schoolClass.id &&
            normalizeLookupKey(entry.displayName || entry.pseudonym || "") === normalizeLookupKey(parsed.childName)
        );

        if (!child) {
          const created = await apiPost<{ id: string }>(
            "/api/admin/children",
            {
              orgId: organization.id,
              jobId: job.id,
              classId: schoolClass.id,
              displayName: parsed.childName,
              pseudonym: parsed.childName.slice(0, 80),
              consentStatus: "granted"
            },
            getIdToken
          );
          child = {
            id: created.id,
            orgId: organization.id,
            jobId: job.id,
            classId: schoolClass.id,
            displayName: parsed.childName,
            pseudonym: parsed.childName.slice(0, 80)
          };
          workingData.children.push(child);
          result.created.children += 1;
        }

        const emailLower = parsed.guardianEmail.trim().toLowerCase();
        const existingLink = workingData.guardianLinks.find(
          (entry) =>
            !entry.revokedAt &&
            (entry.emailLower || entry.email.trim().toLowerCase()) === emailLower &&
            entry.orgId === organization.id &&
            entry.jobId === job.id &&
            entry.classId === schoolClass.id &&
            entry.childId === child.id
        );

        if (!existingLink) {
          const link = await apiPost<{ id?: string }>(
            "/api/admin/guardian-links",
            {
              email: parsed.guardianEmail,
              orgId: organization.id,
              jobId: job.id,
              classId: schoolClass.id,
              childId: child.id
            },
            getIdToken
          );
          workingData.guardianLinks.push({
            id: link.id ?? `${child.id}-${emailLower}`,
            email: parsed.guardianEmail,
            emailLower,
            orgId: organization.id,
            jobId: job.id,
            classId: schoolClass.id,
            childId: child.id,
            revokedAt: null
          });
          result.created.guardianLinks += 1;
        }

        result.importedRows += 1;
      } catch (rowError) {
        result.skippedRows += 1;
        result.errors.push({
          rowNumber: parsed.rowNumber,
          message: rowError instanceof Error ? rowError.message : "Zeile konnte nicht importiert werden."
        });
      }
    }

    return result;
  }

  async function parseExcelRows(file: File) {
    const { default: ExcelJS } = await import("exceljs");
    const workbook = new ExcelJS.Workbook();
    const buffer = await file.arrayBuffer();
    await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    const worksheet = workbook.worksheets[0];

    if (!worksheet) {
      throw new Error("Die Excel-Datei enthält kein Tabellenblatt.");
    }

    const headerRow = worksheet.getRow(1);
    const headers: string[] = [];
    headerRow.eachCell({ includeEmpty: false }, (cell, columnNumber) => {
      headers[columnNumber - 1] = normalizeText(cell.text);
    });

    const rows: Array<Record<string, unknown>> = [];
    for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
      const worksheetRow = worksheet.getRow(rowNumber);
      const row: Record<string, unknown> = {};
      let hasValue = false;

      headers.forEach((header, index) => {
        if (!header) return;
        const value = normalizeText(worksheetRow.getCell(index + 1).text);
        if (value) hasValue = true;
        row[header] = value;
      });

      if (hasValue) {
        rows.push(row);
      }
    }

    return rows;
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
      const result = await importRosterRowsLocally(rows);
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
      setError("Bitte wähle eine .xlsx-Datei aus.");
      return;
    }

    setImporting(true);
    try {
      const rows = await parseExcelRows(excelFile);
      const result = await importRosterRowsLocally(rows);
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
          <p>Die Namen sind in der App sichtbar. Dateipfade nutzen weiterhin nur zufällige IDs.</p>
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
              <p>Unterstützt .xlsx mit Kopfzeile.</p>
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
              {importing ? "Import läuft..." : "Excel importieren"}
            </Button>
          </form>
        </Card>

        <Card>
          <div className="card-header">
            <div>
              <h2>Tabelle einfügen</h2>
              <p>Aus Excel, Numbers oder Google Sheets kopieren und einfügen.</p>
            </div>
            <TableProperties aria-hidden="true" />
          </div>
          <form className="form" onSubmit={importFromPaste}>
            <div className="form-row">
              <label>Tabellendaten</label>
              <textarea rows={8} value={pastedTable} onChange={(event) => setPastedTable(event.target.value)} />
            </div>
            <Button disabled={importing} icon={<TableProperties size={18} />}>
              {importing ? "Import läuft..." : "Tabelle importieren"}
            </Button>
          </form>
        </Card>
      </div>

      <Card>
        <h2>Übersicht</h2>
        {data.organizations.length === 0 ? (
          <EmptyState title="Noch keine Stammdaten">Lege zuerst eine Schule oder importiere eine Tabelle.</EmptyState>
        ) : (
          <div className="table-list">
            <span className="pill">{data.organizations.length} Organisationen</span>
            <span className="pill">{data.jobs.length} Aufträge</span>
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
        <option value="">Bitte wählen</option>
        {items.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name || item.title || item.id}
          </option>
        ))}
      </select>
    </div>
  );
}
