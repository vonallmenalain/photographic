import { z } from "zod";

export const idSchema = z
  .string()
  .trim()
  .min(1, "Bitte waehle einen Eintrag aus.")
  .max(180, "Die ID ist zu lang.")
  .refine((value) => !value.includes("/"), "IDs duerfen keinen Slash enthalten.");
export const organizationTypeSchema = z.enum(["school", "kindergarten"]);
export const photoTypeSchema = z.enum(["portrait", "sibling", "class", "classMirror", "event"]);
export const photoVisibilitySchema = z.enum(["child", "class", "job"]);

export const createOrganizationSchema = z.object({
  name: z.string().trim().min(1).max(180),
  type: organizationTypeSchema
});

export const createJobSchema = z.object({
  orgId: idSchema,
  title: z.string().trim().min(1).max(180),
  date: z.string().trim().min(1).max(40),
  retentionUntil: z.string().trim().max(40).optional()
});

export const createClassSchema = z.object({
  orgId: idSchema,
  jobId: idSchema,
  name: z.string().trim().min(1).max(120),
  teacherName: z.string().trim().max(120).optional()
});

export const createChildSchema = z.object({
  orgId: idSchema,
  jobId: idSchema,
  classId: idSchema,
  displayName: z.string().trim().min(1, "Bitte gib den Namen des Kindes ein.").max(120)
});

export const createGuardianLinkSchema = z.object({
  email: z.string().trim().email("Bitte gib eine gueltige E-Mail-Adresse ein."),
  orgId: idSchema,
  jobId: idSchema,
  classId: idSchema,
  childId: idSchema
});

export const createChildWithGuardianLinkSchema = createChildSchema.extend({
  email: z.string().trim().email("Bitte gib eine gueltige E-Mail-Adresse ein.")
});

export const uploadPhotoFieldsSchema = z.object({
  orgId: idSchema,
  jobId: idSchema,
  classId: idSchema,
  type: photoTypeSchema,
  visibility: photoVisibilitySchema
});

export const updatePhotoSchema = z
  .object({
    type: photoTypeSchema.optional(),
    visibility: photoVisibilitySchema.optional(),
    classId: idSchema.optional(),
    childIds: z.array(idSchema).optional()
  })
  .strict();

export const mockOrderSchema = z.object({
  jobId: idSchema,
  items: z
    .array(
      z.object({
        photoId: idSchema,
        quantity: z.number().int().positive().max(99).default(1),
        productType: z.string().trim().max(80).optional()
      })
    )
    .min(1)
    .max(100)
});

export const rosterImportSchema = z.object({
  rows: z.array(z.record(z.string(), z.unknown())).min(1).max(1000)
});

export function parseChildIds(value: unknown) {
  if (Array.isArray(value)) {
    return z.array(idSchema).parse(value);
  }

  if (typeof value !== "string") {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return z.array(idSchema).parse(parsed);
  } catch {
    throw new Error("childIds muss ein JSON Array mit gueltigen IDs sein.");
  }
}
