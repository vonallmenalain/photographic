import { adminDb } from "./firebaseAdmin";
import { AuthContext } from "./auth";
import { GuardianLinkRecord, OrderRecord, PhotoRecord, PhotoType, PhotoVisibility } from "../types/domain";

const PAID_ORDER_STATUSES = new Set(["paid", "completed", "fulfilled"]);
const PHOTO_TYPES = new Set<PhotoType>(["portrait", "sibling", "class", "classMirror", "event"]);
const PHOTO_VISIBILITIES = new Set<PhotoVisibility>(["child", "class", "job"]);

export function serializeFirestore(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === "object" && "toDate" in value && typeof value.toDate === "function") {
    return value.toDate().toISOString();
  }

  if (Array.isArray(value)) {
    return value.map(serializeFirestore);
  }

  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        serializeFirestore(entry)
      ])
    );
  }

  return value;
}

export async function listCollection<T extends Record<string, unknown>>(collectionName: string) {
  const snapshot = await adminDb().collection(collectionName).get();
  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...(serializeFirestore(doc.data()) as T)
  }));
}

function optionalString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function optionalNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function normalizePhotoRecord(input: Partial<PhotoRecord> & { id?: string }) {
  const type = PHOTO_TYPES.has(input.type as PhotoType) ? (input.type as PhotoType) : "portrait";
  const visibility = PHOTO_VISIBILITIES.has(input.visibility as PhotoVisibility)
    ? (input.visibility as PhotoVisibility)
    : "child";
  const childIds = Array.isArray(input.childIds)
    ? input.childIds.filter((childId): childId is string => typeof childId === "string")
    : [];

  return {
    ...input,
    id: input.id,
    orgId: optionalString(input.orgId),
    jobId: optionalString(input.jobId),
    classId: optionalString(input.classId),
    childIds,
    type,
    visibility,
    originalPath: optionalString(input.originalPath),
    previewPath: input.previewPath || null,
    thumbPath: input.thumbPath || null,
    originalFilename: optionalString(input.originalFilename),
    originalMimeType: optionalString(input.originalMimeType),
    originalSize: optionalNumber(input.originalSize) ?? 0,
    width: optionalNumber(input.width),
    height: optionalNumber(input.height),
    fileSizeOriginal: optionalNumber(input.fileSizeOriginal),
    fileSizePreview: optionalNumber(input.fileSizePreview),
    fileSizeThumb: optionalNumber(input.fileSizeThumb),
    processingStatus: input.processingStatus === "error" ? "error" : "ready",
    processingError: typeof input.processingError === "string" ? input.processingError : null,
    createdByUid: optionalString(input.createdByUid)
  } satisfies PhotoRecord & { id?: string };
}

export async function listPhotos() {
  const snapshot = await adminDb().collection("photos").get();
  return snapshot.docs.map((doc) =>
    normalizePhotoRecord({
      id: doc.id,
      ...(serializeFirestore(doc.data()) as Partial<PhotoRecord>)
    })
  );
}

export async function getPhoto(photoId: string) {
  const doc = await adminDb().collection("photos").doc(photoId).get();
  if (!doc.exists) {
    return null;
  }

  return normalizePhotoRecord({
    id: doc.id,
    ...(doc.data() as PhotoRecord)
  });
}

export async function getActiveGuardianLinks(emailLower: string) {
  const snapshot = await adminDb()
    .collection("guardianLinks")
    .where("emailLower", "==", emailLower)
    .get();

  return snapshot.docs
    .map((doc) => ({ id: doc.id, ...(doc.data() as GuardianLinkRecord) }))
    .filter((link) => !link.revokedAt);
}

export function canAccessPhoto(
  auth: AuthContext,
  photo: PhotoRecord,
  guardianLinks: GuardianLinkRecord[]
) {
  if (auth.role === "admin") {
    return true;
  }

  const activeLinks = guardianLinks.filter((link) => !link.revokedAt);

  if (photo.visibility === "child") {
    return photo.childIds.some((childId) =>
      activeLinks.some(
        (link) =>
          link.orgId === photo.orgId &&
          link.jobId === photo.jobId &&
          link.classId === photo.classId &&
          link.childId === childId
      )
    );
  }

  if (photo.visibility === "class") {
    return activeLinks.some(
      (link) =>
        link.orgId === photo.orgId &&
        link.jobId === photo.jobId &&
        link.classId === photo.classId
    );
  }

  if (photo.visibility === "job") {
    return activeLinks.some((link) => link.orgId === photo.orgId && link.jobId === photo.jobId);
  }

  return false;
}

export async function hasPaidOriginalAccess(auth: AuthContext, photo: PhotoRecord) {
  if (auth.role === "admin") {
    return true;
  }

  const snapshot = await adminDb()
    .collection("orders")
    .where("emailLower", "==", auth.emailLower)
    .get();

  return snapshot.docs.some((doc) => {
    const order = doc.data() as OrderRecord;

    return (
      order.jobId === photo.jobId &&
      PAID_ORDER_STATUSES.has(order.status) &&
      order.items.some((item) => item.photoId === (photo.id || photo.photoId))
    );
  });
}
