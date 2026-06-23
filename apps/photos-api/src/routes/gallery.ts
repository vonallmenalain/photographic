import { Router } from "express";
import { getAuthContext } from "../lib/auth";
import { writeAuditLog } from "../lib/audit";
import { adminDb } from "../lib/firebaseAdmin";
import { canAccessPhoto, getActiveGuardianLinks, listCollection, listPhotos, normalizePhotoRecord } from "../lib/firestore";
import { buildPhotoReferenceSets, filterDisplayablePhotos } from "../lib/photoAvailability";
import { asyncHandler, sendOk } from "../lib/response";
import { ChildRecord, PhotoRecord } from "../types/domain";

export const galleryRouter = Router();

galleryRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const auth = getAuthContext(req);
    let photos: Array<PhotoRecord & { id: string }> = [];
    const [organizations, jobs, classes, children] = await Promise.all([
      listCollection("organizations"),
      listCollection("jobs"),
      listCollection("classes"),
      listCollection("children")
    ]);
    const references = buildPhotoReferenceSets({ organizations, jobs, classes, children });
    const childNameById = new Map(
      (children as Array<ChildRecord & { id: string }>).map((child) => [
        child.id,
        child.displayName || child.pseudonym || child.id
      ])
    );

    if (auth.role === "admin") {
      photos = (await listPhotos()) as Array<PhotoRecord & { id: string }>;
      const allCount = photos.length;
      photos = await filterDisplayablePhotos(photos, references);
      await writeAuditLog(auth, "guardian.list.gallery", "gallery", auth.uid, {
        count: photos.length,
        skippedUnavailable: allCount - photos.length,
        adminPreview: true
      });
    } else {
      const guardianLinks = await getActiveGuardianLinks(auth.emailLower);

      if (guardianLinks.length === 0) {
        await writeAuditLog(auth, "guardian.list.gallery", "gallery", auth.uid, { count: 0 });
        sendOk(res, {
          photos: [],
          message: "Für diese E-Mail-Adresse wurden noch keine Fotos freigegeben."
        });
        return;
      }

      const jobIds = [...new Set(guardianLinks.map((link) => link.jobId))];
      const snapshots = await Promise.all(
        jobIds.map((jobId) => adminDb().collection("photos").where("jobId", "==", jobId).get())
      );
      const allPhotos = snapshots.flatMap((snapshot) =>
        snapshot.docs.map(
          (doc) =>
            normalizePhotoRecord({ id: doc.id, ...(doc.data() as PhotoRecord) }) as PhotoRecord & {
              id: string;
            }
        )
      );

      photos = allPhotos.filter((photo) => canAccessPhoto(auth, photo, guardianLinks));
      const allowedCount = photos.length;
      photos = await filterDisplayablePhotos(photos, references);
      await writeAuditLog(auth, "guardian.list.gallery", "gallery", auth.uid, {
        count: photos.length,
        skippedUnavailable: allowedCount - photos.length
      });
    }

    sendOk(res, {
      photos: photos.map((photo) => ({
        photoId: photo.id,
        jobId: photo.jobId,
        classId: photo.classId,
        childNames: photo.childIds.map((childId) => childNameById.get(childId) || childId),
        type: photo.type,
        visibility: photo.visibility,
        hasThumb: Boolean(photo.thumbPath),
        hasPreview: Boolean(photo.previewPath)
      }))
    });
  })
);
