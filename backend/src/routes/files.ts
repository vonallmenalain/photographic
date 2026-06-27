import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { COL, col, getById, firstOf, updateById } from '../db';
import { asyncHandler, ApiError } from '../middleware/errorHandler';
import { verifyFileToken } from '../lib/auth';
import { requireParent } from '../middleware/parentAuth';
import { variantPath, Variant } from '../lib/images';
import { eventIsAvailable } from '../services/events';

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
    const photo = await getById<{ storage_key: string; ext: string }>(COL.photos, payload.pid);
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
    const grant = await firstOf<{
      photo_id: string;
      email_id: string;
      expires_at: string | null;
      downloads: number;
    }>(col(COL.downloadGrants).where('token', '==', req.params.token));

    if (!grant || grant.email_id !== req.parent!.emailId) {
      throw new ApiError(403, 'Download nicht möglich.');
    }
    if (grant.expires_at && new Date(grant.expires_at).getTime() < Date.now()) {
      throw new ApiError(410, 'Dieser Download-Link ist abgelaufen.');
    }
    const photo = await getById<{
      storage_key: string;
      ext: string;
      original_filename: string;
      event_id: string;
    }>(COL.photos, grant.photo_id);
    if (!photo) throw new ApiError(404, 'Datei nicht gefunden.');

    // Downloads stay valid only while the underlying Auftrag/event is available
    // (published and within its retention window). Once the event is archived or
    // the retention period (default 30 days) has passed, the download is disabled
    // even though the grant document still exists.
    const event = await getById<{ status: string; expires_at: string | null }>(
      COL.events,
      photo.event_id,
    );
    if (!eventIsAvailable(event)) {
      throw new ApiError(410, 'Die Fotos dieses Auftrags sind nicht mehr verfügbar.');
    }

    await updateById(COL.downloadGrants, grant.id, { downloads: (grant.downloads ?? 0) + 1 });
    const filePath = variantPath('original', photo.storage_key, photo.ext);
    const safeName = path.basename(photo.original_filename) || `foto.${photo.ext}`;
    sendFileSafe(res, filePath, 'application/octet-stream', safeName);
  }),
);

export default router;
