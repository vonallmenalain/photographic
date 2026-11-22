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
  // Doubled again on request so the "Vorschau" watermark is even more prominent.
  const fontSize = Math.max(64, Math.round(width / 5.5));
  // Vertical gap between tiled rows. Reduced (~63% tighter than the previous
  // 3.5) on request so the "Vorschau" rows sit closer together — more text,
  // smaller spacing — without changing the font size.
  const stepY = fontSize * 1.3;
  // Each row is a single, continuously repeated string ("Vorschau · Vorschau …")
  // so the whole image is filled instead of showing isolated words. The
  // separator is a vertically centred middle dot (·, U+00B7) as requested.
  const separator = ' \u00b7 ';
  const unit = text + separator;
  // Estimate how many repetitions are needed to span the (rotated) width. We
  // tile from -width to 2*width, i.e. a 3*width span, and add a little headroom.
  const approxUnitWidth = fontSize * 0.62 * unit.length;
  const repeats = Math.max(1, Math.ceil((width * 3) / approxUnitWidth) + 1);
  // Build the line and drop the trailing separator so it ends on the word.
  const line = unit.repeat(repeats).slice(0, -separator.length);
  const safeLine = escapeXml(line);
  // Font family for the watermark text. Configurable (IMG_WATERMARK_FONT_FAMILY)
  // so it stays in sync with the typeface used across the website (Comic Sans
  // MS, rendered with the bundled free "Comic Neue" in the container). librsvg
  // only renders text when it can resolve a font, so the configured value
  // keeps the families we always ship ("Liberation Sans"/"DejaVu Sans") as
  // fallbacks; the font files are installed into the runtime image (see
  // backend/Dockerfile).
  const fontFamily = config.images.watermarkFontFamily;
  const texts: string[] = [];
  for (let y = -height; y < height * 2; y += stepY) {
    texts.push(
      `<text x="${-width}" y="${y}" font-family="${fontFamily}" font-size="${fontSize}" font-weight="700" fill="#ffffff" fill-opacity="0.34" stroke="#000000" stroke-opacity="0.12" stroke-width="0.6">${safeLine}</text>`,
    );
  }
  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <g transform="rotate(-30 ${width / 2} ${height / 2})">${texts.join('')}</g>
  </svg>`;
  return Buffer.from(svg);
}

// ---------------------------------------------------------------------------
// Wasserzeichen mit dem Schriftzug der Fotografin
// ---------------------------------------------------------------------------

/**
 * Gestaltung des Schriftzug-Wasserzeichens. Bewusst an einer Stelle gebündelt,
 * damit sich Grösse/Dichte/Deckkraft leicht nachjustieren lassen.
 */
const SIGNATURE_WM = {
  /**
   * Breite eines Schriftzugs: das Kleinere aus `scale` × längere Bildseite und
   * `maxShortSide` × kürzere Bildseite. Bei üblichen Formaten (3:2, 4:3) gibt
   * die kürzere Seite den Ausschlag, Hoch- und Querformat erhalten also
   * gleich grosse Schriftzüge. Bewusst grösser als das Bild: Jeder Schriftzug
   * zieht sich als breites Band quer durch das Foto (auf Wunsch zweimal
   * verdoppelt). Der Name ist dadurch nur noch in Teilen lesbar, deckt aber
   * viel mehr ab.
   */
  scale: 1.68,
  maxShortSide: 2.1,
  /** Horizontaler Abstand (Mitte zu Mitte) als Vielfaches der Schriftzugbreite. */
  gapX: 1.02,
  /**
   * Zeilenabstand als Vielfaches der Schriftzughöhe. Unter 1, weil Ober- und
   * Unterlängen benachbarter Reihen ineinandergreifen; sonst blieben bei der
   * grossen Schrift breite Streifen ohne Wasserzeichen. (0.75 deckt noch
   * dichter ab, die Reihen überlagern sich dann aber unruhig.)
   */
  gapY: 0.9,
  /** Drehung des ganzen Musters in Grad (negativ = steigt nach rechts an). */
  angle: -20,
  /** Gesamtdeckkraft (Schriftzug + Schatten). */
  opacity: 0.55,
  /**
   * Stärke des weichen, dunklen Schattens unter dem weissen Schriftzug. Ohne
   * ihn verschwindet der Schriftzug auf hellem Himmel, Schnee oder weissen
   * Wänden fast vollständig.
   */
  shadow: 0.55,
};

let signatureSource: Promise<Buffer | null> | null = null;

/** Liest das Schriftzug-PNG einmal ein; null, wenn keins konfiguriert/vorhanden ist. */
function loadSignature(): Promise<Buffer | null> {
  if (!signatureSource) {
    const file = config.images.watermarkImage.trim();
    signatureSource = file
      ? fsp.readFile(file).catch((err) => {
          // eslint-disable-next-line no-console
          console.warn(
            `[images] WARNING: Wasserzeichen-Schriftzug ${file} nicht lesbar – verwende Text-Wasserzeichen.`,
            err instanceof Error ? err.message : err,
          );
          return null;
        })
      : Promise.resolve(null);
  }
  return signatureSource;
}

interface SignatureTile {
  png: Buffer;
  width: number;
  height: number;
}

// Fertige Kacheln je Schriftzugbreite. Thumbnails und Previews haben fast immer
// dieselbe längere Seite (IMG_THUMB_MAX / IMG_PREVIEW_MAX), es entstehen also
// nur wenige Einträge; die Obergrenze schützt trotzdem vor Wachstum.
const tileCache = new Map<number, Promise<SignatureTile>>();
const TILE_CACHE_MAX = 24;

/**
 * Skaliert den Schriftzug auf `targetWidth` und legt einen weichgezeichneten
 * dunklen Schatten darunter – eine einzelne Kachel, die das SVG anschliessend
 * vielfach wiederholt.
 */
function signatureTile(source: Buffer, targetWidth: number): Promise<SignatureTile> {
  const cached = tileCache.get(targetWidth);
  if (cached) return cached;
  const build = (async (): Promise<SignatureTile> => {
    const resized = await sharp(source)
      .resize({ width: targetWidth })
      .png()
      .toBuffer({ resolveWithObject: true });
    // Rand, damit der Schatten nicht abgeschnitten wird.
    const pad = Math.max(2, Math.ceil(targetWidth / 60));
    const padded = await sharp(resized.data)
      .extend({ top: pad, bottom: pad, left: pad, right: pad, background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer({ resolveWithObject: true });
    const { width, height } = padded.info;
    const shadowAlpha = await sharp(padded.data)
      .extractChannel('alpha')
      .blur(Math.max(0.8, targetWidth / 260))
      .linear(SIGNATURE_WM.shadow, 0)
      .toBuffer();
    // Zwei getrennte Pipelines: sharp würde composite() sonst vor
    // joinChannel() ausführen (3 statt 4 Kanäle → Fehler).
    const shadow = await sharp({ create: { width, height, channels: 3, background: { r: 0, g: 0, b: 0 } } })
      .joinChannel(shadowAlpha)
      .png()
      .toBuffer();
    const png = await sharp(shadow).composite([{ input: padded.data }]).png().toBuffer();
    return { png, width, height };
  })();
  if (tileCache.size >= TILE_CACHE_MAX) tileCache.clear();
  tileCache.set(targetWidth, build);
  build.catch(() => tileCache.delete(targetWidth));
  return build;
}

/**
 * Kachelt den Schriftzug versetzt (Mauerwerk-Muster) und leicht gedreht über
 * das ganze Bild. Mehrere Wiederholungen statt eines einzelnen Logos, damit
 * sich das Wasserzeichen nicht einfach wegschneiden oder wegretuschieren lässt.
 */
async function signatureWatermarkSvg(width: number, height: number, source: Buffer): Promise<Buffer> {
  const sigWidth = Math.max(
    60,
    Math.round(
      Math.min(
        Math.max(width, height) * SIGNATURE_WM.scale,
        Math.min(width, height) * SIGNATURE_WM.maxShortSide,
      ),
    ),
  );
  const tile = await signatureTile(source, sigWidth);
  const href = `data:image/png;base64,${tile.png.toString('base64')}`;
  const stepX = tile.width * SIGNATURE_WM.gapX;
  const stepY = tile.height * SIGNATURE_WM.gapY;
  // Das Muster wird um die Bildmitte gedreht; über die Diagonale in jede
  // Richtung zu kacheln stellt sicher, dass auch die Ecken bedeckt sind.
  const reach = Math.hypot(width, height);
  const cx = width / 2 - tile.width / 2;
  const cy = height / 2 - tile.height / 2;
  const uses: string[] = [];
  let row = 0;
  for (let y = -reach; y <= reach; y += stepY, row += 1) {
    const offset = row % 2 ? stepX / 2 : 0;
    for (let x = -reach + offset; x <= reach; x += stepX) {
      uses.push(`<use href="#sig" xlink:href="#sig" x="${(cx + x).toFixed(1)}" y="${(cy + y).toFixed(1)}"/>`);
    }
  }
  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
    <defs><image id="sig" width="${tile.width}" height="${tile.height}" href="${href}" xlink:href="${href}"/></defs>
    <g opacity="${SIGNATURE_WM.opacity}" transform="rotate(${SIGNATURE_WM.angle} ${width / 2} ${height / 2})">${uses.join('')}</g>
  </svg>`;
  return Buffer.from(svg);
}

