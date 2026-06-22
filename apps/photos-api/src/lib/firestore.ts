import { adminDb } from "./firebaseAdmin";
import { AuthContext } from "./auth";
import { GuardianLinkRecord, PhotoRecord } from "../types/domain";

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

export async function getPhoto(photoId: string) {
  const doc = await adminDb().collection("photos").doc(photoId).get();
  if (!doc.exists) {
    return null;
  }

  return {
    id: doc.id,
    ...(doc.data() as PhotoRecord)
  };
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
  const allowedChildIds = new Set(activeLinks.map((link) => link.childId));
  const allowedClassIds = new Set(activeLinks.map((link) => link.classId));

  if (photo.visibility === "child") {
    return photo.childIds.some((childId) => allowedChildIds.has(childId));
  }

  if (photo.visibility === "class") {
    return allowedClassIds.has(photo.classId);
  }

  if (photo.visibility === "job") {
    return activeLinks.some(
      (link) => link.jobId === photo.jobId && link.classId === photo.classId
    );
  }

  return false;
}
