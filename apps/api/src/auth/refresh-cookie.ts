import type { CookieOptions, Response } from 'express';
import type { IssuedRefreshToken } from './session.service';

export const REFRESH_COOKIE = 'kg_refresh';

/**
 * httpOnly: page JavaScript cannot read it (limits the damage of an XSS).
 * SameSite=Strict + Path=/auth: never sent on cross-site requests nor to other routes,
 * which also protects /auth/refresh and /auth/logout against CSRF.
 * Secure in production (HTTPS only).
 */
function baseOptions(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/auth',
  };
}

export function setRefreshCookie(res: Response, refresh: IssuedRefreshToken): void {
  res.cookie(REFRESH_COOKIE, refresh.token, { ...baseOptions(), expires: refresh.expiresAt });
}

export function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, baseOptions());
}
