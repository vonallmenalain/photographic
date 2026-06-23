import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
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
    originalPath: path.posix.join(dir, "original", `original.${originalExt}`),
    previewPath: path.posix.join(dir, "previews", "preview.webp"),
    thumbPath: path.posix.join(dir, "thumbs", "thumb.webp")
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

export type PhotoFilePaths = {
  originalPath?: string | null;
  previewPath?: string | null;
  thumbPath?: string | null;
};

export type PhotoStorageStatus = {
  original: boolean;
  preview: boolean;
  thumb: boolean;
  complete: boolean;
};

export async function relativeFileExists(relativePath?: string | null) {
  if (!relativePath) {
    return false;
  }

  try {
    const absolutePath = resolveInsidePhotoRoot(relativePath);
    await fsp.access(absolutePath, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

export async function getPhotoStorageStatus(paths: PhotoFilePaths): Promise<PhotoStorageStatus> {
  const [original, preview, thumb] = await Promise.all([
    relativeFileExists(paths.originalPath),
    relativeFileExists(paths.previewPath),
    relativeFileExists(paths.thumbPath)
  ]);

  return {
    original,
    preview,
    thumb,
    complete: original && preview && thumb
  };
}

async function deleteRelativeFileIfExists(relativePath?: string | null) {
  if (!relativePath) {
    return false;
  }

  try {
    const absolutePath = resolveInsidePhotoRoot(relativePath);
    await fsp.unlink(absolutePath);
    return true;
  } catch {
    return false;
  }
}

export async function deletePhotoFiles(paths: PhotoFilePaths) {
  const [originalDeleted, previewDeleted, thumbDeleted] = await Promise.all([
    deleteRelativeFileIfExists(paths.originalPath),
    deleteRelativeFileIfExists(paths.previewPath),
    deleteRelativeFileIfExists(paths.thumbPath)
  ]);
  const cleanupDirs = [
    paths.originalPath ? path.posix.dirname(paths.originalPath) : "",
    paths.previewPath ? path.posix.dirname(paths.previewPath) : "",
    paths.thumbPath ? path.posix.dirname(paths.thumbPath) : ""
  ].filter(Boolean);

  for (const dir of cleanupDirs) {
    try {
      await fsp.rmdir(resolveInsidePhotoRoot(dir));
    } catch {
      // Directory cleanup is best-effort; non-empty or missing folders are fine.
    }
  }

  const firstPath = paths.originalPath || paths.previewPath || paths.thumbPath;
  const photoDir = firstPath ? path.posix.dirname(path.posix.dirname(firstPath)) : "";
  if (photoDir && photoDir !== ".") {
    try {
      await fsp.rmdir(resolveInsidePhotoRoot(photoDir));
    } catch {
      // Directory cleanup is best-effort; non-empty or missing folders are fine.
    }
  }

  return {
    originalDeleted,
    previewDeleted,
    thumbDeleted
  };
}

export async function writeBufferToRelativePath(relativePath: string, buffer: Buffer) {
  const absolutePath = resolveInsidePhotoRoot(relativePath);
  await fsp.mkdir(path.dirname(absolutePath), { recursive: true });
  const parsed = path.parse(absolutePath);
  const tempPath = path.join(parsed.dir, `.${parsed.name}.${randomUUID()}.tmp${parsed.ext}`);

  try {
    await fsp.writeFile(tempPath, buffer, { flag: "wx" });
    try {
      await fsp.access(absolutePath);
      throw new AppError(409, "FILE_ALREADY_EXISTS", "Die Bilddatei existiert bereits.");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
    await fsp.rename(tempPath, absolutePath);
  } catch (error) {
    try {
      await fsp.unlink(tempPath);
    } catch {
      // Best effort cleanup only.
    }
    throw error;
  }
  return absolutePath;
}

export async function getRelativeFileSize(relativePath?: string | null) {
  if (!relativePath) {
    return 0;
  }

  const absolutePath = resolveInsidePhotoRoot(relativePath);
  const stat = await fsp.stat(absolutePath);
  return stat.size;
}

export async function ensureReadableFile(relativePath?: string | null) {
  if (!relativePath) {
    throw new AppError(404, "FILE_NOT_FOUND", "Die Bilddatei wurde nicht gefunden.");
  }

  const absolutePath = resolveInsidePhotoRoot(relativePath);
  try {
    await fsp.access(absolutePath, fs.constants.R_OK);
  } catch {
    throw new AppError(404, "FILE_NOT_FOUND", "Die Bilddatei wurde nicht gefunden.");
  }
  return absolutePath;
}
