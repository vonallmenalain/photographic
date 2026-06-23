import fs from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { adminDb, serverTimestamp } from "../lib/firebaseAdmin";
import {
  createThumbnail,
  createWatermarkedPreview,
  readOriginalImageDimensions
} from "../lib/imageProcessing";
import {
  getRelativeFileSize,
  relativeFileExists,
  resolveInsidePhotoRoot
} from "../lib/storage";
import { PhotoRecord } from "../types/domain";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function hasFlag(name: string) {
  return process.argv.includes(name);
}

function optionNumber(prefix: string) {
  const arg = process.argv.find((entry) => entry.startsWith(prefix));
  if (!arg) {
    return null;
  }

  const parsed = Number(arg.slice(prefix.length));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeRelativePath(relativePath: string) {
  return relativePath.split(/[\\/]+/).join("/");
}

function basePhotoDirFromOriginal(originalPath: string) {
  const normalized = normalizeRelativePath(originalPath);
  const parts = normalized.split("/");
  const originalDirIndex = parts.lastIndexOf("original");

  if (originalDirIndex > 0) {
    return parts.slice(0, originalDirIndex).join("/");
  }

  return path.posix.dirname(normalized);
}

function derivativePaths(photo: Partial<PhotoRecord>) {
  if (!photo.originalPath) {
    throw new Error("missing originalPath");
  }

  const baseDir = basePhotoDirFromOriginal(photo.originalPath);
  return {
    previewPath: photo.previewPath || path.posix.join(baseDir, "previews", "preview.webp"),
    thumbPath: photo.thumbPath || path.posix.join(baseDir, "thumbs", "thumb.webp")
  };
}

async function sha256File(filePath: string) {
  return new Promise<string>((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = fs.createReadStream(filePath);

    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function regeneratePreviews() {
  const overwrite = hasFlag("--overwrite");
  const limit = optionNumber("--limit=");
  const snapshot = await adminDb().collection("photos").get();
  let processed = 0;
  let regenerated = 0;
  let skipped = 0;
  let failed = 0;

  console.log(
    `Found ${snapshot.size} photo records. overwrite=${overwrite ? "yes" : "no"}${
      limit ? ` limit=${limit}` : ""
    }`
  );

  for (const doc of snapshot.docs) {
    if (limit && processed >= limit) {
      break;
    }

    const photo = doc.data() as Partial<PhotoRecord>;

    try {
      if (!photo.originalPath) {
        throw new Error("missing originalPath");
      }

      const originalExists = await relativeFileExists(photo.originalPath);
      if (!originalExists) {
        throw new Error(`original file missing: ${photo.originalPath}`);
      }

      const { previewPath, thumbPath } = derivativePaths(photo);
      const [previewExists, thumbExists] = await Promise.all([
        relativeFileExists(previewPath),
        relativeFileExists(thumbPath)
      ]);
      const shouldRegeneratePreview = overwrite || !previewExists;
      const shouldRegenerateThumb = overwrite || !thumbExists;
      const shouldRepairMetadata = !photo.previewPath || !photo.thumbPath;

      if (!shouldRegeneratePreview && !shouldRegenerateThumb && !shouldRepairMetadata) {
        skipped += 1;
        console.log(`[skip] ${doc.id}: preview and thumb already exist`);
        continue;
      }

      processed += 1;
      const originalAbsolutePath = resolveInsidePhotoRoot(photo.originalPath);
      const previewAbsolutePath = resolveInsidePhotoRoot(previewPath);
      const thumbAbsolutePath = resolveInsidePhotoRoot(thumbPath);

      const preview = shouldRegeneratePreview
        ? await createWatermarkedPreview(originalAbsolutePath, previewAbsolutePath, {
            overwrite: overwrite && previewExists
          })
        : null;
      const thumb = shouldRegenerateThumb
        ? await createThumbnail(originalAbsolutePath, thumbAbsolutePath, {
            overwrite: overwrite && thumbExists
          })
        : null;
      const dimensions = await readOriginalImageDimensions(originalAbsolutePath);
      const [fileSizeOriginal, fileSizePreview, fileSizeThumb] = await Promise.all([
        getRelativeFileSize(photo.originalPath),
        preview ? Promise.resolve(preview.fileSize) : getRelativeFileSize(previewPath),
        thumb ? Promise.resolve(thumb.fileSize) : getRelativeFileSize(thumbPath)
      ]);

      await doc.ref.update({
        photoId: photo.photoId || doc.id,
        albumId: photo.albumId || photo.jobId || "",
        schoolId: photo.schoolId || photo.orgId || "",
        previewPath,
        thumbPath,
        width: dimensions.width || preview?.width || photo.width || 0,
        height: dimensions.height || preview?.height || photo.height || 0,
        fileSizeOriginal,
        fileSizePreview,
        fileSizeThumb,
        processingStatus: "ready",
        processingError: null,
        checksumSha256: photo.checksumSha256 || (await sha256File(originalAbsolutePath)),
        uploadedAt: photo.uploadedAt || serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      regenerated += 1;
      console.log(
        `[ok] ${doc.id}: preview=${shouldRegeneratePreview ? "generated" : "kept"} thumb=${
          shouldRegenerateThumb ? "generated" : "kept"
        }`
      );
    } catch (error) {
      failed += 1;
      const message = errorMessage(error);
      console.error(`[failed] ${doc.id}: ${message}`);

      await doc.ref.update({
        processingStatus: "error",
        processingError: message,
        updatedAt: serverTimestamp()
      });
    }
  }

  console.log(`Done. regenerated=${regenerated} skipped=${skipped} failed=${failed}`);

  if (failed > 0) {
    process.exitCode = 1;
  }
}

regeneratePreviews().catch((error: unknown) => {
  console.error(`Fatal preview regeneration error: ${errorMessage(error)}`);
  process.exitCode = 1;
});
