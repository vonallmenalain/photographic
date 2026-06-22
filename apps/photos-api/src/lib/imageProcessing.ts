import fsp from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

type Glyph = {
  width: number;
  paths: string[];
};

const WATERMARK_GLYPHS: Record<string, Glyph> = {
  V: {
    width: 12,
    paths: ["M0 1 L6 15 L12 1"]
  },
  O: {
    width: 12,
    paths: ["M2 1 H10 Q12 1 12 3 V13 Q12 15 10 15 H2 Q0 15 0 13 V3 Q0 1 2 1"]
  },
  R: {
    width: 12,
    paths: ["M0 15 V1 H8 Q12 1 12 5 V6 Q12 10 8 10 H0", "M7 10 L12 15"]
  },
  S: {
    width: 12,
    paths: ["M12 2 H3 Q0 2 0 5 Q0 8 3 8 H9 Q12 8 12 11 Q12 14 9 14 H0"]
  },
  C: {
    width: 12,
    paths: ["M12 3 Q10 1 7 1 H5 Q0 1 0 8 Q0 15 5 15 H7 Q10 15 12 13"]
  },
  H: {
    width: 12,
    paths: ["M0 1 V15", "M12 1 V15", "M0 8 H12"]
  },
  A: {
    width: 12,
    paths: ["M0 15 L6 1 L12 15", "M2.4 10 H9.6"]
  },
  U: {
    width: 12,
    paths: ["M0 1 V11 Q0 15 6 15 Q12 15 12 11 V1"]
  }
};

const WATERMARK_TEXT = "VORSCHAU";
const WATERMARK_GAP = 4;

function watermarkWordWidth() {
  return WATERMARK_TEXT.split("").reduce((width, letter, index) => {
    return width + WATERMARK_GLYPHS[letter].width + (index === WATERMARK_TEXT.length - 1 ? 0 : WATERMARK_GAP);
  }, 0);
}

function watermarkWordPaths() {
  let offset = 0;
  const paths: string[] = [];

  for (const letter of WATERMARK_TEXT) {
    const glyph = WATERMARK_GLYPHS[letter];
    for (const glyphPath of glyph.paths) {
      paths.push(`<path d="${glyphPath}" transform="translate(${offset} 0)" />`);
    }
    offset += glyph.width + WATERMARK_GAP;
  }

  return paths.join("");
}

const WATERMARK_WORD_WIDTH = watermarkWordWidth();
const WATERMARK_WORD_PATHS = watermarkWordPaths();

function watermarkWord(x: number, y: number, fontSize: number, opacity: number) {
  const scale = fontSize / 16;
  const left = x - (WATERMARK_WORD_WIDTH * scale) / 2;
  const top = y - (16 * scale) / 2;

  return `
    <g transform="translate(${left} ${top}) scale(${scale})" fill="none" stroke-linecap="round" stroke-linejoin="round">
      <g transform="translate(0.9 0.9)" stroke="#000000" stroke-opacity="${Math.min(opacity * 0.82, 0.34)}" stroke-width="3.2">
        ${WATERMARK_WORD_PATHS}
      </g>
      <g stroke="#ffffff" stroke-opacity="${opacity}" stroke-width="2.35">
        ${WATERMARK_WORD_PATHS}
      </g>
    </g>
  `;
}

export function createPreviewWatermarkSvg(width: number, height: number) {
  const fontSize = Math.max(48, Math.round(Math.min(width, height) * 0.082));
  const wordWidth = WATERMARK_WORD_WIDTH * (fontSize / 16);
  const gapX = Math.round(wordWidth * 1.32);
  const gapY = Math.round(fontSize * 2.35);
  let wordNodes = "";

  for (let y = -height; y < height * 2; y += gapY) {
    for (let x = -width; x < width * 2; x += gapX) {
      wordNodes += watermarkWord(x, y, fontSize, 0.36);
    }
  }

  const centerFontSize = Math.round(fontSize * 1.72);

  return Buffer.from(`
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${width}" height="${height}" fill="#ffffff" fill-opacity="0.035" />
      <g transform="rotate(-30 ${width / 2} ${height / 2})">
        ${wordNodes}
        ${watermarkWord(width / 2, height / 2, centerFontSize, 0.44)}
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
      width: 1080,
      height: 1080,
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
    .webp({ quality: 54, effort: 5 })
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
