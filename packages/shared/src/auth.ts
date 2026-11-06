import { z } from 'zod';

/** Lowercased and trimmed, so "Ana@Acme.com " and "ana@acme.com" are the same account. */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: 'Invalid e-mail' }).max(254));

/**
 * NIST SP 800-63B: at least 8 characters, no composition rules.
 * The upper bound keeps Argon2 hashing cheap enough to avoid a DoS with huge inputs.
 */
export const passwordSchema = z
  .string()
  .min(8, { error: 'Password must have at least 8 characters' })
  .max(128, { error: 'Password must have at most 128 characters' });

export const registerRequestSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: z.string().trim().min(1).max(100),
});

export const loginRequestSchema = z.object({
  email: emailSchema,
  // No length rules on login: they would only tell an attacker about the policy.
  password: z.string().min(1).max(128),
});

/** Body returned by register, login and refresh. The refresh token goes in an httpOnly cookie. */
export const authResponseSchema = z.object({
  accessToken: z.string(),
  tokenType: z.literal('Bearer'),
  expiresIn: z.number().int().positive(),
});

export type RegisterRequest = z.infer<typeof registerRequestSchema>;
export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type AuthResponse = z.infer<typeof authResponseSchema>;
