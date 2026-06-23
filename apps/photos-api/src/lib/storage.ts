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
      throw new AppError(400, "UNSUPPORTED_IMAGE_TYPE", "Dieser Bildtyp wird nicht unterstützt.");
  }
}

function assertSafeSegment(value: string, label: string) {
  if (!SAFE_SEGMENT.test(value)) {
    throw new AppError(400, "INVALID_ID", `${label} ist ungültig.`);
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
    throw new AppError(400, "INVALID_STORAGE_PATH", "Der Speicherpfad ist ungültig.");
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

export type DeletedPhotoFiles = {
  originalDeleted: boolean;
  previewDeleted: boolean;
  thumbDeleted: boolean;
  deletedFiles: string[];
  missingFiles: string[];
  warnings: string[];
};

type PhotoFileKind = "original" | "preview" | "thumb";

function errnoCode(error: unknown) {
  return String((error as NodeJS.ErrnoException).code || "");
}

function storageMutationError(error: unknown, message: string) {
  const code = errnoCode(error);
  if (code === "ENOSPC") {
    return new AppError(507, "PHOTO_STORAGE_FULL", "Auf dem Foto-Speicher ist kein Platz mehr frei.", {
      cause: error
    });
  }

  if (["EACCES", "EPERM", "EROFS"].includes(code)) {
    return new AppError(500, "PHOTO_STORAGE_PERMISSION_DENIED", `${message} (${code}).`, {
      cause: error
    });
  }

  return new AppError(500, "PHOTO_STORAGE_ERROR", code ? `${message} (${code}).` : message, {
    cause: error
  });
}

export async function ensurePhotoRootWritable() {
  const photoRoot = path.resolve(env.PHOTO_ROOT);

  try {
    await fsp.mkdir(photoRoot, { recursive: true });
    await fsp.access(photoRoot, fs.constants.W_OK);
  } catch (error) {
    throw storageMutationError(error, "Der Foto-Speicher ist nicht beschreibbar");
  }
}

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

async function deleteRelativeFileIfExists(kind: PhotoFileKind, relativePath?: string | null) {
  if (!relativePath) {
    return { kind, deleted: false, missing: false };
  }

  try {
    const absolutePath = resolveInsidePhotoRoot(relativePath);
    await fsp.unlink(absolutePath);
    return { kind, deleted: true, missing: false };
  } catch (error) {
    if (errnoCode(error) === "ENOENT") {
      return { kind, deleted: false, missing: true };
    }

    if (error instanceof AppError) {
      throw error;
    }

    throw storageMutationError(
      error,
      `Die ${kind}-Datei konnte nicht gelöscht werden. Das Firestore-Dokument wurde nicht verändert`
    );
  }
}

export async function deletePhotoFiles(paths: PhotoFilePaths) {
  const entries = await Promise.all([
    deleteRelativeFileIfExists("original", paths.originalPath),
    deleteRelativeFileIfExists("preview", paths.previewPath),
    deleteRelativeFileIfExists("thumb", paths.thumbPath)
  ]);
  const originalDeleted = entries.find((entry) => entry.kind === "original")?.deleted ?? false;
  const previewDeleted = entries.find((entry) => entry.kind === "preview")?.deleted ?? false;
  const thumbDeleted = entries.find((entry) => entry.kind === "thumb")?.deleted ?? false;
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
    thumbDeleted,
    deletedFiles: entries.filter((entry) => entry.deleted).map((entry) => entry.kind),
    missingFiles: entries.filter((entry) => entry.missing).map((entry) => entry.kind),
    warnings: entries
      .filter((entry) => entry.missing)
      .map((entry) => `${entry.kind} fehlte bereits im Speicher.`)
  } satisfies DeletedPhotoFiles;
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
