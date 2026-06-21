import type { User } from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type DocumentData,
  type DocumentSnapshot,
  type QueryConstraint
} from "firebase/firestore";
import { db } from "../firebase/config";
import type {
  AppUser,
  ChildRecord,
  GuardianAccess,
  Job,
  Organization,
  PhotoRecord,
  SchoolClass
} from "../types/domain";

export async function ensureUserProfile(user: User): Promise<AppUser> {
  const userRef = doc(db, "users", user.uid);
  const snapshot = await getDoc(userRef);

  if (!snapshot.exists()) {
    const profile: AppUser = {
      email: user.email,
      role: "guardian",
      createdAt: serverTimestamp(),
      lastLoginAt: serverTimestamp()
    };
    await setDoc(userRef, profile);
    return profile;
  }

  await setDoc(
    userRef,
    {
      email: user.email,
      lastLoginAt: serverTimestamp()
    },
    { merge: true }
  );

  return snapshot.data() as AppUser;
}

export async function updateLastLogin(user: User): Promise<void> {
  await updateDoc(doc(db, "users", user.uid), {
    email: user.email,
    lastLoginAt: serverTimestamp()
  });
}

export function withId<T>(snapshot: DocumentSnapshot<DocumentData>): T {
  return {
    id: snapshot.id,
    ...snapshot.data()
  } as T;
}

export async function listOrganizations(): Promise<Organization[]> {
  const snapshot = await getDocs(collection(db, "organizations"));
  return snapshot.docs.map((item) => withId<Organization>(item));
}

export async function listJobs(): Promise<Job[]> {
  const snapshot = await getDocs(collection(db, "jobs"));
  return snapshot.docs.map((item) => withId<Job>(item));
}

export async function listClasses(jobId?: string): Promise<SchoolClass[]> {
  const constraints: QueryConstraint[] = jobId ? [where("jobId", "==", jobId)] : [];
  const snapshot = await getDocs(query(collection(db, "classes"), ...constraints));
  return snapshot.docs.map((item) => withId<SchoolClass>(item));
}

export async function listChildren(jobId?: string): Promise<ChildRecord[]> {
  const constraints: QueryConstraint[] = jobId ? [where("jobId", "==", jobId)] : [];
  const snapshot = await getDocs(query(collection(db, "children"), ...constraints));
  return snapshot.docs.map((item) => withId<ChildRecord>(item));
}

export async function listGuardianAccess(uid: string, jobId: string): Promise<GuardianAccess[]> {
  const snapshot = await getDocs(
    query(
      collection(db, "guardianAccess"),
      where("uid", "==", uid),
      where("jobId", "==", jobId),
      where("revokedAt", "==", null)
    )
  );

  return snapshot.docs.map((item) => withId<GuardianAccess>(item));
}

export async function getJob(jobId: string): Promise<Job | null> {
  const snapshot = await getDoc(doc(db, "jobs", jobId));
  return snapshot.exists() ? withId<Job>(snapshot) : null;
}

export async function listPhotosForAdmin(jobId: string): Promise<PhotoRecord[]> {
  const snapshot = await getDocs(query(collection(db, "photos"), where("jobId", "==", jobId)));
  return snapshot.docs.map((item) => withId<PhotoRecord>(item));
}

export function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}
