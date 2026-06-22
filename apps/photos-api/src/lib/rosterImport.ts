import ExcelJS from "exceljs";
import { normalizeEmail } from "./admin";
import { adminDb, serverTimestamp } from "./firebaseAdmin";
import { randomId } from "./paths";
import { AuthContext } from "./auth";
import { writeAuditLog } from "./audit";
import { OrganizationType } from "../types/domain";

type RawImportRow = Record<string, unknown>;

type ParsedImportRow = {
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

type NamedRecord = {
  id?: string;
  name?: string;
  title?: string;
  orgId?: string;
  jobId?: string;
  classId?: string;
  emailLower?: string;
  childId?: string;
  revokedAt?: unknown;
};

const HEADER_ALIASES: Record<keyof Omit<ParsedImportRow, "rowNumber" | "organizationType" | "teacherName" | "jobDate">, string[]> = {
  organizationName: ["organisation", "organization", "schule", "kita", "kindergarten"],
  jobTitle: ["fotoauftrag", "auftrag", "job", "fototag", "shooting"],
  className: ["klasse", "class", "gruppe"],
  childName: ["name", "kind", "kindname", "kind name", "kindernamen", "kind vorname", "kind name vorname"],
  guardianEmail: ["email", "e-mail", "mail", "eltern email", "eltern-e-mail", "elternmail", "eltern"]
};

const OPTIONAL_ALIASES = {
  organizationType: ["typ", "organisationstyp", "schultyp"],
  jobDate: ["datum", "fotodatum", "auftragsdatum", "date"],
  teacherName: ["lehrperson", "lehrer", "lehrerin", "teacher"]
};

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeKey(value: unknown) {
  return normalizeText(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[_./]+/g, " ")
    .replace(/\s+/g, " ");
}

function normalizedLookup(row: RawImportRow, aliases: string[]) {
  const entries = Object.entries(row).map(([key, value]) => [normalizeKey(key), value] as const);
  const normalizedAliases = aliases.map(normalizeKey);
  const found = entries.find(([key]) => normalizedAliases.includes(key));
  return normalizeText(found?.[1]);
}

function normalizeOrganizationType(value: string): OrganizationType {
  const normalized = normalizeKey(value);
  return normalized.includes("kita") || normalized.includes("kindergarten") ? "kindergarten" : "school";
}

function parseRow(row: RawImportRow, index: number): ParsedImportRow {
  const parsed = {
    rowNumber: index + 1,
    organizationName: normalizedLookup(row, HEADER_ALIASES.organizationName),
    organizationType: normalizeOrganizationType(normalizedLookup(row, OPTIONAL_ALIASES.organizationType)),
    jobTitle: normalizedLookup(row, HEADER_ALIASES.jobTitle),
    jobDate: normalizedLookup(row, OPTIONAL_ALIASES.jobDate) || todayIsoDate(),
    className: normalizedLookup(row, HEADER_ALIASES.className),
    teacherName: normalizedLookup(row, OPTIONAL_ALIASES.teacherName),
    childName: normalizedLookup(row, HEADER_ALIASES.childName),
    guardianEmail: normalizedLookup(row, HEADER_ALIASES.guardianEmail)
  };

  const missing = [
    ["Organisation/Schule", parsed.organizationName],
    ["Fotoauftrag", parsed.jobTitle],
    ["Klasse", parsed.className],
    ["Name", parsed.childName],
    ["E-Mail", parsed.guardianEmail]
  ]
    .filter(([, value]) => !value)
    .map(([label]) => label);

  if (missing.length > 0) {
    throw new Error(`Pflichtfelder fehlen: ${missing.join(", ")}`);
  }

  return parsed;
}

function key(...parts: string[]) {
  return parts.map((part) => normalizeKey(part)).join("|");
}

async function getCollectionMap(collectionName: string) {
  const snapshot = await adminDb().collection(collectionName).get();
  return snapshot.docs.map((doc) => ({ id: doc.id, ...(doc.data() as NamedRecord) }));
}

function mapByName(items: NamedRecord[], getKey: (item: NamedRecord) => string) {
  return new Map(items.map((item) => [getKey(item), item]));
}

function excelCellToString(cell: ExcelJS.Cell) {
  if (cell.value instanceof Date) {
    return cell.value.toISOString().slice(0, 10);
  }
  return cell.text.trim();
}

export async function parseRosterRowsFromExcel(buffer: Buffer): Promise<RawImportRow[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  const worksheet = workbook.worksheets[0];

  if (!worksheet) {
    return [];
  }

  const headerRow = worksheet.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell({ includeEmpty: false }, (cell, column) => {
    headers[column - 1] = excelCellToString(cell);
  });

  const rows: RawImportRow[] = [];
  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const values: RawImportRow = {};
    let hasValue = false;

    headers.forEach((header, index) => {
      if (!header) return;
      const value = excelCellToString(row.getCell(index + 1));
      if (value) hasValue = true;
      values[header] = value;
    });

    if (hasValue) {
      rows.push(values);
    }
  }

  return rows;
}

