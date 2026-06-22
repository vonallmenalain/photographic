import fsp from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

type Segment = readonly [number, number, number, number];

type Glyph = Readonly<{
  width: number;
  segments: readonly Segment[];
}>;

type Point = {
  x: number;
  y: number;
};

const WATERMARK_GLYPHS: Record<string, Glyph> = {
  V: {
    width: 12,
    segments: [
      [0, 1, 6, 15],
      [6, 15, 12, 1]
    ]
  },
  O: {
    width: 12,
    segments: [
      [2, 1, 10, 1],
      [10, 1, 12, 3],
      [12, 3, 12, 13],
      [12, 13, 10, 15],
      [10, 15, 2, 15],
      [2, 15, 0, 13],
      [0, 13, 0, 3],
      [0, 3, 2, 1]
    ]
  },
  R: {
    width: 12,
    segments: [
      [0, 15, 0, 1],
      [0, 1, 8, 1],
      [8, 1, 12, 4],
      [12, 4, 12, 7],
      [12, 7, 8, 10],
      [8, 10, 0, 10],
      [7, 10, 12, 15]
    ]
  },
  S: {
    width: 12,
    segments: [
      [12, 2, 3, 2],
      [3, 2, 0, 5],
      [0, 5, 3, 8],
      [3, 8, 9, 8],
      [9, 8, 12, 11],
      [12, 11, 9, 14],
      [9, 14, 0, 14]
    ]
  },
  C: {
    width: 12,
    segments: [
      [12, 3, 10, 1],
      [10, 1, 4, 1],
      [4, 1, 0, 5],
      [0, 5, 0, 11],
      [0, 11, 4, 15],
      [4, 15, 10, 15],
      [10, 15, 12, 13]
    ]
  },
  H: {
    width: 12,
    segments: [
      [0, 1, 0, 15],
      [12, 1, 12, 15],
      [0, 8, 12, 8]
    ]
  },
  A: {
    width: 12,
    segments: [
      [0, 15, 6, 1],
      [6, 1, 12, 15],
      [2.5, 10, 9.5, 10]
    ]
  },
  U: {
    width: 12,
    segments: [
      [0, 1, 0, 11],
      [0, 11, 3, 15],
      [3, 15, 9, 15],
      [9, 15, 12, 11],
      [12, 11, 12, 1]
    ]
  }
};

const WATERMARK_TEXT = "VORSCHAU";
const WATERMARK_GAP = 4.4;
const GLYPH_HEIGHT = 16;
const WATERMARK_ANGLE = (-31 * Math.PI) / 180;
const PREVIEW_MAX_SIZE = 1080;

function watermarkWordWidth() {
  return WATERMARK_TEXT.split("").reduce((width, letter, index) => {
    return width + WATERMARK_GLYPHS[letter].width + (index === WATERMARK_TEXT.length - 1 ? 0 : WATERMARK_GAP);
  }, 0);
}

const WATERMARK_WORD_WIDTH = watermarkWordWidth();

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function blendPixel(
  pixels: Buffer,
  width: number,
  height: number,
  x: number,
  y: number,
  color: readonly [number, number, number],
  alpha: number
) {
  const pixelX = Math.round(x);
  const pixelY = Math.round(y);

  if (pixelX < 0 || pixelY < 0 || pixelX >= width || pixelY >= height || alpha <= 0) {
    return;
  }

  const sourceAlpha = clamp(alpha, 0, 1);
  const index = (pixelY * width + pixelX) * 4;
  const targetAlpha = pixels[index + 3] / 255;
  const outputAlpha = sourceAlpha + targetAlpha * (1 - sourceAlpha);

  if (outputAlpha <= 0) {
    return;
  }

  pixels[index] = Math.round((color[0] * sourceAlpha + pixels[index] * targetAlpha * (1 - sourceAlpha)) / outputAlpha);
  pixels[index + 1] = Math.round(
    (color[1] * sourceAlpha + pixels[index + 1] * targetAlpha * (1 - sourceAlpha)) / outputAlpha
  );
  pixels[index + 2] = Math.round(
    (color[2] * sourceAlpha + pixels[index + 2] * targetAlpha * (1 - sourceAlpha)) / outputAlpha
  );
  pixels[index + 3] = Math.round(outputAlpha * 255);
}

