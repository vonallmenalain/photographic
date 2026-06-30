import { Router } from 'express';
import archiver from 'archiver';
import fs from 'fs';
import path from 'path';
import { COL, col, getById, firstOf, updateById, runQuery } from '../db';
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

interface DownloadGrantDoc {
  photo_id: string;
  email_id: string;
  expires_at: string | null;
  downloads: number;
}

interface PhotoForZip {
  storage_key: string;
  ext: string;
  original_filename: string;
  event_id: string;
}

/**
 * Ensures every entry in the ZIP gets a unique, filesystem-safe name. Several
 * photos can share the same original file name, so collisions are resolved by
 * appending " (2)", " (3)", … before the extension.
 */
function uniqueZipName(raw: string, fallbackExt: string, used: Set<string>): string {
  let base = path.basename(raw || '').trim();
  if (!base) base = `foto.${fallbackExt}`;
  const ext = path.extname(base);
  const stem = ext ? base.slice(0, -ext.length) : base;
  let candidate = base;
  let n = 2;
  while (used.has(candidate.toLowerCase())) {
    candidate = `${stem} (${n})${ext}`;
    n += 1;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

/**
 * Bundles every still-downloadable digital photo of one order into a single ZIP
 * and streams it to the parent. This replaces firing off one download per photo
 * in the browser. The same defense-in-depth checks as the single-file download
 * apply per photo: a matching download grant for this parent, a non-expired
 * grant and an available (published, non-archived) Auftrag.
 */
router.get(
  '/download-all/:orderId',
  requireParent,
  asyncHandler(async (req, res) => {
    const grants = await runQuery<DownloadGrantDoc>(
      col(COL.downloadGrants).where('order_id', '==', req.params.orderId),
    );
    const ownGrants = grants.filter((g) => g.email_id === req.parent!.emailId);
    if (ownGrants.length === 0) {
      throw new ApiError(404, 'Für diese Bestellung stehen keine Downloads bereit.');
    }

    // Resolve each grant to a concrete, currently downloadable original file.
    const now = Date.now();
    const usedNames = new Set<string>();
    const files: { path: string; name: string; grantId: string; downloads: number }[] = [];

    for (const grant of ownGrants) {
      if (grant.expires_at && new Date(grant.expires_at).getTime() < now) continue;
      const photo = await getById<PhotoForZip>(COL.photos, grant.photo_id);
      if (!photo) continue;
      const event = await getById<{ status: string; expires_at: string | null }>(
        COL.events,
        photo.event_id,
      );
      if (!eventIsAvailable(event)) continue;
      const filePath = variantPath('original', photo.storage_key, photo.ext);
      if (!fs.existsSync(filePath)) continue;
      files.push({
        path: filePath,
        name: uniqueZipName(photo.original_filename, photo.ext, usedNames),
        grantId: grant.id,
        downloads: grant.downloads ?? 0,
      });
    }

    if (files.length === 0) {
      throw new ApiError(410, 'Die Fotos dieser Bestellung sind nicht mehr verfügbar.');
    }

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Robots-Tag', 'noindex, noimageindex');
    const safeOrderId = path.basename(req.params.orderId).replace(/[^a-zA-Z0-9_-]/g, '');
    res.setHeader('Content-Disposition', `attachment; filename="fotos-${safeOrderId || 'bestellung'}.zip"`);

    // Originals are JPEGs (already compressed), so skip deflate to save CPU.
    const archive = archiver('zip', { store: true });
    archive.on('warning', (err) => {
      // eslint-disable-next-line no-console
      console.warn('[download-all] archive warning', err);
    });
    archive.on('error', (err) => {
      // eslint-disable-next-line no-console
      console.error('[download-all] archive error', err);
      res.destroy(err);
    });
    archive.pipe(res);

    for (const file of files) {
      archive.file(file.path, { name: file.name });
    }
    await archive.finalize();

    // Count the bundled download against each grant, mirroring the single-file
    // route. Done after finalize so a failed stream is not counted.
    await Promise.all(
      files.map((file) =>
        updateById(COL.downloadGrants, file.grantId, { downloads: file.downloads + 1 }).catch(
          () => undefined,
        ),
      ),
    );
  }),
);

export default router;
