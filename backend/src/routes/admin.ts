import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import {
  COL,
  col,
  getById,
  firstOf,
  runQuery,
  setById,
  updateById,
  deleteById,
  deleteWhere,
  countQuery,
  linkId,
  nowIso,
} from '../db';
import { config } from '../config';
import { asyncHandler, ApiError } from '../middleware/errorHandler';
import { requireAdmin, ADMIN_COOKIE } from '../middleware/adminAuth';
import { adminLoginLimiter, passwordResetLimiter } from '../middleware/rateLimit';
import { signAdminToken, hashToken } from '../lib/auth';
import { setAuthCookie, clearAuthCookie } from '../lib/cookies';
import { newId } from '../lib/ids';
import { emailSchema, parse, normalizeEmail } from '../lib/validation';
import crypto from 'crypto';
import {
  processOriginal,
  reprocessFromOriginal,
  deleteAllVariants,
  deleteEventStorage,
  variantPath,
} from '../lib/images';
import { sendPasswordResetEmail } from '../lib/email';
import { requestVerification } from '../services/verification';
import { EVENT_STATUSES, archiveExpiredEvents, retentionExpiry } from '../services/events';
import { matchChildByFilename } from '../lib/names';
import {
  detectMapping,
  describeColumns,
  buildPlan,
  commitImport,
  type Mapping,
} from '../services/import';

const router = Router();

const EMAIL_STATUSES = ['created', 'not_verified', 'verification_sent', 'verified', 'disabled', 'support'] as const;
const PHOTO_STATUSES = ['uploaded', 'processed', 'assigned', 'disabled'] as const;
const ORDER_STATUSES = ['cart', 'checkout_started', 'paid', 'failed', 'completed', 'fulfilled', 'cancelled', 'refunded'] as const;

async function audit(action: string, detail: string, actor = 'admin') {
  await setById(COL.auditLog, newId('aud'), {
    actor,
    action,
    detail,
    created_at: nowIso(),
  });
}

// ---------------------------------------------------------------------------
// Cascade helpers (Firestore has no foreign keys, so we mirror the previous
// ON DELETE CASCADE behaviour explicitly).
// ---------------------------------------------------------------------------
async function deletePhotoCascade(photoId: string): Promise<void> {
  const photo = await getById<{ storage_key: string; ext: string }>(COL.photos, photoId);
  await deleteWhere(col(COL.photoEmails).where('photo_id', '==', photoId));
  await deleteById(COL.photos, photoId);
  if (photo) await deleteAllVariants(photo.storage_key, photo.ext);
}

async function deleteChildCascade(childId: string): Promise<void> {
  await deleteWhere(col(COL.emailChildren).where('child_id', '==', childId));
  // Photos referencing this child lose the link (mirror ON DELETE SET NULL).
  const photos = await runQuery<{ child_id: string }>(
    col(COL.photos).where('child_id', '==', childId),
  );
  await Promise.all(photos.map((p) => updateById(COL.photos, p.id, { child_id: null })));
  await deleteById(COL.children, childId);
}

// --- Auth ----------------------------------------------------------------
type AdminUser = { username: string; password_hash: string; email?: string };

/**
 * Resolves an admin account from the value typed into the "Benutzername /
 * E-Mail" field. Admin documents are keyed by username, but the e-mail address
 * may be used interchangeably as a login identifier. We therefore look the
 * value up as a document id first and fall back to an e-mail match.
 */
async function findAdminUser(identifier: string): Promise<(AdminUser & { id: string }) | null> {
  const trimmed = identifier.trim();
  if (!trimmed) return null;
  const byUsername = await getById<AdminUser>(COL.adminUsers, trimmed);
  if (byUsername) return byUsername;
  const byEmail = await firstOf<AdminUser>(
    col(COL.adminUsers).where('email', '==', normalizeEmail(trimmed)),
  );
  return byEmail;
}

router.post(
  '/login',
  adminLoginLimiter,
  asyncHandler(async (req, res) => {
    const { username, password } = parse(
      z.object({ username: z.string().min(1), password: z.string().min(1) }),
      req.body,
    );
    const user = await findAdminUser(username);
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      throw new ApiError(401, 'Benutzername oder Passwort ist falsch.');
    }
    const token = signAdminToken({ sub: user.username, role: 'admin' });
    setAuthCookie(res, ADMIN_COOKIE, token, { maxAgeMs: 12 * 60 * 60 * 1000 });
    res.json({ token, username: user.username });
  }),
);

router.post('/logout', (_req, res) => {
  clearAuthCookie(res, ADMIN_COOKIE);
  res.json({ ok: true });
});

