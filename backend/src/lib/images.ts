import sharp from 'sharp';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { config } from '../config';

export type Variant = 'original' | 'admin' | 'thumb' | 'preview';

const SUBDIR: Record<Variant, string> = {
  original: 'originals',
  admin: 'admin',
  thumb: 'thumbs',
  preview: 'previews',
};

export function variantPath(variant: Variant, storageKey: string, ext = 'jpg'): string {
  const e = variant === 'original' ? ext : 'jpg';
  return path.join(config.storageDir, SUBDIR[variant], `${storageKey}.${e}`);
}

async function ensureDir(filePath: string) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
}

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c] as string),
  );
}

/**
 * Builds a diagonally tiled watermark as an SVG overlay. Visible enough to
 * deter printing/screenshots but light enough to still judge the photo.
 */
function watermarkSvg(width: number, height: number, text: string): Buffer {
  const safe = escapeXml(text);
  // Doubled again on request so the "Vorschau" watermark is even more prominent.
  const fontSize = Math.max(64, Math.round(width / 5.5));
  // Estimate the rendered text width and add a gap so tiled repetitions of the
  // word sit next to each other instead of overlapping.
  const approxTextWidth = fontSize * 0.62 * text.length;
  const stepX = approxTextWidth + fontSize * 1.6;
  const stepY = fontSize * 3.5;
  // Use font families that are actually installed in the runtime image
  // (see backend/Dockerfile). librsvg only renders text when it can resolve a
  // font; "Liberation Sans"/"DejaVu Sans" are the metric-compatible packages we
  // ship, with the generic fallbacks kept for local development.
  const fontFamily = "'Liberation Sans', 'DejaVu Sans', Arial, Helvetica, sans-serif";
  const texts: string[] = [];
  for (let y = -height; y < height * 2; y += stepY) {
    for (let x = -width; x < width * 2; x += stepX) {
      texts.push(
        `<text x="${x}" y="${y}" font-family="${fontFamily}" font-size="${fontSize}" font-weight="700" fill="#ffffff" fill-opacity="0.34" stroke="#000000" stroke-opacity="0.12" stroke-width="0.6">${safe}</text>`,
      );
    }
  }
  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <g transform="rotate(-30 ${width / 2} ${height / 2})">${texts.join('')}</g>
  </svg>`;
  return Buffer.from(svg);
}

export interface ProcessResult {
  width: number;
  height: number;
  bytes: number;
}

/**
 * Stores the original untouched, then derives an (unwatermarked, admin-only)
 * thumbnail plus watermarked thumb + preview for parents.
 */
export async function processOriginal(
  buffer: Buffer,
  storageKey: string,
  ext: string,
): Promise<ProcessResult> {
  const originalDest = variantPath('original', storageKey, ext);
  await ensureDir(originalDest);
  await fsp.writeFile(originalDest, buffer);

  const image = sharp(buffer, { failOn: 'none' }).rotate(); // honour EXIF orientation
  const meta = await image.metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;

  // Admin thumbnail (clean, small, admin auth required).
  const adminDest = variantPath('admin', storageKey);
  await ensureDir(adminDest);
  await sharp(buffer, { failOn: 'none' })
    .rotate()
    .resize(config.images.adminThumbMax, config.images.adminThumbMax, {
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: 70 })
    .toFile(adminDest);

  await renderWatermarked(buffer, storageKey, 'thumb', config.images.thumbMax, config.images.thumbQuality);
  await renderWatermarked(
    buffer,
    storageKey,
    'preview',
    config.images.previewMax,
    config.images.previewQuality,
  );

  return { width, height, bytes: buffer.length };
}

async function renderWatermarked(
  buffer: Buffer,
  storageKey: string,
  variant: 'thumb' | 'preview',
  maxSize: number,
  quality: number,
) {
  const dest = variantPath(variant, storageKey);
  await ensureDir(dest);

  const base = sharp(buffer, { failOn: 'none' })
    .rotate()
    .resize(maxSize, maxSize, { fit: 'inside', withoutEnlargement: true });

  const resizedMeta = await base.clone().toBuffer({ resolveWithObject: true });
  const w = resizedMeta.info.width;
  const h = resizedMeta.info.height;

  const overlay = watermarkSvg(w, h, config.images.watermarkText);

  await sharp(resizedMeta.data)
    .composite([{ input: overlay, top: 0, left: 0 }])
    // Slight blur on the preview keeps faces judgeable but defeats high quality reprints.
    .jpeg({ quality, mozjpeg: true })
    .toFile(dest);
}

/** Re-runs variant generation from the stored original (admin "reprocess"). */
export async function reprocessFromOriginal(storageKey: string, ext: string): Promise<ProcessResult> {
  const originalPath = variantPath('original', storageKey, ext);
  const buffer = await fsp.readFile(originalPath);
  return processOriginal(buffer, storageKey, ext);
}

/**
 * Renders a small watermarked test tile and checks that the overlay text was
 * actually drawn. If no fonts are installed (common on slim base images),
 * librsvg silently produces an empty overlay and previews would ship WITHOUT a
 * watermark. We surface that as a loud warning on startup instead of failing
 * quietly. Returns true when watermark text renders, false otherwise.
 */
export async function checkWatermarkRendering(): Promise<boolean> {
  try {
    const w = 600;
    const h = 400;
    const overlay = watermarkSvg(w, h, config.images.watermarkText);
    // Composite onto a perfectly flat grey tile. With fonts the watermark text
    // adds clear pixel variation; without usable fonts the overlay is (near)
    // empty and the result stays essentially flat.
    const flat = await sharp({
      create: { width: w, height: h, channels: 3, background: { r: 128, g: 128, b: 128 } },
    })
      .jpeg()
      .toBuffer();
    const composited = await sharp(flat)
      .composite([{ input: overlay, top: 0, left: 0 }])
      .raw()
      .toBuffer();
    const stats = await sharp(composited, { raw: { width: w, height: h, channels: 3 } }).stats();
    const maxStdev = Math.max(...stats.channels.map((c) => c.stdev));
    const ok = maxStdev > 3;
    if (!ok) {
      // eslint-disable-next-line no-console
      console.warn(
        '[images] WARNING: watermark text did not render — no usable fonts found. ' +
          'Previews will NOT be watermarked. Install fonts (e.g. fontconfig + fonts-dejavu-core) in the runtime image.',
      );
    }
    return ok;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[images] WARNING: watermark self-check failed', err);
    return false;
  }
}

export function fileExists(p: string): boolean {
  return fs.existsSync(p);
}

/**
 * Walks up from a (now deleted) file and removes parent directories as long as
 * they are empty, stopping at the storage root. Photos are stored under a
 * per-event sub-folder (`<variant>/<eventId>/<photoId>.<ext>`); without this the
 * empty `<eventId>` folders would pile up after every photo/event deletion.
 */
async function removeEmptyParents(filePath: string) {
  const root = path.resolve(config.storageDir);
  let dir = path.dirname(path.resolve(filePath));
  // Only ever clean up *inside* the storage root, and never the root itself.
  while (dir !== root && dir.startsWith(root + path.sep)) {
    try {
      await fsp.rmdir(dir); // succeeds only when the directory is empty
    } catch {
      break; // not empty (or already gone) -> nothing more to clean up
    }
    dir = path.dirname(dir);
  }
}

export async function deleteAllVariants(storageKey: string, ext: string) {
  const targets: string[] = [
    variantPath('original', storageKey, ext),
    variantPath('admin', storageKey),
    variantPath('thumb', storageKey),
    variantPath('preview', storageKey),
  ];
  await Promise.all(
    targets.map(async (t) => {
      try {
        await fsp.unlink(t);
      } catch {
        /* ignore missing */
      }
      await removeEmptyParents(t);
    }),
  );
}

/**
 * Removes every stored variant directory for a whole event. Used when an event
 * is deleted so no empty (or stray) `<variant>/<eventId>` folders remain behind,
 * even if some files were not tracked individually.
 */
export async function deleteEventStorage(eventId: string) {
  if (!eventId) return;
  await Promise.all(
    (Object.keys(SUBDIR) as Variant[]).map(async (variant) => {
      const dir = path.join(config.storageDir, SUBDIR[variant], eventId);
      try {
        await fsp.rm(dir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
      // Drop the now-empty variant sub-folder too if this was the last event.
      await removeEmptyParents(dir);
    }),
  );
}