function drawLine(
  pixels: Buffer,
  width: number,
  height: number,
  start: Point,
  end: Point,
  thickness: number,
  color: readonly [number, number, number],
  alpha: number
) {
  const radius = thickness / 2;
  const minX = Math.max(0, Math.floor(Math.min(start.x, end.x) - radius - 1));
  const maxX = Math.min(width - 1, Math.ceil(Math.max(start.x, end.x) + radius + 1));
  const minY = Math.max(0, Math.floor(Math.min(start.y, end.y) - radius - 1));
  const maxY = Math.min(height - 1, Math.ceil(Math.max(start.y, end.y) + radius + 1));
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  const lengthSquared = deltaX * deltaX + deltaY * deltaY;

  if (lengthSquared === 0) {
    return;
  }

  for (let pixelY = minY; pixelY <= maxY; pixelY += 1) {
    for (let pixelX = minX; pixelX <= maxX; pixelX += 1) {
      const centerX = pixelX + 0.5;
      const centerY = pixelY + 0.5;
      const segmentPosition = clamp(
        ((centerX - start.x) * deltaX + (centerY - start.y) * deltaY) / lengthSquared,
        0,
        1
      );
      const nearestX = start.x + segmentPosition * deltaX;
      const nearestY = start.y + segmentPosition * deltaY;
      const distance = Math.hypot(centerX - nearestX, centerY - nearestY);

      if (distance <= radius + 0.8) {
        blendPixel(pixels, width, height, pixelX, pixelY, color, alpha * clamp(radius + 0.8 - distance, 0, 1));
      }
    }
  }
}

function transformGlyphPoint(
  x: number,
  y: number,
  offsetX: number,
  centerX: number,
  centerY: number,
  scale: number
) {
  const localX = (offsetX + x - WATERMARK_WORD_WIDTH / 2) * scale;
  const localY = (y - GLYPH_HEIGHT / 2) * scale;
  const cos = Math.cos(WATERMARK_ANGLE);
  const sin = Math.sin(WATERMARK_ANGLE);

  return {
    x: centerX + localX * cos - localY * sin,
    y: centerY + localX * sin + localY * cos
  };
}

function drawWatermarkWord(
  pixels: Buffer,
  width: number,
  height: number,
  centerX: number,
  centerY: number,
  fontSize: number,
  opacity: number
) {
  const scale = fontSize / GLYPH_HEIGHT;
  const strokeWidth = Math.max(4, fontSize * 0.105);
  const shadowOffset = Math.max(1.6, fontSize * 0.022);
  let offsetX = 0;
  const segments: Array<{ start: Point; end: Point }> = [];

  for (const letter of WATERMARK_TEXT) {
    const glyph = WATERMARK_GLYPHS[letter];

    for (const [x1, y1, x2, y2] of glyph.segments) {
      segments.push({
        start: transformGlyphPoint(x1, y1, offsetX, centerX, centerY, scale),
        end: transformGlyphPoint(x2, y2, offsetX, centerX, centerY, scale)
      });
    }

    offsetX += glyph.width + WATERMARK_GAP;
  }

  for (const { start, end } of segments) {
    drawLine(
      pixels,
      width,
      height,
      { x: start.x + shadowOffset, y: start.y + shadowOffset },
      { x: end.x + shadowOffset, y: end.y + shadowOffset },
      strokeWidth * 1.35,
      [0, 0, 0],
      opacity * 0.48
    );
  }

  for (const { start, end } of segments) {
    drawLine(pixels, width, height, start, end, strokeWidth, [255, 255, 255], opacity);
  }
}

function createPreviewWatermarkOverlay(width: number, height: number) {
  const pixels = Buffer.alloc(width * height * 4);
  const baseFontSize = Math.max(58, Math.round(Math.min(width, height) * 0.092));
  const wordWidth = WATERMARK_WORD_WIDTH * (baseFontSize / GLYPH_HEIGHT);
  const gapX = Math.round(wordWidth * 0.78);
  const gapY = Math.round(baseFontSize * 1.45);

  for (let y = -height; y <= height * 2; y += gapY) {
    for (let x = -width; x <= width * 2; x += gapX) {
      drawWatermarkWord(pixels, width, height, x, y, baseFontSize, 0.46);
    }
  }

  drawWatermarkWord(pixels, width, height, width / 2, height / 2, Math.round(baseFontSize * 1.85), 0.68);

  return pixels;
}

export async function createWatermarkedPreview(
  originalAbsolutePath: string,
  previewAbsolutePath: string
) {
  await fsp.mkdir(path.dirname(previewAbsolutePath), { recursive: true });

  const resized = await sharp(originalAbsolutePath)
    .rotate()
    .resize({
      width: PREVIEW_MAX_SIZE,
      height: PREVIEW_MAX_SIZE,
      fit: "inside",
      withoutEnlargement: true
    })
    .toColorspace("srgb")
    .raw()
    .toBuffer({ resolveWithObject: true });

  const watermark = createPreviewWatermarkOverlay(resized.info.width, resized.info.height);

  await sharp(resized.data, {
    raw: {
      width: resized.info.width,
      height: resized.info.height,
      channels: resized.info.channels
    }
  })
    .composite([
      {
        input: watermark,
        raw: { width: resized.info.width, height: resized.info.height, channels: 4 },
        top: 0,
        left: 0
      }
    ])
    .webp({ quality: 52, effort: 5 })
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