router.get('/me', requireAdmin, (req, res) => {
  res.json({ username: req.admin!.username });
});

// --- Passwort vergessen / zurücksetzen (öffentlich, rate-limited) ----------
router.post(
  '/forgot-password',
  passwordResetLimiter,
  asyncHandler(async (req, res) => {
    const { username } = parse(
      z.object({ username: z.string().min(1) }),
      req.body,
    );

    const user = await findAdminUser(username);

    if (!user || !user.email) {
      throw new ApiError(404, 'Diese E-Mail-Adresse ist nicht registriert.');
    }

    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashToken(token);
    const ttlMs = config.admin.passwordResetTtlMinutes * 60 * 1000;
    const expiresAt = new Date(Date.now() + ttlMs).toISOString();

    await setById(COL.adminPasswordResets, tokenHash, {
      username: user.username,
      token_hash: tokenHash,
      expires_at: expiresAt,
      created_at: nowIso(),
    });

    const link = `${config.publicAppUrl}/admin/passwort-zuruecksetzen?token=${token}`;
    await sendPasswordResetEmail(user.email, user.username, link, config.admin.passwordResetTtlMinutes);

    res.json({ ok: true });
  }),
);

router.post(
  '/reset-password',
  passwordResetLimiter,
  asyncHandler(async (req, res) => {
    const { token, password } = parse(
      z.object({ token: z.string().min(1), password: z.string().min(8, 'Das Passwort muss mindestens 8 Zeichen lang sein.') }),
      req.body,
    );

    const tokenHash = hashToken(token);
    const resetDoc = await getById<{ username: string; expires_at: string }>(
      COL.adminPasswordResets,
      tokenHash,
    );

    if (!resetDoc || new Date(resetDoc.expires_at) < new Date()) {
      throw new ApiError(400, 'Der Link ist ungültig oder abgelaufen. Bitte fordere einen neuen an.');
    }

    const hash = bcrypt.hashSync(password, 10);
    await updateById(COL.adminUsers, resetDoc.username, {
      password_hash: hash,
      updated_at: nowIso(),
    });

    // Token ungültig machen
    await deleteById(COL.adminPasswordResets, tokenHash);

    res.json({ ok: true });
  }),
);

// All routes below require admin.
router.use(requireAdmin);

// --- Dashboard -----------------------------------------------------------
router.get(
  '/stats',
  asyncHandler(async (_req, res) => {
    const [
      events,
      publishedEvents,
      photos,
      publishedPhotos,
      emails,
      verifiedEmails,
      orders,
      openReports,
    ] = await Promise.all([
      countQuery(col(COL.events)),
      countQuery(col(COL.events).where('status', '==', 'published')),
      countQuery(col(COL.photos)),
      countQuery(col(COL.photos).where('published', '==', 1)),
      countQuery(col(COL.parentEmails)),
      countQuery(col(COL.parentEmails).where('status', '==', 'verified')),
      countQuery(col(COL.orders).where('status', '!=', 'cart')),
      countQuery(col(COL.reports).where('status', '==', 'open')),
    ]);
    res.json({ events, publishedEvents, photos, publishedPhotos, emails, verifiedEmails, orders, openReports });
  }),
);

// --- Events --------------------------------------------------------------
router.get(
  '/events',
  asyncHandler(async (_req, res) => {
    // Keep statuses current (auto-archive expired galleries) before listing.
    await archiveExpiredEvents();
    const [events, photos, children] = await Promise.all([
      runQuery<Record<string, unknown>>(col(COL.events)),
      runQuery<{ event_id: string }>(col(COL.photos)),
      runQuery<{ event_id: string }>(col(COL.children)),
    ]);
    const photoCounts = new Map<string, number>();
    for (const p of photos) photoCounts.set(p.event_id, (photoCounts.get(p.event_id) ?? 0) + 1);
    const childCounts = new Map<string, number>();
    for (const c of children) childCounts.set(c.event_id, (childCounts.get(c.event_id) ?? 0) + 1);

    const result = events
      .map((e) => ({
        ...e,
        photo_count: photoCounts.get(e.id) ?? 0,
        child_count: childCounts.get(e.id) ?? 0,
      }))
      .sort((a, b) =>
        String((b as Record<string, unknown>).created_at ?? '').localeCompare(
          String((a as Record<string, unknown>).created_at ?? ''),
        ),
      );
    res.json({ events: result });
  }),
);

router.post(
  '/events',
  asyncHandler(async (req, res) => {
    const { name, description } = parse(
      z.object({ name: z.string().trim().min(1).max(200), description: z.string().max(2000).default('') }),
      req.body,
    );
    const id = newId('evt');
    await setById(COL.events, id, {
      name,
      description,
      status: 'draft',
      expires_at: retentionExpiry(),
      created_at: nowIso(),
      updated_at: nowIso(),
    });
    await audit('event.create', id);
    res.json({ id });
  }),
);

