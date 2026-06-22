import { adminDb } from "../lib/firebaseAdmin";
import { createWatermarkedPreview } from "../lib/imageProcessing";
import { resolveInsidePhotoRoot } from "../lib/storage";
import { PhotoRecord } from "../types/domain";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function regeneratePreviews() {
  const snapshot = await adminDb().collection("photos").get();
  let regenerated = 0;
  let skipped = 0;
  let failed = 0;

  console.log(`Found ${snapshot.size} photo records.`);

  for (const doc of snapshot.docs) {
    const photo = doc.data() as Partial<PhotoRecord>;

    if (!photo.originalPath || !photo.previewPath) {
      skipped += 1;
      console.warn(`[skip] ${doc.id}: missing originalPath or previewPath`);
      continue;
    }

    try {
      const originalAbsolutePath = resolveInsidePhotoRoot(photo.originalPath);
      const previewAbsolutePath = resolveInsidePhotoRoot(photo.previewPath);

      await createWatermarkedPreview(originalAbsolutePath, previewAbsolutePath);
      regenerated += 1;
      console.log(`[ok] ${doc.id}: ${photo.previewPath}`);
    } catch (error) {
      failed += 1;
      console.error(`[failed] ${doc.id}: ${errorMessage(error)}`);
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