/** Welche Art Wasserzeichen aktuell verwendet wird. */
export async function watermarkMode(): Promise<'signature' | 'text'> {
  return (await loadSignature()) ? 'signature' : 'text';
}

/**
 * Overlay für ein Bild der Grösse width×height: der Schriftzug der Fotografin,
 * sofern vorhanden, sonst das Text-Wasserzeichen.
 */
async function watermarkOverlay(width: number, height: number): Promise<Buffer> {
  const signature = await loadSignature();
  if (signature) return signatureWatermarkSvg(width, height, signature);
  return watermarkSvg(width, height, config.images.watermarkText);
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

  const overlay = await watermarkOverlay(w, h);

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
 * Renders a small watermarked test tile and checks that the overlay was
 * actually drawn. For the text fallback this catches missing fonts (common on
 * slim base images: librsvg then silently produces an empty overlay); for the
 * signature it catches an unreadable PNG. Either way previews would ship
 * WITHOUT a watermark, so we surface that as a loud warning on startup instead
 * of failing quietly. Returns true when the watermark renders, false otherwise.
 */
export async function checkWatermarkRendering(): Promise<boolean> {
  try {
    const w = 600;
    const h = 400;
    const overlay = await watermarkOverlay(w, h);
    // Composite onto a perfectly flat grey tile. A working watermark adds
    // clear pixel variation; a broken one leaves the result essentially flat.
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
        (await watermarkMode()) === 'signature'
          ? '[images] WARNING: watermark signature did not render. Previews will NOT be watermarked. ' +
              'Check IMG_WATERMARK_IMAGE / backend/assets/watermark/schriftzug.png.'
          : '[images] WARNING: watermark text did not render — no usable fonts found. ' +
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
 * Kleines, quadratisches Miniaturbild für E-Mails (Bestellbestätigung). Die
 * Eltern haben das Foto gekauft, deshalb dient das saubere Admin-Thumbnail ohne
 * Wasserzeichen als Grundlage; fehlt es, wird auf das Eltern-Thumbnail
 * zurückgegriffen. `size` ist die Kantenlänge in Pixeln – doppelt so gross wie
 * die Anzeige in der E-Mail (64 px), damit es auf hochauflösenden Displays scharf
 * bleibt. Der Ausschnitt folgt dem auffälligsten Bildbereich (meist das
 * Gesicht), statt stur die Bildmitte zu nehmen. Liefert null, wenn kein Bild
 * vorliegt.
 */
export async function mailThumbnail(storageKey: string, size = 128): Promise<Buffer | null> {
  if (!storageKey) return null;
  for (const variant of ['admin', 'thumb'] as const) {
    const p = variantPath(variant, storageKey);
    if (!fs.existsSync(p)) continue;
    try {
      return await sharp(p, { failOn: 'none' })
        .resize(size, size, { fit: 'cover', position: sharp.strategy.attention })
        .jpeg({ quality: 80, mozjpeg: true })
        .toBuffer();
    } catch {
      // Datei beschädigt → nächste Variante versuchen.
    }
  }
  return null;
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