router.get(
  '/events/:id',
  asyncHandler(async (req, res) => {
    await archiveExpiredEvents();
    const event = await getById<Record<string, unknown>>(COL.events, req.params.id);
    if (!event) throw new ApiError(404, 'Event nicht gefunden.');
    const children = (await runQuery<{ name: string }>(col(COL.children).where('event_id', '==', req.params.id)))
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));
    const photos = (
      await runQuery<{
        child_id: string | null;
        is_class_photo: number;
        original_filename: string;
        status: string;
        published: number;
        sort_order: number;
        width: number | null;
        height: number | null;
        created_at: string;
      }>(col(COL.photos).where('event_id', '==', req.params.id))
    )
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || String(a.created_at).localeCompare(String(b.created_at)))
      .map((p) => ({
        id: p.id,
        child_id: p.child_id ?? null,
        is_class_photo: p.is_class_photo,
        original_filename: p.original_filename,
        status: p.status,
        published: p.published,
        sort_order: p.sort_order,
        width: p.width ?? null,
        height: p.height ?? null,
      }));
    res.json({ event, children, photos });
  }),
);

router.patch(
  '/events/:id',
  asyncHandler(async (req, res) => {
    const data = parse(
      z.object({
        name: z.string().trim().min(1).max(200).optional(),
        description: z.string().max(2000).optional(),
        status: z.enum(EVENT_STATUSES).optional(),
        expires_at: z.string().optional(),
      }),
      req.body,
    );
    const event = await getById<{ expires_at: string | null }>(COL.events, req.params.id);
    if (!event) throw new ApiError(404, 'Event nicht gefunden.');
    const updates: Record<string, unknown> = { ...data };
    // Re-publishing an already-expired event refreshes its retention window so
    // the auto-archive sweep does not immediately archive it again.
    if (data.status === 'published' && data.expires_at === undefined) {
      const exp = event.expires_at ? new Date(event.expires_at).getTime() : 0;
      if (!exp || exp <= Date.now()) updates.expires_at = retentionExpiry();
    }
    if (Object.keys(updates).length) {
      await updateById(COL.events, req.params.id, { ...updates, updated_at: nowIso() });
      await audit('event.update', `${req.params.id}: ${JSON.stringify(updates)}`);
    }
    res.json({ ok: true });
  }),
);

router.delete(
  '/events/:id',
  asyncHandler(async (req, res) => {
    const photos = await runQuery<{ storage_key: string; ext: string }>(
      col(COL.photos).where('event_id', '==', req.params.id),
    );
    const children = await runQuery(col(COL.children).where('event_id', '==', req.params.id));
    await Promise.all(photos.map((p) => deletePhotoCascade(p.id)));
    await Promise.all(children.map((c) => deleteChildCascade(c.id)));
    // Remove the event's storage sub-folders entirely so no empty (or stray)
    // `<variant>/<eventId>` directories remain behind on the volume.
    await deleteEventStorage(req.params.id);
    await deleteById(COL.events, req.params.id);
    await audit('event.delete', req.params.id);
    res.json({ ok: true });
  }),
);

// --- Children ------------------------------------------------------------
router.post(
  '/events/:id/children',
  asyncHandler(async (req, res) => {
    const { name, note } = parse(
      z.object({ name: z.string().trim().min(1).max(200), note: z.string().max(1000).default('') }),
      req.body,
    );
    const event = await getById(COL.events, req.params.id);
    if (!event) throw new ApiError(404, 'Event nicht gefunden.');
    const id = newId('chd');
    await setById(COL.children, id, {
      event_id: req.params.id,
      name,
      note,
      created_at: nowIso(),
    });
    res.json({ id });
  }),
);

router.patch(
  '/children/:id',
  asyncHandler(async (req, res) => {
    const data = parse(
      z.object({ name: z.string().trim().min(1).max(200).optional(), note: z.string().max(1000).optional() }),
      req.body,
    );
    if (Object.keys(data).length) {
      await updateById(COL.children, req.params.id, data);
    }
    res.json({ ok: true });
  }),
);

router.delete(
  '/children/:id',
  asyncHandler(async (req, res) => {
    await deleteChildCascade(req.params.id);
    res.json({ ok: true });
  }),
);

// --- Photo upload & management -------------------------------------------
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadMb * 1024 * 1024 },
});

