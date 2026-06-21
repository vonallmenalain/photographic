import type { DecodedIdToken } from "firebase-admin/auth";
import type { HandlerEvent } from "@netlify/functions";
import { adminAuth, adminDb } from "./firebaseAdmin";
import { HttpError } from "./responses";
import type { UserRole } from "../../src/types/domain";

export interface FunctionUser {
  uid: string;
  email?: string;
  role: UserRole;
  decodedToken: DecodedIdToken;
}

function getBearerToken(event: HandlerEvent): string {
  const header = event.headers.authorization ?? event.headers.Authorization;
  const match = header?.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    throw new HttpError(401, "Bitte melde dich an.");
  }

  return match[1]!;
}

export async function requireUser(event: HandlerEvent): Promise<FunctionUser> {
  const decodedToken = await adminAuth.verifyIdToken(getBearerToken(event));
  const profile = await adminDb.collection("users").doc(decodedToken.uid).get();
  const role = (profile.exists ? profile.get("role") : decodedToken.admin ? "admin" : "guardian") as UserRole;

  return {
    uid: decodedToken.uid,
    email: decodedToken.email,
    role,
    decodedToken
  };
}

export async function requireAdmin(event: HandlerEvent): Promise<FunctionUser> {
  const user = await requireUser(event);
  if (user.role !== "admin" && user.decodedToken.admin !== true) {
    throw new HttpError(403, "Admin-Rechte erforderlich.");
  }

  return user;
}
