import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { FastifyRequest } from 'fastify';
import { JwtPayload } from '../auth.service.js';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: JwtPayload;
  }
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const token = this.extractToken(request);

    if (!token) {
      throw new UnauthorizedException('No authentication token provided');
    }

    try {
      const payload = this.jwtService.verify<JwtPayload>(token);

      /*
       * Fail closed. A token without a tenant claim carries no
       * tenant context, and services build their `where` clause
       * from this value. Prisma omits `undefined` from a filter,
       * so an undefined tenant would silently turn a
       * tenant-scoped query into an unscoped one that returns
       * every tenant's rows.
       */
      if (!payload?.tenantId) {
        throw new UnauthorizedException('Token is missing tenant context');
      }

      request.user = payload;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException('Invalid or expired token');
    }

    /*
     * Tenant isolation: the JWT is the sole authoritative source of
     * tenantId. Any client-supplied tenantId (path param, query string
     * or body field) is a cross-tenant attempt unless it is an exact
     * string match, so any non-string or mismatching value is refused.
     */
    const userTenantId = request.user.tenantId;
    const suppliedTenantIds = [
      (request.params as Record<string, unknown> | undefined)?.tenantId,
      (request.query as Record<string, unknown> | undefined)?.tenantId,
      (request.body as Record<string, unknown> | undefined)?.tenantId,
    ];

    for (const supplied of suppliedTenantIds) {
      /*
       * Only a genuinely absent field is skipped. An explicit
       * null is a supplied value and must be refused, exactly
       * like an empty string or a non-string payload.
       */
      if (supplied === undefined) {
        continue;
      }
      if (typeof supplied !== 'string' || supplied !== userTenantId) {
        throw new ForbiddenException('Tenant mismatch: Cross-tenant access is forbidden');
      }
    }

    return true;
  }

  private extractToken(request: FastifyRequest): string | undefined {
    const authHeader = request.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      return authHeader.substring(7);
    }
    return undefined;
  }
}
