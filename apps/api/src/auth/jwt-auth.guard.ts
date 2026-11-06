import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { AuthenticatedUser } from './auth.types';
import { IS_PUBLIC_KEY } from './decorators';
import { TokenService } from './token.service';

/**
 * Global guard (registered as APP_GUARD): every route requires a valid access token
 * unless it is marked with @Public(). Forgetting the decorator closes a route, never opens it.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const token = this.extractBearerToken(request);
    if (!token) throw new UnauthorizedException();

    try {
      const payload = await this.tokens.verifyAccessToken(token);
      request.user = { id: payload.sub };
      return true;
    } catch {
      // Same response for expired, malformed or forged tokens.
      throw new UnauthorizedException();
    }
  }

  private extractBearerToken(request: Request): string | undefined {
    const [scheme, token] = request.headers.authorization?.split(' ') ?? [];
    return scheme === 'Bearer' && token ? token : undefined;
  }
}
