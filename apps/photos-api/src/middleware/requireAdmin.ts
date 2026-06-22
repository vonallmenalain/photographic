import { NextFunction, Request, Response } from "express";
import { getAuthContext } from "../lib/auth";
import { AppError } from "../lib/response";

export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  try {
    const auth = getAuthContext(req);
    if (auth.role !== "admin") {
      throw new AppError(
        403,
        "ADMIN_REQUIRED",
        "Diese Aktion ist nur fuer Administratorinnen und Administratoren erlaubt."
      );
    }
    next();
  } catch (error) {
    next(error);
  }
}
