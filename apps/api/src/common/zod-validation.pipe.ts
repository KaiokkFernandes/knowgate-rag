import { BadRequestException, type PipeTransform } from '@nestjs/common';
import type { z } from 'zod';

/**
 * Validates and transforms a request part (body, query, params) with a Zod schema.
 * Returns the parsed value, so transforms in the schema (e.g. lowercasing e-mails) apply.
 * Error responses list paths and messages only, never the submitted values (passwords).
 *
 * Usage: @Body(new ZodValidationPipe(registerRequestSchema)) body: RegisterRequest
 */
export class ZodValidationPipe<TSchema extends z.ZodType> implements PipeTransform<
  unknown,
  z.output<TSchema>
> {
  constructor(private readonly schema: TSchema) {}

  transform(value: unknown): z.output<TSchema> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        message: 'Validation failed',
        issues: result.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }
    return result.data;
  }
}
