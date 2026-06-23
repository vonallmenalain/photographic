import fs from "node:fs";
import { NextFunction, Request, Response, Router } from "express";
import { getAuthContext } from "../lib/auth";
import { writeAuditLog } from "../lib/audit";
import {
  canAccessPhoto,
  getActiveGuardianLinks,
  getPhoto,
  hasPaidOriginalAccess
} from "../lib/firestore";
import { AppError, asyncHandler, routeParam } from "../lib/response";
import { ensureReadableFile } from "../lib/storage";

export const photosRouter = Router();

function streamProtectedImage(kind: "thumb" | "preview") {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const auth = getAuthContext(req);
      const photoId = routeParam(req, "photoId");
      const photo = await getPhoto(photoId);
      if (!photo) {
        throw new AppError(404, "PHOTO_NOT_FOUND", "Das Foto wurde nicht gefunden.");
      }

      const guardianLinks =
        auth.role === "admin" ? [] : await getActiveGuardianLinks(auth.emailLower);
      if (!canAccessPhoto(auth, photo, guardianLinks)) {
        throw new AppError(403, "PHOTO_FORBIDDEN", "Du hast keinen Zugriff auf dieses Foto.");
      }

      if (photo.processingStatus === "error") {
        throw new AppError(404, "PHOTO_NOT_AVAILABLE", "Die Vorschau ist nicht verfuegbar.");
      }

      const relativePath = kind === "thumb" ? photo.thumbPath : photo.previewPath;
      const absolutePath = await ensureReadableFile(relativePath);

      res.setHeader("Content-Type", "image/webp");
      res.setHeader("Cache-Control", "private, no-store");
      await writeAuditLog(auth, `guardian.view.${kind}`, "photo", photo.id || photoId, {
        kind
      });

      fs.createReadStream(absolutePath).on("error", next).pipe(res);
    } catch (error) {
      next(error);
    }
  };
}

function safeDownloadFilename(filename: string | undefined, photoId: string) {
  const safeName = (filename || `${photoId}.jpg`)
    .replace(/[\r\n"]/g, "_")
    .replace(/[^A-Za-z0-9._ -]/g, "_")
    .slice(0, 180);

  return safeName || `${photoId}.jpg`;
}

photosRouter.get("/:photoId/thumb", streamProtectedImage("thumb"));
photosRouter.get("/:photoId/preview", streamProtectedImage("preview"));

photosRouter.get(
  "/:photoId/original",
  asyncHandler(async (req, res, next) => {
    const auth = getAuthContext(req);
    const photoId = routeParam(req, "photoId");
    const photo = await getPhoto(photoId);
    if (!photo) {
      throw new AppError(404, "PHOTO_NOT_FOUND", "Das Foto wurde nicht gefunden.");
    }

    const guardianLinks =
      auth.role === "admin" ? [] : await getActiveGuardianLinks(auth.emailLower);
    if (!canAccessPhoto(auth, photo, guardianLinks)) {
      throw new AppError(403, "PHOTO_FORBIDDEN", "Du hast keinen Zugriff auf dieses Foto.");
    }

    if (!(await hasPaidOriginalAccess(auth, photo))) {
      throw new AppError(
        402,
        "ORIGINAL_NOT_PAID",
        "Das Original kann erst nach bezahlter Bestellung heruntergeladen werden."
      );
    }

    const absolutePath = await ensureReadableFile(photo.originalPath);
    const filename = safeDownloadFilename(photo.originalFilename, photo.id || photoId);

    res.setHeader("Content-Type", photo.originalMimeType || "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Cache-Control", "private, no-store");
    await writeAuditLog(auth, "guardian.download.original", "photo", photo.id || photoId, {
      paid: auth.role !== "admin"
    });

    fs.createReadStream(absolutePath).on("error", next).pipe(res);
  })
);
