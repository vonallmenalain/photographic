import { z } from 'zod';
import { ApiError } from '../middleware/errorHandler';

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email('Bitte gib eine gültige E-Mail-Adresse ein.')
  .max(254);

export function parse<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const first = result.error.issues[0];
    throw new ApiError(400, first?.message ?? 'Ungültige Eingabe.');
  }
  return result.data;
}