router.post(
  '/events/:id/photos',
  upload.array('photos', 50),
  asyncHandler(async (req, res) => {
    const event = await getById(COL.events, req.params.id);
    if (!event) throw new ApiError(404, 'Event nicht gefunden.');
    const files = (req.files as Express.Multer.File[]) ?? [];
    if (files.length === 0) throw new ApiError(400, 'Keine Dateien empfangen.');

    // Auto-assignment by file name is on by default; pass autoAssign=0 to skip.
    const autoAssign = String((req.query.autoAssign ?? req.body?.autoAssign) ?? '1') !== '0';
    const children = autoAssign
      ? await runQuery<{ name: string }>(col(COL.children).where('event_id', '==', req.params.id))
      : [];

    const results: {
      id: string;
      filename: string;
      ok: boolean;
      error?: string;
      matchedChildId?: string;
      matchedChildName?: string;
    }[] = [];
    for (const file of files) {
      const id = newId('pho');
      const ext = (path.extname(file.originalname).replace('.', '').toLowerCase() || 'jpg').slice(0, 5);
      const storageKey = `${req.params.id}/${id}`;
      // Try to recognise the child from the file name (tolerant matching).
      const match = autoAssign ? matchChildByFilename(file.originalname, children) : null;
      const childId = match && !match.ambiguous ? match.childId : null;
      await setById(COL.photos, id, {
        event_id: req.params.id,
        child_id: childId,
        is_class_photo: 0,
        original_filename: file.originalname.slice(0, 255),
        storage_key: storageKey,
        ext,
        width: null,
        height: null,
        bytes: null,
        status: childId ? 'assigned' : 'uploaded',
        processing_error: null,
        published: 0,
        sort_order: 0,
        created_at: nowIso(),
        updated_at: nowIso(),
      });
      try {
        const meta = await processOriginal(file.buffer, storageKey, ext);
        await updateById(COL.photos, id, {
          status: childId ? 'assigned' : 'processed',
          width: meta.width,
          height: meta.height,
          bytes: meta.bytes,
          updated_at: nowIso(),
        });
        results.push({
          id,
          filename: file.originalname,
          ok: true,
          matchedChildId: childId ?? undefined,
          matchedChildName: childId ? match?.childName : undefined,
        });
      } catch (err) {
        await updateById(COL.photos, id, {
          processing_error: String(err).slice(0, 500),
          updated_at: nowIso(),
        });
        results.push({ id, filename: file.originalname, ok: false, error: 'Verarbeitung fehlgeschlagen' });
      }
    }
    const matched = results.filter((r) => r.matchedChildId).length;
    await audit('photo.upload', `${req.params.id}: ${results.length} files, ${matched} auto-assigned`);
    res.json({ results });
  }),
);

// Re-run filename based auto-assignment for photos that are not yet linked to a
// child. Useful after children have been imported/created post-upload.
router.post(
  '/events/:id/photos/auto-assign',
  asyncHandler(async (req, res) => {
    const event = await getById(COL.events, req.params.id);
    if (!event) throw new ApiError(404, 'Event nicht gefunden.');
    const { overwrite } = parse(
      z.object({ overwrite: z.boolean().default(false) }),
      req.body ?? {},
    );
    const [children, photos] = await Promise.all([
      runQuery<{ name: string }>(col(COL.children).where('event_id', '==', req.params.id)),
      runQuery<{ child_id: string | null; is_class_photo: number; original_filename: string; status: string }>(
        col(COL.photos).where('event_id', '==', req.params.id),
      ),
    ]);

    let assigned = 0;
    let ambiguous = 0;
    const details: { id: string; filename: string; childName: string }[] = [];
    for (const p of photos) {
      if (p.is_class_photo) continue;
      if (p.child_id && !overwrite) continue;
      const match = matchChildByFilename(p.original_filename, children);
      if (!match) continue;
      if (match.ambiguous) {
        ambiguous += 1;
        continue;
      }
      if (p.child_id === match.childId) continue;
      await updateById(COL.photos, p.id, {
        child_id: match.childId,
        status: 'assigned',
        updated_at: nowIso(),
      });
      assigned += 1;
      details.push({ id: p.id, filename: p.original_filename, childName: match.childName });
    }
    await audit('photo.autoassign', `${req.params.id}: ${assigned} assigned`);
    res.json({ assigned, ambiguous, details });
  }),
);

// Admin-only clean thumbnail (auth required via cookie/bearer).
router.get(
  '/photos/:id/thumb',
  asyncHandler(async (req, res) => {
    const photo = await getById<{ storage_key: string }>(COL.photos, req.params.id);
    if (!photo) throw new ApiError(404, 'Foto nicht gefunden.');
    const fs = await import('fs');
    const p = variantPath('admin', photo.storage_key);
    if (!fs.existsSync(p)) throw new ApiError(404, 'Vorschau nicht verfügbar.');
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=60');
    fs.createReadStream(p).pipe(res);
  }),
);

