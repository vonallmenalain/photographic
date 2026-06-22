import { Request } from "express";
import { UserRole } from "../types/domain";
import { AppError } from "./response";

export type AuthContext = {
  uid: string;
  email: string;
  emailLower: string;
  emailVerified: boolean;
  role: UserRole;
};

export type AuthenticatedRequest = Request & {
  auth: AuthContext;
};

export function getAuthContext(req: Request) {
  const auth = (req as Partial<AuthenticatedRequest>).auth;
  if (!auth) {
    throw new AppError(401, "AUTH_REQUIRED", "Bitte melde dich erneut an.");
  }
  return auth;
}
