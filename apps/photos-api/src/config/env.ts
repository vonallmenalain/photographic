import { z } from "zod";

const numberFromEnv = z.preprocess((value) => {
  if (value === undefined || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : value;
}, z.number().int().positive());

const envSchema = z.object({
  PORT: numberFromEnv.default(8787),
  PHOTO_ROOT: z.string().min(1).default("/data/photos"),
  FIREBASE_SERVICE_ACCOUNT_BASE64: z.string().default(""),
  FIREBASE_PROJECT_ID: z.string().default(""),
  ADMIN_EMAILS: z.string().default(""),
  ACCESS_CODE_PEPPER: z.string().default(""),
  APP_BASE_URL: z.string().url().default("http://localhost:5173"),
  CORS_ORIGINS: z
    .string()
    .default("http://localhost:5173,http://localhost:8888,https://fotos.alae.app")
    .transform((value) =>
      value
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean)
    ),
  MAX_UPLOAD_MB: numberFromEnv.default(150)
});

export const env = envSchema.parse(process.env);
