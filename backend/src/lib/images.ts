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
  const fontSize = Math.max(16, Math.round(width / 22));
  const stepX = fontSize * 11;
  const stepY = fontSize * 6;
  const texts: string[] = [];
  for (let y = -height; y < height * 2; y += stepY) {
    for (let x = -width; x < width * 2; x += stepX) {
      texts.push(
        `<text x="${x}" y="${y}" font-family="Helvetica, Arial, sans-serif" font-size="${fontSize}" font-weight="700" fill="#ffffff" fill-opacity="0.34" stroke="#000000" stroke-opacity="0.12" stroke-width="0.6">${safe}</text>`,
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

export function fileExists(p: string): boolean {
  return fs.existsSync(p);
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
    }),
  );
}
