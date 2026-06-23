import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";
import { generatePhotoDerivatives } from "./lib/imageProcessing";

test("generatePhotoDerivatives creates preview and thumbnail from a synthetic jpeg", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "photographic-image-"));
  const originalPath = path.join(dir, "original.jpg");
  const previewPath = path.join(dir, "preview.webp");
  const thumbPath = path.join(dir, "thumb.webp");

  await sharp({
    create: {
      width: 640,
      height: 480,
      channels: 3,
      background: "#88b7d5"
    }
  })
    .jpeg()
    .toFile(originalPath);

  const result = await generatePhotoDerivatives(originalPath, previewPath, thumbPath);

  assert.equal(result.width, 640);
  assert.equal(result.height, 480);
  assert.ok(result.preview.fileSize > 0);
  assert.ok(result.thumb.fileSize > 0);
  assert.ok((await fsp.stat(previewPath)).size > 0);
  assert.ok((await fsp.stat(thumbPath)).size > 0);
});

test("generatePhotoDerivatives rejects corrupt image input", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "photographic-corrupt-"));
  const originalPath = path.join(dir, "corrupt.jpg");
  const previewPath = path.join(dir, "preview.webp");
  const thumbPath = path.join(dir, "thumb.webp");

  await fsp.writeFile(originalPath, "not an image");

  await assert.rejects(generatePhotoDerivatives(originalPath, previewPath, thumbPath));
  await assert.rejects(fsp.stat(previewPath));
  await assert.rejects(fsp.stat(thumbPath));
});