// Admin-only clean full-resolution view (auth required via cookie/bearer).
// Serves the untouched original so admins can inspect a photo enlarged. Falls
// back to the (clean) admin variant when the original is unavailable.
const ORIGINAL_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
  tiff: 'image/tiff',
  tif: 'image/tiff',
  bmp: 'image/bmp',
};
router.get(
  '/photos/:id/original',
  asyncHandler(async (req, res) => {
    const photo = await getById<{ storage_key: string; ext: string }>(COL.photos, req.params.id);
    if (!photo) throw new ApiError(404, 'Foto nicht gefunden.');
    const fs = await import('fs');
    const originalPath = variantPath('original', photo.storage_key, photo.ext);
    if (fs.existsSync(originalPath)) {
      const ext = (photo.ext || 'jpg').toLowerCase();
      res.setHeader('Content-Type', ORIGINAL_MIME[ext] ?? 'application/octet-stream');
      res.setHeader('Cache-Control', 'private, max-age=60');
      fs.createReadStream(originalPath).pipe(res);
      return;
    }
    const adminPath = variantPath('admin', photo.storage_key);
    if (!fs.existsSync(adminPath)) throw new ApiError(404, 'Originaldatei nicht verfügbar.');
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=60');
    fs.createReadStream(adminPath).pipe(res);
  }),
);

router.patch(
  '/photos/:id',
  asyncHandler(async (req, res) => {
    const data = parse(
      z.object({
        child_id: z.string().nullable().optional(),
        is_class_photo: z.boolean().optional(),
        published: z.boolean().optional(),
        status: z.enum(PHOTO_STATUSES).optional(),
        sort_order: z.number().int().optional(),
      }),
      req.body,
    );
    const photo = await getById(COL.photos, req.params.id);
    if (!photo) throw new ApiError(404, 'Foto nicht gefunden.');
    const map: Record<string, unknown> = {};
    if (data.child_id !== undefined) map.child_id = data.child_id;
    if (data.is_class_photo !== undefined) map.is_class_photo = data.is_class_photo ? 1 : 0;
    if (data.published !== undefined) map.published = data.published ? 1 : 0;
    if (data.status !== undefined) map.status = data.status;
    if (data.sort_order !== undefined) map.sort_order = data.sort_order;
    if (Object.keys(map).length) {
      await updateById(COL.photos, req.params.id, { ...map, updated_at: nowIso() });
      await audit('photo.update', `${req.params.id}: ${JSON.stringify(data)}`);
    }
    res.json({ ok: true });
  }),
);

router.post(
  '/photos/:id/reprocess',
  asyncHandler(async (req, res) => {
    const photo = await getById<{ storage_key: string; ext: string }>(COL.photos, req.params.id);
    if (!photo) throw new ApiError(404, 'Foto nicht gefunden.');
    const meta = await reprocessFromOriginal(photo.storage_key, photo.ext);
    await updateById(COL.photos, req.params.id, {
      status: 'processed',
      processing_error: null,
      width: meta.width,
      height: meta.height,
      bytes: meta.bytes,
      updated_at: nowIso(),
    });
    res.json({ ok: true });
  }),
);

router.delete(
  '/photos/:id',
  asyncHandler(async (req, res) => {
    const photo = await getById(COL.photos, req.params.id);
    if (!photo) throw new ApiError(404, 'Foto nicht gefunden.');
    await deletePhotoCascade(req.params.id);
    await audit('photo.delete', req.params.id);
    res.json({ ok: true });
  }),
);

// Direct photo <-> e-mail assignment (class photos / overrides).
router.post(
  '/photos/:id/emails',
  asyncHandler(async (req, res) => {
    const { emailId } = parse(z.object({ emailId: z.string() }), req.body);
    await setById(COL.photoEmails, linkId(req.params.id, emailId), {
      photo_id: req.params.id,
      email_id: emailId,
      created_at: nowIso(),
    });
    res.json({ ok: true });
  }),
);

router.delete(
  '/photos/:id/emails/:emailId',
  asyncHandler(async (req, res) => {
    await deleteById(COL.photoEmails, linkId(req.params.id, req.params.emailId));
    res.json({ ok: true });
  }),
);

router.get(
  '/photos/:id/emails',
  asyncHandler(async (req, res) => {
    const links = await runQuery<{ email_id: string }>(
      col(COL.photoEmails).where('photo_id', '==', req.params.id),
    );
    const emails = await Promise.all(
      links.map(async (l) => {
        const e = await getById<{ email: string }>(COL.parentEmails, l.email_id);
        return { email_id: l.email_id, email: e?.email ?? '' };
      }),
    );
    res.json({ emails });
  }),
);