export async function importRosterRows(rows: RawImportRow[], auth: AuthContext) {
  const [organizations, jobs, classes, children, guardianLinks] = await Promise.all([
    getCollectionMap("organizations"),
    getCollectionMap("jobs"),
    getCollectionMap("classes"),
    getCollectionMap("children"),
    getCollectionMap("guardianLinks")
  ]);

  const organizationByName = mapByName(organizations, (item) => key(item.name || ""));
  const jobByOrgAndTitle = mapByName(jobs, (item) => key(item.orgId || "", item.title || ""));
  const classByJobAndName = mapByName(classes, (item) => key(item.orgId || "", item.jobId || "", item.name || ""));
  const childByClassAndName = mapByName(children, (item) =>
    key(item.orgId || "", item.jobId || "", item.classId || "", item.name || item.title || "")
  );
  children.forEach((child) => {
    const displayName = normalizeText((child as { displayName?: unknown }).displayName);
    if (displayName) {
      childByClassAndName.set(key(child.orgId || "", child.jobId || "", child.classId || "", displayName), child);
    }
  });
  const guardianLinkKeys = new Set(
    guardianLinks
      .filter((item) => !item.revokedAt)
      .map((item) => key(item.emailLower || "", item.orgId || "", item.jobId || "", item.classId || "", item.childId || ""))
  );

  const result = {
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
    errors: [] as Array<{ rowNumber: number; message: string }>
  };

  for (const [index, row] of rows.entries()) {
    let parsed: ParsedImportRow;
    try {
      parsed = parseRow(row, index + 1);
    } catch (error) {
      result.skippedRows += 1;
      result.errors.push({
        rowNumber: index + 2,
        message: error instanceof Error ? error.message : "Zeile konnte nicht gelesen werden."
      });
      continue;
    }

    try {
      let organization = organizationByName.get(key(parsed.organizationName));
      if (!organization) {
        const id = randomId();
        organization = { id, name: parsed.organizationName };
        await adminDb().collection("organizations").doc(id).set({
          name: parsed.organizationName,
          type: parsed.organizationType,
          createdAt: serverTimestamp(),
          createdByUid: auth.uid
        });
        organizationByName.set(key(parsed.organizationName), organization);
        result.created.organizations += 1;
      }

      let job = jobByOrgAndTitle.get(key(organization.id || "", parsed.jobTitle));
      if (!job) {
        const id = randomId();
        job = { id, orgId: organization.id, title: parsed.jobTitle };
        await adminDb().collection("jobs").doc(id).set({
          orgId: organization.id,
          title: parsed.jobTitle,
          date: parsed.jobDate,
          retentionUntil: null,
          status: "draft",
          createdAt: serverTimestamp(),
          createdByUid: auth.uid
        });
        jobByOrgAndTitle.set(key(organization.id || "", parsed.jobTitle), job);
        result.created.jobs += 1;
      }

      let schoolClass = classByJobAndName.get(key(organization.id || "", job.id || "", parsed.className));
      if (!schoolClass) {
        const id = randomId();
        schoolClass = { id, orgId: organization.id, jobId: job.id, name: parsed.className };
        await adminDb().collection("classes").doc(id).set({
          orgId: organization.id,
          jobId: job.id,
          name: parsed.className,
          teacherName: parsed.teacherName,
          createdAt: serverTimestamp(),
          createdByUid: auth.uid
        });
        classByJobAndName.set(key(organization.id || "", job.id || "", parsed.className), schoolClass);
        result.created.classes += 1;
      }

      let child = childByClassAndName.get(
        key(organization.id || "", job.id || "", schoolClass.id || "", parsed.childName)
      );
      if (!child) {
        const id = randomId();
        child = {
          id,
          orgId: organization.id,
          jobId: job.id,
          classId: schoolClass.id,
          name: parsed.childName
        };
        await adminDb().collection("children").doc(id).set({
          orgId: organization.id,
          jobId: job.id,
          classId: schoolClass.id,
          displayName: parsed.childName,
          createdAt: serverTimestamp(),
          createdByUid: auth.uid
        });
        childByClassAndName.set(key(organization.id || "", job.id || "", schoolClass.id || "", parsed.childName), child);
        result.created.children += 1;
      }

      const emailLower = normalizeEmail(parsed.guardianEmail);
      const linkKey = key(emailLower, organization.id || "", job.id || "", schoolClass.id || "", child.id || "");
      if (!guardianLinkKeys.has(linkKey)) {
        const id = randomId();
        await adminDb().collection("guardianLinks").doc(id).set({
          email: parsed.guardianEmail,
          emailLower,
          orgId: organization.id,
          jobId: job.id,
          classId: schoolClass.id,
          childId: child.id,
          createdAt: serverTimestamp(),
          createdByUid: auth.uid,
          revokedAt: null
        });
        guardianLinkKeys.add(linkKey);
        result.created.guardianLinks += 1;
      }

      result.importedRows += 1;
    } catch (error) {
      result.skippedRows += 1;
      result.errors.push({
        rowNumber: parsed.rowNumber,
        message: error instanceof Error ? error.message : "Zeile konnte nicht importiert werden."
      });
    }
  }

  await writeAuditLog(auth, "admin.import.roster", "stammdaten", "bulk", {
    receivedRows: result.receivedRows,
    importedRows: result.importedRows,
    skippedRows: result.skippedRows,
    created: result.created
  });

  return result;
}
