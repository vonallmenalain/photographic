import fsp from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function createPreviewWatermarkSvg(width: number, height: number, text = "VORSCHAU") {
  const safeText = escapeXml(text);
  const fontSize = Math.max(54, Math.round(Math.min(width, height) * 0.085));
  const gapX = Math.round(fontSize * 4.1);
  const gapY = Math.round(fontSize * 2.7);
  const fontFamily = "Arial, Helvetica, DejaVu Sans, sans-serif";
  let textNodes = "";

  for (let y = -height; y < height * 2; y += gapY) {
    for (let x = -width; x < width * 2; x += gapX) {
      textNodes += `
        <text
          x="${x}"
          y="${y}"
          font-family="${fontFamily}"
          font-size="${fontSize}"
          font-weight="700"
          text-anchor="middle"
          fill="#ffffff"
          fill-opacity="0.22"
          stroke="#000000"
          stroke-opacity="0.10"
          stroke-width="2"
        >${safeText}</text>`;
    }
  }

  const centerFontSize = Math.round(fontSize * 1.45);

  return Buffer.from(`
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <g transform="rotate(-30 ${width / 2} ${height / 2})">
        ${textNodes}
        <text
          x="${width / 2}"
          y="${height / 2}"
          font-family="${fontFamily}"
          font-size="${centerFontSize}"
          font-weight="800"
          text-anchor="middle"
          dominant-baseline="middle"
          fill="#ffffff"
          fill-opacity="0.16"
          stroke="#000000"
          stroke-opacity="0.08"
          stroke-width="3"
        >${safeText}</text>
      </g>
    </svg>
  `);
}

export async function createWatermarkedPreview(
  originalAbsolutePath: string,
  previewAbsolutePath: string
) {
  await fsp.mkdir(path.dirname(previewAbsolutePath), { recursive: true });

  const resized = await sharp(originalAbsolutePath)
    .rotate()
    .resize({
      width: 1280,
      height: 1280,
      fit: "inside",
      withoutEnlargement: true
    })
    .toColorspace("srgb")
    .raw()
    .toBuffer({ resolveWithObject: true });

  const watermark = createPreviewWatermarkSvg(resized.info.width, resized.info.height);

  await sharp(resized.data, {
    raw: {
      width: resized.info.width,
      height: resized.info.height,
      channels: resized.info.channels
    }
  })
    .composite([{ input: watermark, top: 0, left: 0 }])
    .webp({ quality: 60, effort: 5 })
    .toFile(previewAbsolutePath);
}

export async function generatePreviewAndThumb(
  originalAbsolutePath: string,
  previewAbsolutePath: string,
  thumbAbsolutePath: string
) {
  await createWatermarkedPreview(originalAbsolutePath, previewAbsolutePath);

  await sharp(originalAbsolutePath)
    .rotate()
    .resize({ width: 480, withoutEnlargement: true })
    .webp({ quality: 75 })
    .toFile(thumbAbsolutePath);
}