// --- E-mail / parent management ------------------------------------------
router.get(
  '/emails',
  asyncHandler(async (req, res) => {
    const q = String(req.query.q ?? '').trim().toLowerCase();
    let rows = await runQuery<{ email: string; name?: string; created_at: string }>(col(COL.parentEmails));
    if (q) {
      rows = rows.filter(
        (r) =>
          String(r.email).toLowerCase().includes(q) ||
          String(r.name ?? '').toLowerCase().includes(q),
      );
    }
    rows.sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')));
    res.json({ emails: rows.slice(0, 200) });
  }),
);

router.post(
  '/emails',
  asyncHandler(async (req, res) => {
    const { email, name, note } = parse(
      z.object({
        email: emailSchema,
        name: z.string().max(200).default(''),
        note: z.string().max(1000).default(''),
      }),
      req.body,
    );
    const normalized = normalizeEmail(email);
    const existing = await firstOf(col(COL.parentEmails).where('email', '==', normalized));
    if (existing) throw new ApiError(409, 'Diese E-Mail-Adresse existiert bereits.');
    const id = newId('eml');
    await setById(COL.parentEmails, id, {
      email: normalized,
      name,
      status: 'not_verified',
      verified_at: null,
      note,
      created_at: nowIso(),
      updated_at: nowIso(),
    });
    await audit('email.create', email);
    res.json({ id });
  }),
);

router.get(
  '/emails/:id',
  asyncHandler(async (req, res) => {
    const email = await getById<Record<string, unknown>>(COL.parentEmails, req.params.id);
    if (!email) throw new ApiError(404, 'E-Mail-Adresse nicht gefunden.');

    const childLinks = await runQuery<{ child_id: string }>(
      col(COL.emailChildren).where('email_id', '==', req.params.id),
    );
    const children = (
      await Promise.all(
        childLinks.map(async (l) => {
          const c = await getById<{ name: string; event_id: string }>(COL.children, l.child_id);
          if (!c) return null;
          const ev = await getById<{ name: string }>(COL.events, c.event_id);
          return { id: c.id, name: c.name, event_id: c.event_id, event_name: ev?.name ?? '' };
        }),
      )
    ).filter(Boolean);

    const photoLinks = await runQuery<{ photo_id: string }>(
      col(COL.photoEmails).where('email_id', '==', req.params.id),
    );
    const directPhotos = (
      await Promise.all(
        photoLinks.map(async (l) => {
          const p = await getById<{ original_filename: string; event_id: string }>(COL.photos, l.photo_id);
          if (!p) return null;
          return { id: p.id, original_filename: p.original_filename, event_id: p.event_id };
        }),
      )
    ).filter(Boolean);

    const orders = (await runQuery<{ status: string; total_cents: number; currency: string; created_at: string }>(
      col(COL.orders).where('email_id', '==', req.params.id),
    ))
      .filter((o) => o.status !== 'cart')
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
      .map((o) => ({ id: o.id, status: o.status, total_cents: o.total_cents, currency: o.currency, created_at: o.created_at }));

    res.json({ email, children, directPhotos, orders });
  }),
);

router.patch(
  '/emails/:id',
  asyncHandler(async (req, res) => {
    const data = parse(
      z.object({
        email: emailSchema.optional(),
        name: z.string().max(200).optional(),
        status: z.enum(EMAIL_STATUSES).optional(),
        note: z.string().max(1000).optional(),
      }),
      req.body,
    );
    const existing = await getById(COL.parentEmails, req.params.id);
    if (!existing) throw new ApiError(404, 'E-Mail-Adresse nicht gefunden.');
    if (data.email) {
      const clash = await firstOf(col(COL.parentEmails).where('email', '==', normalizeEmail(data.email)));
      if (clash && clash.id !== req.params.id) {
        throw new ApiError(409, 'Diese E-Mail-Adresse existiert bereits.');
      }
    }
    const map: Record<string, unknown> = {};
    if (data.email) map.email = normalizeEmail(data.email);
    if (data.name !== undefined) map.name = data.name;
    if (data.status) map.status = data.status;
    if (data.note !== undefined) map.note = data.note;
    if (Object.keys(map).length) {
      await updateById(COL.parentEmails, req.params.id, { ...map, updated_at: nowIso() });
      await audit('email.update', `${req.params.id}: ${JSON.stringify(data)}`);
    }
    res.json({ ok: true });
  }),
);

