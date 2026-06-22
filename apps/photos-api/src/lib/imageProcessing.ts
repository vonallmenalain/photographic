import sharp from "sharp";

function previewWatermark() {
  return Buffer.from(`
    <svg width="520" height="86" viewBox="0 0 520 86" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="520" height="86" rx="12" fill="rgba(0,0,0,0.38)"/>
      <text x="260" y="55" text-anchor="middle" font-family="Arial, sans-serif" font-size="30" font-weight="700" fill="rgba(255,255,255,0.82)">Photographic Preview</text>
    </svg>
  `);
}

export async function generatePreviewAndThumb(
  originalAbsolutePath: string,
  previewAbsolutePath: string,
  thumbAbsolutePath: string
) {
  await sharp(originalAbsolutePath)
    .rotate()
    .resize({ width: 1600, withoutEnlargement: true })
    .composite([{ input: previewWatermark(), gravity: "southeast" }])
    .webp({ quality: 80 })
    .toFile(previewAbsolutePath);

  await sharp(originalAbsolutePath)
    .rotate()
    .resize({ width: 480, withoutEnlargement: true })
    .webp({ quality: 75 })
    .toFile(thumbAbsolutePath);
}
