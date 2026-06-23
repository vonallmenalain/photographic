import multer from "multer";
import { Router } from "express";
import { createHash } from "node:crypto";
import { nanoid } from "nanoid";
import { env } from "../config/env";
import { getAuthContext } from "../lib/auth";
import { writeAuditLog } from "../lib/audit";
import { normalizeEmail } from "../lib/admin";
import { adminDb, serverTimestamp } from "../lib/firebaseAdmin";
import { listCollection } from "../lib/firestore";
import { generatePhotoDerivatives } from "../lib/imageProcessing";
import { buildPhotoReferenceSets, getPhotoAvailability } from "../lib/photoAvailability";
import { randomId } from "../lib/paths";
import { importRosterRows, parseRosterRowsFromExcel } from "../lib/rosterImport";
import { asyncHandler, AppError, routeParam, sendOk } from "../lib/response";
import {
  allowedImageMimes,
  deletePhotoFiles,
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
import { PhotoRecord } from "../types/domain";

export const adminRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: env.MAX_UPLOAD_MB * 1024 * 1024
  },
  fileFilter: (_req, file, callback) => {
    if (!allowedImageMimes.has(file.mimetype)) {
      callback(new AppError(400, "UNSUPPORTED_IMAGE_TYPE", "Dieser Bildtyp wird nicht unterstuetzt."));
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

adminRouter.get(
  "/data",
  asyncHandler(async (_req, res) => {
    const [organizations, jobs, classes, children, guardianLinks, photos] = await Promise.all([
      listCollection("organizations"),
      listCollection("jobs"),
      listCollection("classes"),
      listCollection("children"),
      listCollection("guardianLinks"),
      listCollection<PhotoRecord>("photos")
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
    const childIds = parseChildIds(req.body.childIds);
    const photoId = nanoid(18);
    const originalExt = extensionForMime(req.file.mimetype);
    const paths = photoRelativePaths(fields.orgId, fields.jobId, photoId, originalExt);
    const checksumSha256 = sha256(req.file.buffer);
    let originalAbsolutePath: string | null = null;

    try {
      originalAbsolutePath = await writeBufferToRelativePath(paths.originalPath, req.file.buffer);
      const previewAbsolutePath = resolveInsidePhotoRoot(paths.previewPath);
      const thumbAbsolutePath = resolveInsidePhotoRoot(paths.thumbPath);
      const derivatives = await generatePhotoDerivatives(
        originalAbsolutePath,
        previewAbsolutePath,
        thumbAbsolutePath
      );
      const fileSizeOriginal = await getRelativeFileSize(paths.originalPath);

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

      await adminDb().collection("photos").doc(photoId).set(metadata);
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
    } catch (error) {
      const message = errorMessage(error);
      console.error(`[photo-processing-error] ${photoId}: ${message}`);

      if (originalAbsolutePath) {
        await adminDb().collection("photos").doc(photoId).set({
          photoId,
          albumId: fields.jobId,
          schoolId: fields.orgId,
          orgId: fields.orgId,
          jobId: fields.jobId,
          classId: fields.classId,
          childIds,
          type: fields.type,
          visibility: fields.visibility,
          originalPath: paths.originalPath,
          previewPath: null,
          thumbPath: null,
          originalFilename: req.file.originalname,
          originalMimeType: req.file.mimetype,
          originalSize: req.file.size,
          fileSizeOriginal: await getRelativeFileSize(paths.originalPath).catch(() => req.file?.size || 0),
          fileSizePreview: 0,
          fileSizeThumb: 0,
          processingStatus: "error",
          processingError: message,
          checksumSha256,
          uploadedAt: serverTimestamp(),
          createdAt: serverTimestamp(),
          createdByUid: auth.uid,
          updatedAt: serverTimestamp()
        });

        await writeAuditLog(auth, "admin.upload.photoFailed", "photo", photoId, {
          orgId: fields.orgId,
          jobId: fields.jobId,
          classId: fields.classId,
          processingError: message
        });
      }

      throw new AppError(
        500,
        "PHOTO_PROCESSING_FAILED",
        "Das Foto wurde nicht vollstaendig verarbeitet. Bitte pruefe die Admin-Ansicht und versuche die Derivate neu zu erzeugen."
      );
    }
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
      listCollection<PhotoRecord>("photos")
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

adminRouter.delete(
  "/photos/:photoId",
  asyncHandler(async (req, res) => {
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

    sendOk(res, { id: photoId, deletedFiles });
  })
);

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
