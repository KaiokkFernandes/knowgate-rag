import { type ExecutionContext, SetMetadata } from '@nestjs/common';

const AUTH_RATE_LIMIT_KEY = 'authRateLimit';

/** Applies the strict "auth" throttler (login, register) on top of the default one. */
export const AuthRateLimit = () => SetMetadata(AUTH_RATE_LIMIT_KEY, true);

/** The "auth" throttler is skipped on every route that is not marked with @AuthRateLimit(). */
export function isNotAuthRateLimited(context: ExecutionContext): boolean {
  return Reflect.getMetadata(AUTH_RATE_LIMIT_KEY, context.getHandler()) !== true;
}
