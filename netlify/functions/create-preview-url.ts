import type { Handler } from "@netlify/functions";
import { z } from "zod";
import { requireUser } from "../lib/auth";
import { writeAuditLog } from "../lib/audit";
import { adminDb } from "../lib/firebaseAdmin";
import { createPresignedReadUrl } from "../lib/r2";
import { ensurePost, handleError, HttpError, json, parseBody } from "../lib/responses";

const schema = z.object({
  photoId: z.string().min(1),
  variant: z.enum(["preview", "thumb"])
});

export const handler: Handler = async (event) => {
  const earlyResponse = ensurePost(event);
  if (earlyResponse) {
    return earlyResponse;
  }

  try {
    const user = await requireUser(event);
    const input = schema.parse(parseBody(event));
    const photoDoc = await adminDb.collection("photos").doc(input.photoId).get();

    if (!photoDoc.exists) {
      throw new HttpError(404, "Foto nicht gefunden.");
    }

    const photo = photoDoc.data()!;
    if (photo.status !== "published" && user.role !== "admin") {
      throw new HttpError(403, "Foto ist nicht freigegeben.");
    }

    if (user.role !== "admin") {
      const allowed = await canReadPhoto(user.uid, photo);
      if (!allowed) {
        throw new HttpError(403, "Kein Zugriff auf dieses Foto.");
      }
    }

    const key = input.variant === "preview" ? photo.previewKey : photo.thumbKey;
    if (!key) {
      throw new HttpError(404, "Bildvariante fehlt.");
    }

    const url = await createPresignedReadUrl(key);

    await writeAuditLog(user.uid, "preview_url.created", "photo", input.photoId, {
      variant: input.variant,
      jobId: photo.jobId
    });

    return json(200, { url, expiresIn: 120 });
  } catch (error) {
    return handleError(error);
  }
};

async function canReadPhoto(uid: string, photo: FirebaseFirestore.DocumentData): Promise<boolean> {
  if (photo.visibility === "job") {
    return hasActiveAccess(`${uid}_${photo.jobId}_job`);
  }

  if (photo.visibility === "class") {
    return hasActiveAccess(`${uid}_${photo.jobId}_class_${photo.classId}`);
  }

  if (photo.visibility === "child") {
    const childIds = Array.isArray(photo.childIds) ? photo.childIds : [];
    for (const childId of childIds) {
      if (await hasActiveAccess(`${uid}_${photo.jobId}_${childId}`)) {
        return true;
      }
    }
  }

  return false;
}

async function hasActiveAccess(accessId: string): Promise<boolean> {
  const snapshot = await adminDb.collection("guardianAccess").doc(accessId).get();
  return snapshot.exists && snapshot.get("revokedAt") === null;
}
