import { Router } from "express";
import { getAuthContext } from "../lib/auth";
import { writeAuditLog } from "../lib/audit";
import { adminDb } from "../lib/firebaseAdmin";
import { canAccessPhoto, getActiveGuardianLinks, listCollection } from "../lib/firestore";
import { asyncHandler, sendOk } from "../lib/response";
import { PhotoRecord } from "../types/domain";

export const galleryRouter = Router();

galleryRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const auth = getAuthContext(req);
    let photos: Array<PhotoRecord & { id: string }> = [];

    if (auth.role === "admin") {
      photos = (await listCollection<PhotoRecord>("photos")).filter(
        (photo) => photo.status === "published"
      ) as Array<PhotoRecord & { id: string }>;
      await writeAuditLog(auth, "guardian.list.gallery", "gallery", auth.uid, {
        count: photos.length,
        adminPreview: true
      });
    } else {
      const guardianLinks = await getActiveGuardianLinks(auth.emailLower);

      if (guardianLinks.length === 0) {
        await writeAuditLog(auth, "guardian.list.gallery", "gallery", auth.uid, { count: 0 });
        sendOk(res, {
          photos: [],
          message: "Fuer diese E-Mail-Adresse wurden noch keine Fotos freigegeben."
        });
        return;
      }

      const jobIds = [...new Set(guardianLinks.map((link) => link.jobId))];
      const snapshots = await Promise.all(
        jobIds.map((jobId) => adminDb().collection("photos").where("jobId", "==", jobId).get())
      );
      const allPhotos = snapshots.flatMap((snapshot) =>
        snapshot.docs.map((doc) => ({ id: doc.id, ...(doc.data() as PhotoRecord) }))
      );

      photos = allPhotos.filter((photo) => canAccessPhoto(auth, photo, guardianLinks));
      await writeAuditLog(auth, "guardian.list.gallery", "gallery", auth.uid, {
        count: photos.length
      });
    }

    sendOk(res, {
      photos: photos.map((photo) => ({
        photoId: photo.id,
        jobId: photo.jobId,
        classId: photo.classId,
        type: photo.type,
        visibility: photo.visibility,
        hasThumb: Boolean(photo.thumbPath),
        hasPreview: Boolean(photo.previewPath)
      }))
    });
  })
);
