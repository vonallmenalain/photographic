import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { getDb } from '../db';
import { asyncHandler, ApiError } from '../middleware/errorHandler';
import { verifyFileToken } from '../lib/auth';
import { requireParent } from '../middleware/parentAuth';
import { variantPath, Variant } from '../lib/images';

const router = Router();

function sendFileSafe(res: import('express').Response, filePath: string, contentType: string, download?: string) {
  if (!fs.existsSync(filePath)) {
    throw new ApiError(404, 'Datei nicht gefunden.');
  }
  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'private, no-store');
  // Discourage indexing / embedding of protected previews.
  res.setHeader('X-Robots-Tag', 'noindex, noimageindex');
  if (download) {
    res.setHeader('Content-Disposition', `attachment; filename="${download}"`);
  }
  fs.createReadStream(filePath).pipe(res);
}

/**
 * Serves a watermarked variant (thumb/preview) using a short-lived signed
 * token bound to the photo id + variant. Tokens are only handed out by the
 * parent photo endpoints after the access check succeeds. Originals are NEVER
 * available here.
 */
router.get(
  '/preview-image',
  asyncHandler(async (req, res) => {
    const token = String(req.query.token ?? '');
    const payload = verifyFileToken(token);
    if (!payload) throw new ApiError(403, 'Zugriff nicht möglich.');
    if (payload.v !== 'thumb' && payload.v !== 'preview') {
      throw new ApiError(403, 'Zugriff nicht möglich.');
    }
    const db = getDb();
    const photo = db
      .prepare('SELECT storage_key, ext FROM photos WHERE id = ?')
      .get(payload.pid) as { storage_key: string; ext: string } | undefined;
    if (!photo) throw new ApiError(404, 'Datei nicht gefunden.');
    sendFileSafe(res, variantPath(payload.v as Variant, photo.storage_key), 'image/jpeg');
  }),
);

/**
 * Post-purchase download of the original. Requires a valid download grant AND
 * a matching verified parent session (defense in depth).
 */
router.get(
  '/download/:token',
  requireParent,
  asyncHandler(async (req, res) => {
    const db = getDb();
    const grant = db
      .prepare(
        `SELECT dg.id, dg.photo_id, dg.email_id, dg.expires_at, ph.storage_key, ph.ext, ph.original_filename
         FROM download_grants dg JOIN photos ph ON ph.id = dg.photo_id
         WHERE dg.token = ?`,
      )
      .get(req.params.token) as
      | {
          id: string;
          photo_id: string;
          email_id: string;
          expires_at: string | null;
          storage_key: string;
          ext: string;
          original_filename: string;
        }
      | undefined;

    if (!grant || grant.email_id !== req.parent!.emailId) {
      throw new ApiError(403, 'Download nicht möglich.');
    }
    if (grant.expires_at && new Date(grant.expires_at).getTime() < Date.now()) {
      throw new ApiError(410, 'Dieser Download-Link ist abgelaufen.');
    }
    db.prepare('UPDATE download_grants SET downloads = downloads + 1 WHERE id = ?').run(grant.id);
    const filePath = variantPath('original', grant.storage_key, grant.ext);
    const safeName = path.basename(grant.original_filename) || `foto.${grant.ext}`;
    sendFileSafe(res, filePath, 'application/octet-stream', safeName);
  }),
);

export default router;
