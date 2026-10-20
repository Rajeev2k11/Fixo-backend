import { z } from 'zod';

// Admin-managed reference data the apps show in pickers (spec §A geography, §K catalogue).

export const citySchema = z.strictObject({ id: z.uuid(), name: z.string() });
export type City = z.infer<typeof citySchema>;

export const areaSchema = z.strictObject({ id: z.uuid(), cityId: z.uuid(), name: z.string() });
export type Area = z.infer<typeof areaSchema>;

export const serviceCategorySchema = z.strictObject({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
});
export type ServiceCategory = z.infer<typeof serviceCategorySchema>;

export const areasQuerySchema = z.strictObject({ cityId: z.uuid() });
export type AreasQuery = z.infer<typeof areasQuerySchema>;

const reason = z.string().trim().min(5, 'Give a reason (at least 5 characters)').max(500);

export const createAreaSchema = z.strictObject({
  cityId: z.uuid(),
  name: z.string().trim().min(2).max(80),
  reason,
});
export type CreateArea = z.infer<typeof createAreaSchema>;

export const createServiceCategorySchema = z.strictObject({
  slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'lower-case words joined by hyphens'),
  name: z.string().trim().min(2).max(80),
  sortOrder: z.int().min(0).max(10_000).optional(),
  reason,
});
export type CreateServiceCategory = z.infer<typeof createServiceCategorySchema>;
