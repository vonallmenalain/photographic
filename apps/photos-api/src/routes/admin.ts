import multer from "multer";
import { Request, Response, Router } from "express";
import { createHash } from "node:crypto";
import { nanoid } from "nanoid";
import { env } from "../config/env";
import { getAuthContext } from "../lib/auth";
import { writeAuditLog } from "../lib/audit";
import { normalizeEmail } from "../lib/admin";
import { adminDb, serverTimestamp } from "../lib/firebaseAdmin";
import { listCollection, listPhotos } from "../lib/firestore";
import { generatePhotoDerivatives } from "../lib/imageProcessing";
import { buildPhotoReferenceSets, getPhotoAvailability } from "../lib/photoAvailability";
import { randomId } from "../lib/paths";
import { importRosterRows, parseRosterRowsFromExcel } from "../lib/rosterImport";
import { asyncHandler, AppError, routeParam, sendOk } from "../lib/response";
import {
  allowedImageMimes,
  deletePhotoFiles,
  ensurePhotoRootWritable,
  extensionForMime,
  getRelativeFileSize,
  photoRelativePaths,
  resolveInsidePhotoRoot,
  writeBufferToRelativePath
} from "../lib/storage";
import {
  createChildSchema,
  createChildWithGuardianLinkSchema,
  createClassSchema,
  createGuardianLinkSchema,
  createJobSchema,
  createOrganizationSchema,
  parseChildIds,
  rosterImportSchema,
  updatePhotoSchema,
  uploadPhotoFieldsSchema
} from "../lib/validators";
import { PhotoRecord, PhotoVisibility } from "../types/domain";

export const adminRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: env.MAX_UPLOAD_MB * 1024 * 1024
  },
  fileFilter: (_req, file, callback) => {
    if (!allowedImageMimes.has(file.mimetype)) {
      callback(new AppError(400, "UNSUPPORTED_IMAGE_TYPE", "Dieser Bildtyp wird nicht unterstützt."));
      return;
    }
    callback(null, true);
  }
});

const importUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024
  },
  fileFilter: (_req, file, callback) => {
    const supported = new Set([
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/octet-stream"
    ]);
    if (!supported.has(file.mimetype) || !file.originalname.toLowerCase().endsWith(".xlsx")) {
      callback(new AppError(400, "UNSUPPORTED_IMPORT_TYPE", "Bitte lade eine Excel-Datei im .xlsx-Format hoch."));
      return;
    }
    callback(null, true);
  }
});

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function sha256(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

type UploadPhotoFields = {
  orgId: string;
  jobId: string;
  classId: string;
  visibility: PhotoVisibility;
};

type ReferenceRecord = {
  orgId?: string;
  jobId?: string;
  classId?: string;
};

async function requireReference<T extends ReferenceRecord>(
  collectionName: string,
  id: string,
  label: string
) {
  const snapshot = await adminDb().collection(collectionName).doc(id).get();

  if (!snapshot.exists) {
    throw new AppError(400, "INVALID_PHOTO_REFERENCES", `${label} wurde nicht gefunden.`);
  }

  return snapshot.data() as T;
}

async function validateUploadReferences(fields: UploadPhotoFields, childIds: string[]) {
  const uniqueChildIds = [...new Set(childIds)];

  if (fields.visibility === "child" && uniqueChildIds.length === 0) {
    throw new AppError(
      400,
      "INVALID_PHOTO_REFERENCES",
      "Für ein Kind-Foto muss mindestens ein Kind ausgewählt sein."
    );
  }

  const [job, schoolClass] = await Promise.all([
    requireReference<ReferenceRecord>("jobs", fields.jobId, "Der Auftrag"),
    requireReference<ReferenceRecord>("classes", fields.classId, "Die Klasse"),
    requireReference<ReferenceRecord>("organizations", fields.orgId, "Die Organisation")
  ]).then(([jobRecord, classRecord]) => [jobRecord, classRecord]);

  if (job.orgId !== fields.orgId) {
    throw new AppError(
      400,
      "INVALID_PHOTO_REFERENCES",
      "Der Auftrag gehört nicht zur ausgewählten Organisation."
    );
  }

  if (schoolClass.orgId !== fields.orgId || schoolClass.jobId !== fields.jobId) {
    throw new AppError(
      400,
      "INVALID_PHOTO_REFERENCES",
      "Die Klasse gehört nicht zur ausgewählten Organisation und zum Auftrag."
    );
  }

  if (uniqueChildIds.length > 0) {
    const childSnapshots = await Promise.all(
      uniqueChildIds.map((childId) => adminDb().collection("children").doc(childId).get())
    );

    childSnapshots.forEach((snapshot, index) => {
      if (!snapshot.exists) {
        throw new AppError(400, "INVALID_PHOTO_REFERENCES", "Mindestens ein Kind wurde nicht gefunden.");
      }

      const child = snapshot.data() as ReferenceRecord;
      if (
        child.orgId !== fields.orgId ||
        child.jobId !== fields.jobId ||
        child.classId !== fields.classId
      ) {
        throw new AppError(
          400,
          "INVALID_PHOTO_REFERENCES",
          `Kind ${uniqueChildIds[index]} gehört nicht zur ausgewählten Klasse.`
        );
      }
    });
  }

  return uniqueChildIds;
}

async function cleanupUploadedFiles(paths: {
  originalPath?: string | null;
  previewPath?: string | null;
  thumbPath?: string | null;
}) {
  try {
    await deletePhotoFiles(paths);
  } catch (cleanupError) {
    console.error("[photo-upload-cleanup-failed]", errorMessage(cleanupError));
  }
}

function photoProcessingError(error: unknown) {
  if (error instanceof AppError) {
    return error;
  }

  return new AppError(
    400,
    "PHOTO_PROCESSING_FAILED",
    "Das Bild konnte nicht verarbeitet werden. Bitte prüfe Dateityp und Bilddatei.",
    { cause: error }
  );
}

adminRouter.get(
  "/data",
  asyncHandler(async (_req, res) => {
    const [organizations, jobs, classes, children, guardianLinks, photos] = await Promise.all([
      listCollection("organizations"),
      listCollection("jobs"),
      listCollection("classes"),
      listCollection("children"),
      listCollection("guardianLinks"),
      listPhotos()
    ]);
    const references = buildPhotoReferenceSets({ organizations, jobs, classes, children });
    const photosWithAvailability = await Promise.all(
      photos.map(async ({ originalPath, previewPath, thumbPath, ...photo }) => {
        const availability = await getPhotoAvailability(
          { ...photo, originalPath, previewPath, thumbPath } as PhotoRecord,
          references
        );
        return {
          ...photo,
          storageStatus: availability.storage,
          metadataStatus: availability.metadata,
          displayable: availability.displayable
        };
      })
    );

    sendOk(res, {
      organizations,
      jobs,
      classes,
      children,
      guardianLinks,
      photos: photosWithAvailability
    });
  })
);

adminRouter.post(
  "/organizations",
  asyncHandler(async (req, res) => {
    const auth = getAuthContext(req);
    const input = createOrganizationSchema.parse(req.body);
    const orgId = randomId();

    await adminDb().collection("organizations").doc(orgId).set({
      ...input,
      createdAt: serverTimestamp(),
      createdByUid: auth.uid
    });

    await writeAuditLog(auth, "admin.create.organization", "organization", orgId, {
      type: input.type
    });

    sendOk(res, { id: orgId }, 201);
  })
);

adminRouter.post(
  "/jobs",
  asyncHandler(async (req, res) => {
    const auth = getAuthContext(req);
    const input = createJobSchema.parse(req.body);
    const jobId = randomId();

    await adminDb().collection("jobs").doc(jobId).set({
      ...input,
      retentionUntil: input.retentionUntil || null,
      status: "draft",
      createdAt: serverTimestamp(),
      createdByUid: auth.uid
    });

    await writeAuditLog(auth, "admin.create.job", "job", jobId, {
      orgId: input.orgId
    });

    sendOk(res, { id: jobId }, 201);
  })
);

adminRouter.post(
  "/classes",
  asyncHandler(async (req, res) => {
    const auth = getAuthContext(req);
    const input = createClassSchema.parse(req.body);
    const classId = randomId();

    await adminDb().collection("classes").doc(classId).set({
      ...input,
      teacherName: input.teacherName || "",
      createdAt: serverTimestamp(),
      createdByUid: auth.uid
    });

    await writeAuditLog(auth, "admin.create.class", "class", classId, {
      orgId: input.orgId,
      jobId: input.jobId
    });

    sendOk(res, { id: classId }, 201);
  })
);

adminRouter.post(
  "/children",
  asyncHandler(async (req, res) => {
    const auth = getAuthContext(req);
    const input = createChildSchema.parse(req.body);
    const childId = randomId();

    await adminDb().collection("children").doc(childId).set({
      ...input,
      createdAt: serverTimestamp(),
      createdByUid: auth.uid
    });

    await writeAuditLog(auth, "admin.create.child", "child", childId, {
      orgId: input.orgId,
      jobId: input.jobId,
      classId: input.classId
    });

    sendOk(res, { id: childId, displayName: input.displayName }, 201);
  })
);

adminRouter.post(
  "/children-with-guardian-link",
  asyncHandler(async (req, res) => {
    const auth = getAuthContext(req);
    const input = createChildWithGuardianLinkSchema.parse(req.body);
    const childId = randomId();
    const guardianLinkId = randomId();
    const emailLower = normalizeEmail(input.email);
    const timestamp = serverTimestamp();
    const db = adminDb();
    const batch = db.batch();

    batch.set(db.collection("children").doc(childId), {
      orgId: input.orgId,
      jobId: input.jobId,
      classId: input.classId,
      displayName: input.displayName,
      createdAt: timestamp,
      createdByUid: auth.uid
    });
    batch.set(db.collection("guardianLinks").doc(guardianLinkId), {
      email: input.email.trim(),
      emailLower,
      orgId: input.orgId,
      jobId: input.jobId,
      classId: input.classId,
      childId,
      createdAt: timestamp,
      createdByUid: auth.uid,
      revokedAt: null
    });

    await batch.commit();

    const loginUrl = new URL("/login", env.APP_BASE_URL);
    loginUrl.searchParams.set("email", input.email.trim());
    loginUrl.searchParams.set("jobId", input.jobId);

    await writeAuditLog(auth, "admin.create.child", "child", childId, {
      orgId: input.orgId,
      jobId: input.jobId,
      classId: input.classId
    });
    await writeAuditLog(auth, "admin.create.guardianLink", "guardianLink", guardianLinkId, {
      orgId: input.orgId,
      jobId: input.jobId,
      classId: input.classId,
      childId
    });

    sendOk(
      res,
      {
        id: childId,
        guardianLinkId,
        displayName: input.displayName,
        suggestedLoginUrl: loginUrl.toString()
      },
      201
    );
  })
);

adminRouter.post(
  "/guardian-links",
  asyncHandler(async (req, res) => {
    const auth = getAuthContext(req);
    const input = createGuardianLinkSchema.parse(req.body);
    const guardianLinkId = randomId();
    const emailLower = normalizeEmail(input.email);

    await adminDb().collection("guardianLinks").doc(guardianLinkId).set({
      ...input,
      email: input.email.trim(),
      emailLower,
      createdAt: serverTimestamp(),
      createdByUid: auth.uid,
      revokedAt: null
    });

    const loginUrl = new URL("/login", env.APP_BASE_URL);
    loginUrl.searchParams.set("email", input.email.trim());
    loginUrl.searchParams.set("jobId", input.jobId);

    await writeAuditLog(auth, "admin.create.guardianLink", "guardianLink", guardianLinkId, {
      orgId: input.orgId,
      jobId: input.jobId,
      classId: input.classId,
      childId: input.childId
    });

    sendOk(res, { id: guardianLinkId, suggestedLoginUrl: loginUrl.toString() }, 201);
  })
);

adminRouter.post(
  "/photos/upload",
  upload.single("file"),
  asyncHandler(async (req, res) => {
    const auth = getAuthContext(req);
    if (!req.file) {
      throw new AppError(400, "FILE_REQUIRED", "Bitte lade eine Bilddatei hoch.");
    }

    const fields = uploadPhotoFieldsSchema.parse(req.body);
    const childIds = await validateUploadReferences(fields, parseChildIds(req.body.childIds));
    const photoId = nanoid(18);
    const originalExt = extensionForMime(req.file.mimetype);
    const paths = photoRelativePaths(fields.orgId, fields.jobId, photoId, originalExt);
    const checksumSha256 = sha256(req.file.buffer);
    await ensurePhotoRootWritable();

    const originalAbsolutePath = await writeBufferToRelativePath(paths.originalPath, req.file.buffer);
    const previewAbsolutePath = resolveInsidePhotoRoot(paths.previewPath);
    const thumbAbsolutePath = resolveInsidePhotoRoot(paths.thumbPath);

    let derivatives: Awaited<ReturnType<typeof generatePhotoDerivatives>>;
    let fileSizeOriginal = 0;

    try {
      derivatives = await generatePhotoDerivatives(
        originalAbsolutePath,
        previewAbsolutePath,
        thumbAbsolutePath
      );
      fileSizeOriginal = await getRelativeFileSize(paths.originalPath);
    } catch (error) {
      console.error(`[photo-processing-error] ${photoId}: ${errorMessage(error)}`);
      await cleanupUploadedFiles(paths);
      throw photoProcessingError(error);
    }

    const metadata: PhotoRecord = {
      photoId,
      albumId: fields.jobId,
      schoolId: fields.orgId,
      orgId: fields.orgId,
      jobId: fields.jobId,
      classId: fields.classId,
      childIds,
      type: fields.type,
      visibility: fields.visibility,
      // Persistent file variants: original is private; thumb and preview are streamed by protected API routes.
      originalPath: paths.originalPath,
      previewPath: paths.previewPath,
      thumbPath: paths.thumbPath,
      originalFilename: req.file.originalname,
      originalMimeType: req.file.mimetype,
      originalSize: req.file.size,
      width: derivatives.width,
      height: derivatives.height,
      fileSizeOriginal,
      fileSizePreview: derivatives.preview.fileSize,
      fileSizeThumb: derivatives.thumb.fileSize,
      processingStatus: "ready",
      processingError: null,
      checksumSha256,
      uploadedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
      createdByUid: auth.uid,
      updatedAt: serverTimestamp()
    };

    try {
      await adminDb().collection("photos").doc(photoId).set(metadata);
    } catch (error) {
      console.error(`[photo-firestore-write-error] ${photoId}: ${errorMessage(error)}`);
      await cleanupUploadedFiles(paths);
      throw new AppError(
        503,
        "FIRESTORE_WRITE_FAILED",
        "Das Foto wurde verarbeitet, aber die Metadaten konnten nicht gespeichert werden. Lokale Dateien wurden bereinigt.",
        { cause: error }
      );
    }

    await writeAuditLog(auth, "admin.upload.photo", "photo", photoId, {
      orgId: fields.orgId,
      jobId: fields.jobId,
      classId: fields.classId,
      type: fields.type,
      visibility: fields.visibility,
      childIds,
      processingStatus: "ready"
    });

    const { originalPath, previewPath, thumbPath, ...safeMetadata } = metadata;
    sendOk(res, { id: photoId, ...safeMetadata }, 201);
  })
);

adminRouter.post(
  "/import/roster",
  asyncHandler(async (req, res) => {
    const auth = getAuthContext(req);
    const input = rosterImportSchema.parse(req.body);
    const result = await importRosterRows(input.rows, auth);
    sendOk(res, result);
  })
);

adminRouter.post(
  "/import/roster-file",
  importUpload.single("file"),
  asyncHandler(async (req, res) => {
    const auth = getAuthContext(req);
    if (!req.file) {
      throw new AppError(400, "FILE_REQUIRED", "Bitte lade eine Excel-Datei hoch.");
    }

    const rows = await parseRosterRowsFromExcel(req.file.buffer);
    const result = await importRosterRows(rows, auth);
    sendOk(res, result);
  })
);

adminRouter.post(
  "/maintenance/cleanup-missing-photos",
  asyncHandler(async (req, res) => {
    const auth = getAuthContext(req);
    const [organizations, jobs, classes, children, photos] = await Promise.all([
      listCollection("organizations"),
      listCollection("jobs"),
      listCollection("classes"),
      listCollection("children"),
      listPhotos()
    ]);
    const references = buildPhotoReferenceSets({ organizations, jobs, classes, children });
    const deletedPhotoIds: string[] = [];

    for (const photo of photos) {
      const availability = await getPhotoAvailability(photo, references);
      if (availability.displayable) {
        continue;
      }

      if (!photo.id) {
        continue;
      }

      await deletePhotoFiles(photo);
      await adminDb().collection("photos").doc(photo.id).delete();
      deletedPhotoIds.push(photo.id);
    }

    await writeAuditLog(auth, "admin.cleanup.missingPhotos", "photo", "bulk", {
      deletedCount: deletedPhotoIds.length,
      deletedPhotoIds
    });

    sendOk(res, { deletedCount: deletedPhotoIds.length, deletedPhotoIds });
  })
);

async function deletePhotoById(req: Request, res: Response) {
  const auth = getAuthContext(req);
  const photoId = routeParam(req, "photoId");
  const ref = adminDb().collection("photos").doc(photoId);
  const existing = await ref.get();

  if (!existing.exists) {
    throw new AppError(404, "PHOTO_NOT_FOUND", "Das Foto wurde nicht gefunden.");
  }

  const photo = existing.data() as PhotoRecord;
  const deletedFiles = await deletePhotoFiles(photo);
  await ref.delete();
  await writeAuditLog(auth, "admin.delete.photo", "photo", photoId, {
    deletedFiles
  });

  sendOk(res, { id: photoId, ...deletedFiles });
}

adminRouter.post("/photos/:photoId/delete", asyncHandler(deletePhotoById));
adminRouter.delete("/photos/:photoId", asyncHandler(deletePhotoById));

adminRouter.patch(
  "/photos/:photoId",
  asyncHandler(async (req, res) => {
    const auth = getAuthContext(req);
    const photoId = routeParam(req, "photoId");
    const input = updatePhotoSchema.parse(req.body);
    const ref = adminDb().collection("photos").doc(photoId);
    const existing = await ref.get();

    if (!existing.exists) {
      throw new AppError(404, "PHOTO_NOT_FOUND", "Das Foto wurde nicht gefunden.");
    }

    await ref.update({
      ...input,
      updatedAt: serverTimestamp()
    });

    await writeAuditLog(auth, "admin.update.photo", "photo", photoId, input);
    sendOk(res, { id: photoId });
  })
);
