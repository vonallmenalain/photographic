import { NextFunction, Request, Response } from "express";
import multer from "multer";
import { ZodError } from "zod";
import { AppError } from "../lib/response";

export function notFoundHandler(req: Request, _res: Response, next: NextFunction) {
  next(new AppError(404, "NOT_FOUND", `Route ${req.method} ${req.path} wurde nicht gefunden.`));
}

export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (error instanceof AppError) {
    return res.status(error.status).json({
      ok: false,
      error: {
        code: error.code,
        message: error.message
      }
    });
  }

  if (error instanceof ZodError) {
    return res.status(400).json({
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Bitte pruefe die eingegebenen Daten."
      }
    });
  }

  if (error instanceof multer.MulterError) {
    return res.status(400).json({
      ok: false,
      error: {
        code: "UPLOAD_ERROR",
        message:
          error.code === "LIMIT_FILE_SIZE"
            ? "Die Datei ist zu gross."
            : "Die Datei konnte nicht verarbeitet werden."
      }
    });
  }

  if (error instanceof Error && error.message.includes("childIds")) {
    return res.status(400).json({
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
        message: error.message
      }
    });
  }

  console.error(error);
  return res.status(500).json({
    ok: false,
    error: {
      code: "INTERNAL_ERROR",
      message: "Ein unerwarteter Fehler ist aufgetreten."
    }
  });
}
