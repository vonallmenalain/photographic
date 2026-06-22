import { NextFunction, Request, Response } from "express";
import { adminAuth } from "../lib/firebaseAdmin";
import { normalizeEmail, isAdminEmail } from "../lib/admin";
import { AuthenticatedRequest } from "../lib/auth";
import { AppError } from "../lib/response";

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.header("authorization") || "";
    const match = header.match(/^Bearer\s+(.+)$/i);
    if (!match) {
      throw new AppError(401, "AUTH_REQUIRED", "Bitte melde dich erneut an.");
    }

    const decoded = await adminAuth().verifyIdToken(match[1]);
    const email = decoded.email;
    const emailVerified = decoded.email_verified === true;

    if (!email || !emailVerified) {
      throw new AppError(
        403,
        "EMAIL_NOT_VERIFIED",
        "Bitte verwende eine verifizierte E-Mail-Adresse."
      );
    }

    const emailLower = normalizeEmail(email);
    (req as AuthenticatedRequest).auth = {
      uid: decoded.uid,
      email,
      emailLower,
      emailVerified,
      role: isAdminEmail(emailLower) ? "admin" : "guardian"
    };

    next();
  } catch (error) {
    next(error);
  }
}
