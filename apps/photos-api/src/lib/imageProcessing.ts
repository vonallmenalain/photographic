import { randomUUID } from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const WATERMARK_TEXT = "VORSCHAU";
const WATERMARK_ANGLE_DEGREES = -32;
const PREVIEW_MAX_SIZE = 1200;
const PREVIEW_QUALITY = 62;
const PREVIEW_BLUR_SIGMA = 1.15;
const THUMB_MAX_SIZE = 400;
const THUMB_QUALITY = 78;

export type GeneratedImageVariant = {
  width: number;
  height: number;
  fileSize: number;
};

export type GeneratedPhotoDerivatives = {
  width: number;
  height: number;
  preview: GeneratedImageVariant;
  thumb: GeneratedImageVariant;
};

export type GeneratePhotoDerivativeOptions = {
  overwrite?: boolean;
};

type TempImageVariant = GeneratedImageVariant & {
  tempPath: string;
  finalPath: string;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;");
}

function temporaryOutputPath(finalPath: string) {
  const parsed = path.parse(finalPath);
  return path.join(parsed.dir, `.${parsed.name}.${randomUUID()}.tmp${parsed.ext}`);
}

async function safeUnlink(filePath: string) {
  try {
    await fsp.unlink(filePath);
  } catch {
    // Best effort cleanup only.
  }
}

async function assertTargetCanBeWritten(finalPath: string, overwrite: boolean) {
  if (overwrite) {
    return;
  }

  try {
    await fsp.access(finalPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }
    throw error;
  }

  throw new Error(`Target file already exists: ${finalPath}`);
}

async function fileSize(filePath: string) {
  const stat = await fsp.stat(filePath);
  return stat.size;
}

async function moveTempVariant(variant: TempImageVariant, overwrite: boolean) {
  await assertTargetCanBeWritten(variant.finalPath, overwrite);
  await fsp.rename(variant.tempPath, variant.finalPath);
}

function createWatermarkText({
  x,
  y,
  fontSize,
  fillOpacity,
  strokeOpacity,
  strokeWidth,
  shadowOffset
}: {
  x: number;
  y: number;
  fontSize: number;
  fillOpacity: number;
  strokeOpacity: number;
  strokeWidth: number;
  shadowOffset: number;
}) {
  const text = escapeXml(WATERMARK_TEXT);
  const letterSpacing = Math.round(fontSize * 0.055);

  return `
    <text x="${x + shadowOffset}" y="${y + shadowOffset}" text-anchor="middle" dominant-baseline="middle"
      font-family="Arial, Helvetica, sans-serif" font-size="${fontSize}" font-weight="900"
      letter-spacing="${letterSpacing}" fill="#111827" fill-opacity="${strokeOpacity * 0.8}"
      stroke="#111827" stroke-opacity="${strokeOpacity}" stroke-width="${strokeWidth * 1.25}"
      paint-order="stroke fill">${text}</text>
    <text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="middle"
      font-family="Arial, Helvetica, sans-serif" font-size="${fontSize}" font-weight="900"
      letter-spacing="${letterSpacing}" fill="#ffffff" fill-opacity="${fillOpacity}"
      stroke="#111827" stroke-opacity="${strokeOpacity}" stroke-width="${strokeWidth}"
      paint-order="stroke fill">${text}</text>`;
}

