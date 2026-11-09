import { z } from 'zod';

export const documentVisibilitySchema = z.enum(['ORG', 'TEAMS']);
export const documentSourceTypeSchema = z.enum(['PDF', 'MARKDOWN', 'TXT']);
export const documentStatusSchema = z.enum(['PENDING', 'PROCESSING', 'READY', 'FAILED']);

/** Multipart text fields arrive as a string (one value) or an array (repeated field). */
const stringList = z.preprocess(
  (value: unknown): unknown[] =>
    value === undefined ? [] : Array.isArray(value) ? (value as unknown[]) : [value],
  z.array(z.uuid()).max(50),
);

/**
 * Text fields of the multipart upload (the file itself is validated separately).
 * ORG: every member of the organization; TEAMS: only members of the listed teams.
 */
export const uploadDocumentFieldsSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    visibility: documentVisibilitySchema.default('ORG'),
    teamIds: stringList,
  })
  .transform((fields) => ({ ...fields, teamIds: [...new Set(fields.teamIds)] }))
  .superRefine((fields, ctx) => {
    if (fields.visibility === 'TEAMS' && fields.teamIds.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['teamIds'],
        message: 'TEAMS visibility needs at least one team',
      });
    }
    if (fields.visibility === 'ORG' && fields.teamIds.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['teamIds'],
        message: 'teamIds is only allowed with TEAMS visibility',
      });
    }
  });

export type DocumentVisibility = z.infer<typeof documentVisibilitySchema>;
export type DocumentSourceType = z.infer<typeof documentSourceTypeSchema>;
export type DocumentStatus = z.infer<typeof documentStatusSchema>;
export type UploadDocumentFields = z.infer<typeof uploadDocumentFieldsSchema>;
