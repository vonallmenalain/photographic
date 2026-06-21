import type { Handler } from "@netlify/functions";
import { z } from "zod";
import { requireAdmin } from "../lib/auth";
import { writeAuditLog } from "../lib/audit";
import {
  createPresignedUploadUrl,
  getPhotoObjectKey,
  type PhotoVariant
} from "../lib/r2";
import { ensurePost, handleError, HttpError, json, parseBody } from "../lib/responses";

const schema = z.object({
  jobId: z.string().min(1),
  photoId: z.string().uuid(),
  variant: z.enum(["original", "preview", "thumb"]),
  contentType: z.string().regex(/^image\//)
});

export const handler: Handler = async (event) => {
  const earlyResponse = ensurePost(event);
  if (earlyResponse) {
    return earlyResponse;
  }

  try {
    const user = await requireAdmin(event);
    const input = schema.parse(parseBody(event));
    const key = getPhotoObjectKey(input.photoId, input.variant as PhotoVariant);

    if (input.variant === "original" && process.env.ALLOW_ORIGINAL_UPLOADS === "false") {
      throw new HttpError(403, "Original-Uploads sind deaktiviert.");
    }

    const uploadUrl = await createPresignedUploadUrl(key, input.contentType);

    await writeAuditLog(user.uid, "upload_url.created", "photo", input.photoId, {
      jobId: input.jobId,
      variant: input.variant,
      key
    });

    return json(200, { uploadUrl, key, expiresIn: 300 });
  } catch (error) {
    return handleError(error);
  }
};
