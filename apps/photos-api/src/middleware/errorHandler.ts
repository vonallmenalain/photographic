import { NextFunction, Request, Response } from "express";
import multer from "multer";
import { ZodError } from "zod";
import { AppError } from "../lib/response";
import { getRequestId } from "./requestId";

type ClassifiedError = {
  status: number;
  code: string;
  message: string;
};

export function notFoundHandler(req: Request, _res: Response, next: NextFunction) {
  next(new AppError(404, "NOT_FOUND", `Route ${req.method} ${req.path} wurde nicht gefunden.`));
}

function sendError(
  res: Response,
  status: number,
  code: string,
  message: string,
  requestId: string
) {
  return res.status(status).json({
    ok: false,
    error: {
      code,
      message,
      requestId
    }
  });
}

function rawErrorCode(error: unknown) {
  const candidate = error as {
    code?: unknown;
    errorInfo?: { code?: unknown };
  };

  return String(candidate.errorInfo?.code || candidate.code || "");
}

function rawErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function classifyFirebaseAuthError(error: unknown): ClassifiedError | null {
  const code = rawErrorCode(error);
  if (!code.startsWith("auth/")) {
    return null;
  }

  if (code.includes("id-token-expired")) {
    return {
      status: 401,
      code: "AUTH_TOKEN_EXPIRED",
      message: "Deine Anmeldung ist abgelaufen. Bitte melde dich erneut an."
    };
  }

  if (code.includes("project-not-found") || code.includes("invalid-credential")) {
    return {
      status: 500,
      code: "FIREBASE_PROJECT_MISMATCH",
      message: "Die Firebase-Konfiguration der API passt nicht zum Projekt."
    };
  }

  return {
    status: 401,
    code: "AUTH_TOKEN_INVALID",
    message: "Das Anmeldetoken ist ungueltig. Bitte melde dich erneut an."
  };
}

function classifyFirestoreError(error: unknown): ClassifiedError | null {
  const code = rawErrorCode(error);
  const message = rawErrorMessage(error);
  const haystack = `${code} ${message}`;

  if (/permission[_ -]?denied|iam|7\b/i.test(haystack)) {
    return {
      status: 403,
      code: "FIRESTORE_PERMISSION_DENIED",
      message: "Firestore hat den Zugriff verweigert. Bitte pruefe Service Account und IAM-Rechte."
    };
  }

  if (/unavailable|deadline|timeout|network|14\b/i.test(haystack)) {
    return {
      status: 503,
      code: "FIRESTORE_UNAVAILABLE",
      message: "Firestore ist gerade nicht erreichbar. Bitte spaeter erneut versuchen."
    };
  }

  return null;
}

function classifyFilesystemError(error: unknown): ClassifiedError | null {
  const code = rawErrorCode(error);
  if (!code) {
    return null;
  }

  if (["EACCES", "EPERM", "EROFS"].includes(code)) {
    return {
      status: 500,
      code: "PHOTO_STORAGE_PERMISSION_DENIED",
      message: `Der Foto-Speicher ist nicht beschreibbar oder nicht loeschbar (${code}).`
    };
  }

  if (code === "ENOSPC") {
    return {
      status: 507,
      code: "PHOTO_STORAGE_FULL",
      message: "Auf dem Foto-Speicher ist kein Platz mehr frei."
    };
  }

  if (code === "ENOENT") {
    return {
      status: 404,
      code: "FILE_NOT_FOUND",
      message: "Die Bilddatei wurde nicht gefunden."
    };
  }

  return null;
}

function classifyImageProcessingError(error: unknown): ClassifiedError | null {
  const message = rawErrorMessage(error);
  if (!/sharp|unsupported image|input file|corrupt|invalid image|jpeg|png|webp|tiff/i.test(message)) {
    return null;
  }

  return {
    status: 400,
    code: "PHOTO_PROCESSING_FAILED",
    message: "Das Bild konnte nicht verarbeitet werden. Bitte pruefe Dateityp und Bilddatei."
  };
}

export function errorHandler(error: unknown, req: Request, res: Response, _next: NextFunction) {
  const requestId = getRequestId(req);

  if (error instanceof AppError) {
    return sendError(res, error.status, error.code, error.message, requestId);
  }

  if (error instanceof ZodError) {
    const details = error.issues
      .slice(0, 4)
      .map((issue) => {
        const field = issue.path.length > 0 ? issue.path.join(".") : "Daten";
        return `${field}: ${issue.message}`;
      })
      .join(" ");

    return sendError(
      res,
      400,
      "VALIDATION_ERROR",
      details
        ? `Bitte pruefe die eingegebenen Daten. ${details}`
        : "Bitte pruefe die eingegebenen Daten.",
      requestId
    );
  }

  if (error instanceof multer.MulterError) {
    return sendError(
      res,
      400,
      error.code === "LIMIT_FILE_SIZE" ? "UPLOAD_TOO_LARGE" : "UPLOAD_ERROR",
      error.code === "LIMIT_FILE_SIZE"
        ? "Die Datei ist zu gross."
        : "Die Datei konnte nicht verarbeitet werden.",
      requestId
    );
  }

  if (error instanceof Error && error.message.includes("childIds")) {
    return sendError(res, 400, "VALIDATION_ERROR", error.message, requestId);
  }

  const classified =
    classifyFirebaseAuthError(error) ||
    classifyFirestoreError(error) ||
    classifyFilesystemError(error) ||
    classifyImageProcessingError(error);

  if (classified) {
    console.error(`[${requestId}]`, error);
    return sendError(res, classified.status, classified.code, classified.message, requestId);
  }

  console.error(`[${requestId}]`, error);
  return sendError(
    res,
    500,
    "INTERNAL_ERROR",
    "Ein unerwarteter Fehler ist aufgetreten.",
    requestId
  );
}
