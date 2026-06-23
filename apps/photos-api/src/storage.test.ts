import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const photoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "photographic-storage-"));
process.env.PHOTO_ROOT = photoRoot;

let storageModule: Promise<typeof import("./lib/storage")> | null = null;

function storage() {
  storageModule ??= import("./lib/storage");
  return storageModule;
}

test("resolveInsidePhotoRoot blocks traversal", async () => {
  const { resolveInsidePhotoRoot } = await storage();

  assert.throws(
    () => resolveInsidePhotoRoot("../outside.jpg"),
    (error: unknown) => (error as { code?: string }).code === "PATH_TRAVERSAL_BLOCKED"
  );
});

test("writeBufferToRelativePath writes atomically inside PHOTO_ROOT", async () => {
  const { resolveInsidePhotoRoot, writeBufferToRelativePath } = await storage();
  const relativePath = "org_demo/job_demo/ph_demo/original/original.jpg";

  const absolutePath = await writeBufferToRelativePath(relativePath, Buffer.from("image-bytes"));
  assert.equal(absolutePath, resolveInsidePhotoRoot(relativePath));
  assert.equal(await fsp.readFile(absolutePath, "utf8"), "image-bytes");

  const files = await fsp.readdir(path.dirname(absolutePath));
  assert.deepEqual(files, ["original.jpg"]);
});

test("deletePhotoFiles distinguishes deleted and missing files", async () => {
  const { deletePhotoFiles, resolveInsidePhotoRoot, writeBufferToRelativePath } = await storage();
  const paths = {
    originalPath: "org_demo/job_demo/ph_delete/original/original.jpg",
    previewPath: "org_demo/job_demo/ph_delete/previews/preview.webp",
    thumbPath: "org_demo/job_demo/ph_delete/thumbs/thumb.webp"
  };

  await Promise.all([
    writeBufferToRelativePath(paths.originalPath, Buffer.from("original")),
    writeBufferToRelativePath(paths.previewPath, Buffer.from("preview")),
    writeBufferToRelativePath(paths.thumbPath, Buffer.from("thumb"))
  ]);

  const firstResult = await deletePhotoFiles(paths);
  assert.deepEqual(firstResult.deletedFiles.sort(), ["original", "preview", "thumb"]);
  assert.deepEqual(firstResult.missingFiles, []);
  await assert.rejects(fsp.stat(resolveInsidePhotoRoot(paths.originalPath)));

  const secondResult = await deletePhotoFiles(paths);
  assert.deepEqual(secondResult.deletedFiles, []);
  assert.deepEqual(secondResult.missingFiles.sort(), ["original", "preview", "thumb"]);
});
