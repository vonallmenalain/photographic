import fs from "node:fs";
import { NextFunction, Request, Response, Router } from "express";
import { getAuthContext } from "../lib/auth";
import { writeAuditLog } from "../lib/audit";
import { canAccessPhoto, getActiveGuardianLinks, getPhoto } from "../lib/firestore";
import { AppError, asyncHandler, routeParam, sendOk } from "../lib/response";
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

photosRouter.get("/:photoId/thumb", streamProtectedImage("thumb"));
photosRouter.get("/:photoId/preview", streamProtectedImage("preview"));

photosRouter.get(
  "/:photoId/original",
  asyncHandler(async (_req, res) => {
    sendOk(
      res,
      {
        message: "Original-Download wird erst nach Zahlung aktiviert."
      },
      501
    );
  })
);