function createPreviewWatermarkSvg(width: number, height: number) {
  const minSide = Math.min(width, height);
  const fontSize = Math.round(clamp(minSide * 0.112, 58, 128));
  const centerFontSize = Math.round(clamp(minSide * 0.22, 112, 260));
  const tileX = Math.round(fontSize * 6.8);
  const tileY = Math.round(fontSize * 2.15);
  const diagonal = Math.ceil(Math.hypot(width, height));
  const centerX = Math.round(width / 2);
  const centerY = Math.round(height / 2);
  const textElements: string[] = [];

  for (let y = -diagonal; y <= height + diagonal; y += tileY) {
    for (let x = -diagonal; x <= width + diagonal; x += tileX) {
      textElements.push(
        createWatermarkText({
          x,
          y,
          fontSize,
          fillOpacity: 0.42,
          strokeOpacity: 0.5,
          strokeWidth: Math.max(4, Math.round(fontSize * 0.085)),
          shadowOffset: Math.max(2, Math.round(fontSize * 0.035))
        })
      );
    }
  }

  const centerText = createWatermarkText({
    x: centerX,
    y: centerY,
    fontSize: centerFontSize,
    fillOpacity: 0.62,
    strokeOpacity: 0.72,
    strokeWidth: Math.max(7, Math.round(centerFontSize * 0.075)),
    shadowOffset: Math.max(4, Math.round(centerFontSize * 0.032))
  });

  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <rect width="100%" height="100%" fill="none"/>
      <g transform="rotate(${WATERMARK_ANGLE_DEGREES} ${centerX} ${centerY})">
        ${textElements.join("\n")}
        ${centerText}
      </g>
    </svg>`
  );
}

export async function readOriginalImageDimensions(originalAbsolutePath: string) {
  const metadata = await sharp(originalAbsolutePath).metadata();
  const width = metadata.width || 0;
  const height = metadata.height || 0;
  const orientation = metadata.orientation || 1;

  if ([5, 6, 7, 8].includes(orientation)) {
    return { width: height, height: width };
  }

  return { width, height };
}

async function renderWatermarkedPreviewToTemp(
  originalAbsolutePath: string,
  previewAbsolutePath: string
): Promise<TempImageVariant> {
  await fsp.mkdir(path.dirname(previewAbsolutePath), { recursive: true });
  const tempPath = temporaryOutputPath(previewAbsolutePath);

  try {
    const resized = await sharp(originalAbsolutePath)
      .rotate()
      .resize({
        width: PREVIEW_MAX_SIZE,
        height: PREVIEW_MAX_SIZE,
        fit: "inside",
        withoutEnlargement: true
      })
      .blur(PREVIEW_BLUR_SIGMA)
      .toColorspace("srgb")
      .removeAlpha()
      .png()
      .toBuffer({ resolveWithObject: true });

    const watermark = createPreviewWatermarkSvg(resized.info.width, resized.info.height);
    const output = await sharp(resized.data)
      .composite([{ input: watermark, top: 0, left: 0, blend: "over" }])
      .webp({ quality: PREVIEW_QUALITY, effort: 5, smartSubsample: true })
      .toFile(tempPath);

    return {
      tempPath,
      finalPath: previewAbsolutePath,
      width: output.width,
      height: output.height,
      fileSize: await fileSize(tempPath)
    };
  } catch (error) {
    await safeUnlink(tempPath);
    throw error;
  }
}

async function renderThumbnailToTemp(
  originalAbsolutePath: string,
  thumbAbsolutePath: string
): Promise<TempImageVariant> {
  await fsp.mkdir(path.dirname(thumbAbsolutePath), { recursive: true });
  const tempPath = temporaryOutputPath(thumbAbsolutePath);

  try {
    const output = await sharp(originalAbsolutePath)
      .rotate()
      .resize({
        width: THUMB_MAX_SIZE,
        height: THUMB_MAX_SIZE,
        fit: "inside",
        withoutEnlargement: true
      })
      .toColorspace("srgb")
      .removeAlpha()
      .webp({ quality: THUMB_QUALITY, effort: 4, smartSubsample: true })
      .toFile(tempPath);

    return {
      tempPath,
      finalPath: thumbAbsolutePath,
      width: output.width,
      height: output.height,
      fileSize: await fileSize(tempPath)
    };
  } catch (error) {
    await safeUnlink(tempPath);
    throw error;
  }
}

export async function createWatermarkedPreview(
  originalAbsolutePath: string,
  previewAbsolutePath: string,
  options: GeneratePhotoDerivativeOptions = {}
): Promise<GeneratedImageVariant> {
  const overwrite = options.overwrite ?? false;
  await assertTargetCanBeWritten(previewAbsolutePath, overwrite);
  const preview = await renderWatermarkedPreviewToTemp(originalAbsolutePath, previewAbsolutePath);

  try {
    await moveTempVariant(preview, overwrite);
    return {
      width: preview.width,
      height: preview.height,
      fileSize: preview.fileSize
    };
  } catch (error) {
    await safeUnlink(preview.tempPath);
    throw error;
  }
}

export async function createThumbnail(
  originalAbsolutePath: string,
  thumbAbsolutePath: string,
  options: GeneratePhotoDerivativeOptions = {}
): Promise<GeneratedImageVariant> {
  const overwrite = options.overwrite ?? false;
  await assertTargetCanBeWritten(thumbAbsolutePath, overwrite);
  const thumb = await renderThumbnailToTemp(originalAbsolutePath, thumbAbsolutePath);

  try {
    await moveTempVariant(thumb, overwrite);
    return {
      width: thumb.width,
      height: thumb.height,
      fileSize: thumb.fileSize
    };
  } catch (error) {
    await safeUnlink(thumb.tempPath);
    throw error;
  }
}

export async function generatePhotoDerivatives(
  originalAbsolutePath: string,
  previewAbsolutePath: string,
  thumbAbsolutePath: string,
  options: GeneratePhotoDerivativeOptions = {}
): Promise<GeneratedPhotoDerivatives> {
  const overwrite = options.overwrite ?? false;
  await Promise.all([
    assertTargetCanBeWritten(previewAbsolutePath, overwrite),
    assertTargetCanBeWritten(thumbAbsolutePath, overwrite)
  ]);

  const finalPaths = [previewAbsolutePath, thumbAbsolutePath];
  const tempVariants: TempImageVariant[] = [];

  try {
    // Derivatives are rendered to temp files first; final paths appear only after sharp succeeded.
    const preview = await renderWatermarkedPreviewToTemp(originalAbsolutePath, previewAbsolutePath);
    tempVariants.push(preview);

    const thumb = await renderThumbnailToTemp(originalAbsolutePath, thumbAbsolutePath);
    tempVariants.push(thumb);

    await moveTempVariant(preview, overwrite);
    await moveTempVariant(thumb, overwrite);

    const dimensions = await readOriginalImageDimensions(originalAbsolutePath);

    return {
      width: dimensions.width || preview.width,
      height: dimensions.height || preview.height,
      preview: {
        width: preview.width,
        height: preview.height,
        fileSize: preview.fileSize
      },
      thumb: {
        width: thumb.width,
        height: thumb.height,
        fileSize: thumb.fileSize
      }
    };
  } catch (error) {
    await Promise.all(tempVariants.map((variant) => safeUnlink(variant.tempPath)));

    if (!overwrite) {
      await Promise.all(finalPaths.map((finalPath) => safeUnlink(finalPath)));
    }

    throw error;
  }
}