router.delete(
  '/emails/:id',
  asyncHandler(async (req, res) => {
    await Promise.all([
      deleteWhere(col(COL.emailChildren).where('email_id', '==', req.params.id)),
      deleteWhere(col(COL.photoEmails).where('email_id', '==', req.params.id)),
      deleteWhere(col(COL.parentSessions).where('email_id', '==', req.params.id)),
      deleteWhere(col(COL.verificationTokens).where('email_id', '==', req.params.id)),
    ]);
    await deleteById(COL.parentEmails, req.params.id);
    await audit('email.delete', req.params.id);
    res.json({ ok: true });
  }),
);

router.post(
  '/emails/:id/children',
  asyncHandler(async (req, res) => {
    const { childId } = parse(z.object({ childId: z.string() }), req.body);
    await setById(COL.emailChildren, linkId(req.params.id, childId), {
      email_id: req.params.id,
      child_id: childId,
      created_at: nowIso(),
    });
    res.json({ ok: true });
  }),
);

router.delete(
  '/emails/:id/children/:childId',
  asyncHandler(async (req, res) => {
    await deleteById(COL.emailChildren, linkId(req.params.id, req.params.childId));
    res.json({ ok: true });
  }),
);

router.post(
  '/emails/:id/resend-verification',
  asyncHandler(async (req, res) => {
    const row = await getById<{ email: string }>(COL.parentEmails, req.params.id);
    if (!row) throw new ApiError(404, 'E-Mail-Adresse nicht gefunden.');
    await requestVerification(row.email);
    await audit('email.resend', req.params.id);
    res.json({ ok: true });
  }),
);

// --- Bulk import (paste / CSV / Excel) -----------------------------------
// The frontend converts any input (pasted table, CSV or XLSX) into a 2-D array
// of strings. The backend owns the tolerant column detection, builds a review
// plan and finally commits it (creating e-mails, children and their links).
const mappingSchema = z
  .object({
    email: z.number().int().nonnegative().optional(),
    name: z.number().int().nonnegative().optional(),
    first_name: z.number().int().nonnegative().optional(),
    last_name: z.number().int().nonnegative().optional(),
    child: z.number().int().nonnegative().optional(),
    event: z.number().int().nonnegative().optional(),
    note: z.number().int().nonnegative().optional(),
  })
  .partial();

const MAX_IMPORT_ROWS = 5000;
const MAX_IMPORT_COLS = 60;

function sanitizeRows(raw: unknown[][]): string[][] {
  return raw
    .slice(0, MAX_IMPORT_ROWS)
    .map((r) => (Array.isArray(r) ? r : []).slice(0, MAX_IMPORT_COLS).map((c) => (c == null ? '' : String(c))))
    .filter((r) => r.some((c) => c.trim() !== ''));
}

router.post(
  '/import/preview',
  asyncHandler(async (req, res) => {
    const { rows, mapping, hasHeader } = parse(
      z.object({
        rows: z.array(z.array(z.any())).max(MAX_IMPORT_ROWS),
        mapping: mappingSchema.optional(),
        hasHeader: z.boolean().optional(),
      }),
      req.body,
    );
    const clean = sanitizeRows(rows);
    if (clean.length === 0) throw new ApiError(400, 'Keine verwertbaren Zeilen gefunden.');

    let effectiveMapping: Mapping;
    let effectiveHeader: boolean;
    let columns;
    if (mapping && Object.keys(mapping).length > 0) {
      effectiveMapping = mapping as Mapping;
      effectiveHeader = hasHeader ?? false;
      columns = describeColumns(clean, effectiveMapping, effectiveHeader);
    } else {
      const detection = detectMapping(clean);
      effectiveMapping = detection.mapping;
      effectiveHeader = detection.hasHeader;
      columns = detection.columns;
    }

    const plan = buildPlan(clean, effectiveMapping, effectiveHeader);
    res.json({
      hasHeader: effectiveHeader,
      mapping: effectiveMapping,
      columns,
      rowCount: clean.length,
      plan,
    });
  }),
);

router.post(
  '/import/commit',
  asyncHandler(async (req, res) => {
    const { rows, mapping, hasHeader, defaultEventId, defaultEventName, createMissingEvents } = parse(
      z.object({
        rows: z.array(z.array(z.any())).max(MAX_IMPORT_ROWS),
        mapping: mappingSchema,
        hasHeader: z.boolean().default(false),
        defaultEventId: z.string().optional(),
        defaultEventName: z.string().max(200).optional(),
        createMissingEvents: z.boolean().default(false),
      }),
      req.body,
    );
    const clean = sanitizeRows(rows);
    if (clean.length === 0) throw new ApiError(400, 'Keine verwertbaren Zeilen gefunden.');

    if (defaultEventId) {
      const ev = await getById(COL.events, defaultEventId);
      if (!ev) throw new ApiError(404, 'Ziel-Event nicht gefunden.');
    }

    const plan = buildPlan(clean, mapping as Mapping, hasHeader);
    const result = await commitImport(plan, {
      defaultEventId,
      defaultEventName,
      createMissingEvents,
    });
    await audit(
      'import.commit',
      `emails +${result.emailsCreated}, children +${result.childrenCreated}, links +${result.linksCreated}`,
    );
    res.json({ result });
  }),
);

