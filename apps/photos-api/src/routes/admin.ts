import multer from "multer";
import { Router } from "express";
import { nanoid } from "nanoid";
import { env } from "../config/env";
import { getAuthContext } from "../lib/auth";
import { writeAuditLog } from "../lib/audit";
import { normalizeEmail } from "../lib/admin";
import { adminDb, serverTimestamp } from "../lib/firebaseAdmin";
import { listCollection } from "../lib/firestore";
import { generatePreviewAndThumb } from "../lib/imageProcessing";
import { randomChildPseudonym, randomId } from "../lib/paths";
import { asyncHandler, AppError, routeParam, sendOk } from "../lib/response";
import {
  allowedImageMimes,
  extensionForMime,
  photoRelativePaths,
  resolveInsidePhotoRoot,
  writeBufferToRelativePath
} from "../lib/storage";
import {
  createChildSchema,
  createClassSchema,
  createGuardianLinkSchema,
  createJobSchema,
  createOrganizationSchema,
  parseChildIds,
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

    sendOk(res, {
      organizations,
      jobs,
      classes,
      children,
      guardianLinks,
      photos: photos.map(({ originalPath, previewPath, thumbPath, ...photo }) => photo)
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
    const pseudonym = input.pseudonym || randomChildPseudonym();

    await adminDb().collection("children").doc(childId).set({
      ...input,
      displayName: input.displayName || "",
      pseudonym,
      createdAt: serverTimestamp(),
      createdByUid: auth.uid
    });

    await writeAuditLog(auth, "admin.create.child", "child", childId, {
      orgId: input.orgId,
      jobId: input.jobId,
      classId: input.classId
    });

    sendOk(res, { id: childId, pseudonym }, 201);
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

    const originalAbsolutePath = await writeBufferToRelativePath(paths.originalPath, req.file.buffer);
    const previewAbsolutePath = resolveInsidePhotoRoot(paths.previewPath);
    const thumbAbsolutePath = resolveInsidePhotoRoot(paths.thumbPath);
    await generatePreviewAndThumb(originalAbsolutePath, previewAbsolutePath, thumbAbsolutePath);

    const metadata: PhotoRecord = {
      orgId: fields.orgId,
      jobId: fields.jobId,
      classId: fields.classId,
      childIds,
      type: fields.type,
      visibility: fields.visibility,
      status: fields.status,
      originalPath: paths.originalPath,
      previewPath: paths.previewPath,
      thumbPath: paths.thumbPath,
      originalFilename: req.file.originalname,
      originalMimeType: req.file.mimetype,
      originalSize: req.file.size,
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
      status: fields.status
    });

    const { originalPath, previewPath, thumbPath, ...safeMetadata } = metadata;
    sendOk(res, { id: photoId, ...safeMetadata }, 201);
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
