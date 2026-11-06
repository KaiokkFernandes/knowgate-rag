import { z } from 'zod';

/**
 * Status of a single dependency checked by GET /health.
 * Loose object: @nestjs/terminus appends extra fields such as `responseTime`.
 */
export const dependencyStatusSchema = z.looseObject({
  status: z.enum(['up', 'degraded', 'down']),
  message: z.string().optional(),
});

/** Response body of GET /health (shape produced by @nestjs/terminus). */
export const healthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded', 'error', 'shutting_down']),
  info: z.partialRecord(z.string(), dependencyStatusSchema).optional(),
  error: z.partialRecord(z.string(), dependencyStatusSchema).optional(),
  details: z.record(z.string(), dependencyStatusSchema),
});

export type DependencyStatus = z.infer<typeof dependencyStatusSchema>;
export type HealthResponse = z.infer<typeof healthResponseSchema>;
