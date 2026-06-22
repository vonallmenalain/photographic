import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { env } from "../config/env";
import { AppError } from "./response";

const SAFE_SEGMENT = /^[A-Za-z0-9_-]+$/;

export const allowedImageMimes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/tiff"
]);

export function extensionForMime(mime: string) {
  switch (mime) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/tiff":
      return "tiff";
    default:
      throw new AppError(400, "UNSUPPORTED_IMAGE_TYPE", "Dieser Bildtyp wird nicht unterstuetzt.");
  }
}

function assertSafeSegment(value: string, label: string) {
  if (!SAFE_SEGMENT.test(value)) {
    throw new AppError(400, "INVALID_ID", `${label} ist ungueltig.`);
  }
}

export function photoRelativePaths(orgId: string, jobId: string, photoId: string, originalExt: string) {
  assertSafeSegment(orgId, "Organisation");
  assertSafeSegment(jobId, "Fotoauftrag");
  assertSafeSegment(photoId, "Foto");

  const dir = path.posix.join(`org_${orgId}`, `job_${jobId}`, `ph_${photoId}`);
  return {
    dir,
    originalPath: path.posix.join(dir, `original.${originalExt}`),
    previewPath: path.posix.join(dir, "preview.webp"),
    thumbPath: path.posix.join(dir, "thumb.webp")
  };
}

export function resolveInsidePhotoRoot(relativePath: string) {
  if (!relativePath || path.isAbsolute(relativePath)) {
    throw new AppError(400, "INVALID_STORAGE_PATH", "Der Speicherpfad ist ungueltig.");
  }

  const photoRoot = path.resolve(env.PHOTO_ROOT);
  const normalizedRelative = relativePath.split(/[\\/]+/).join(path.sep);
  const resolved = path.resolve(photoRoot, normalizedRelative);

  if (resolved !== photoRoot && !resolved.startsWith(`${photoRoot}${path.sep}`)) {
    throw new AppError(400, "PATH_TRAVERSAL_BLOCKED", "Der Speicherpfad wurde blockiert.");
  }

  return resolved;
}

export async function writeBufferToRelativePath(relativePath: string, buffer: Buffer) {
  const absolutePath = resolveInsidePhotoRoot(relativePath);
  await fsp.mkdir(path.dirname(absolutePath), { recursive: true });
  await fsp.writeFile(absolutePath, buffer, { flag: "wx" });
  return absolutePath;
}

export async function ensureReadableFile(relativePath: string) {
  const absolutePath = resolveInsidePhotoRoot(relativePath);
  try {
    await fsp.access(absolutePath, fs.constants.R_OK);
  } catch {
    throw new AppError(404, "FILE_NOT_FOUND", "Die Bilddatei wurde nicht gefunden.");
  }
  return absolutePath;
}
