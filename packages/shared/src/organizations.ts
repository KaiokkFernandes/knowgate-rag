import { z } from 'zod';
import { emailSchema } from './auth.js';

export const roleSchema = z.enum(['ADMIN', 'MEMBER']);

const nameSchema = z.string().trim().min(1).max(100);

export const createOrganizationRequestSchema = z.object({
  name: nameSchema,
});

/** The user must already have an account (invitation links are a later step). */
export const addMemberRequestSchema = z.object({
  email: emailSchema,
  role: roleSchema.default('MEMBER'),
});

export const updateMemberRoleRequestSchema = z.object({
  role: roleSchema,
});

export const createTeamRequestSchema = z.object({
  name: nameSchema,
});

export type Role = z.infer<typeof roleSchema>;
export type CreateOrganizationRequest = z.infer<typeof createOrganizationRequestSchema>;
export type AddMemberRequest = z.infer<typeof addMemberRequestSchema>;
export type UpdateMemberRoleRequest = z.infer<typeof updateMemberRoleRequestSchema>;
export type CreateTeamRequest = z.infer<typeof createTeamRequestSchema>;