// --- Orders --------------------------------------------------------------
router.get(
  '/orders',
  asyncHandler(async (_req, res) => {
    const orders = (await runQuery<{ status: string; total_cents: number; currency: string; created_at: string; email_id: string }>(
      col(COL.orders),
    ))
      .filter((o) => o.status !== 'cart')
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
      .slice(0, 300);
    const result = await Promise.all(
      orders.map(async (o) => {
        const e = await getById<{ email: string }>(COL.parentEmails, o.email_id);
        return {
          id: o.id,
          status: o.status,
          total_cents: o.total_cents,
          currency: o.currency,
          created_at: o.created_at,
          email: e?.email ?? '',
        };
      }),
    );
    res.json({ orders: result });
  }),
);

router.get(
  '/orders/:id',
  asyncHandler(async (req, res) => {
    const orderDoc = await getById<Record<string, unknown> & { email_id: string }>(COL.orders, req.params.id);
    if (!orderDoc) throw new ApiError(404, 'Bestellung nicht gefunden.');
    const parentEmail = await getById<{ email: string }>(COL.parentEmails, orderDoc.email_id);
    const order = { ...orderDoc, email: parentEmail?.email ?? '' };

    const rawItems = await runQuery<Record<string, unknown> & { photo_id: string }>(
      col(COL.orderItems).where('order_id', '==', req.params.id),
    );
    const items = await Promise.all(
      rawItems.map(async (oi) => {
        const photo = await getById<{ original_filename: string }>(COL.photos, oi.photo_id);
        return { ...oi, original_filename: photo?.original_filename ?? '' };
      }),
    );
    res.json({ order, items });
  }),
);

router.patch(
  '/orders/:id',
  asyncHandler(async (req, res) => {
    const { status } = parse(z.object({ status: z.enum(ORDER_STATUSES) }), req.body);
    await updateById(COL.orders, req.params.id, { status, updated_at: nowIso() });
    await audit('order.update', `${req.params.id}: ${status}`);
    res.json({ ok: true });
  }),
);

// --- Reports -------------------------------------------------------------
router.get(
  '/reports',
  asyncHandler(async (_req, res) => {
    const reports = (await runQuery<{ created_at: string }>(col(COL.reports)))
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
      .slice(0, 300);
    res.json({ reports });
  }),
);

router.patch(
  '/reports/:id',
  asyncHandler(async (req, res) => {
    const { status } = parse(z.object({ status: z.enum(['open', 'in_progress', 'resolved']) }), req.body);
    await updateById(COL.reports, req.params.id, { status });
    res.json({ ok: true });
  }),
);

// --- Products ------------------------------------------------------------
router.get(
  '/products',
  asyncHandler(async (_req, res) => {
    const products = (await runQuery<{ sort_order: number }>(col(COL.products))).sort(
      (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0),
    );
    res.json({ products });
  }),
);

router.post(
  '/products',
  asyncHandler(async (req, res) => {
    const data = parse(
      z.object({
        name: z.string().trim().min(1).max(200),
        description: z.string().max(2000).default(''),
        type: z.enum(['digital', 'print']),
        price_cents: z.number().int().min(0),
        sort_order: z.number().int().default(0),
      }),
      req.body,
    );
    const id = newId('prod');
    await setById(COL.products, id, {
      name: data.name,
      description: data.description,
      type: data.type,
      price_cents: data.price_cents,
      currency: config.stripe.currency,
      active: 1,
      sort_order: data.sort_order,
      created_at: nowIso(),
    });
    res.json({ id });
  }),
);

router.patch(
  '/products/:id',
  asyncHandler(async (req, res) => {
    const data = parse(
      z.object({
        name: z.string().trim().min(1).max(200).optional(),
        description: z.string().max(2000).optional(),
        price_cents: z.number().int().min(0).optional(),
        active: z.boolean().optional(),
        sort_order: z.number().int().optional(),
      }),
      req.body,
    );
    const map: Record<string, unknown> = { ...data };
    if (data.active !== undefined) map.active = data.active ? 1 : 0;
    if (Object.keys(map).length) {
      await updateById(COL.products, req.params.id, map);
    }
    res.json({ ok: true });
  }),
);

export default router;
