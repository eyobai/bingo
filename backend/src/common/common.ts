import {
  ArgumentsHost,
  CanActivate,
  Catch,
  ExceptionFilter,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  SetMetadata,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';

// ─── Errors ─────────────────────────────────────────────────────────────────

/** An error the client may show. `code` is stable so the app can switch on it. */
export class AppError extends HttpException {
  constructor(
    status: HttpStatus,
    public readonly code: string,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super({ code, message, details }, status);
  }
}

@Catch()
export class ErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger('Errors');

  catch(err: unknown, host: ArgumentsHost) {
    if (host.getType() !== 'http') return;
    const res = host.switchToHttp().getResponse<Response>();
    const req = host.switchToHttp().getRequest<Request>();
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let body: { code: string; message: string; details?: unknown } = {
      code: 'INTERNAL',
      message: 'Something went wrong. Please try again.',
    };
    if (err instanceof AppError) {
      status = err.getStatus();
      body = { code: err.code, message: err.message, details: err.details };
    } else if (err instanceof HttpException) {
      status = err.getStatus();
      const r = err.getResponse() as any;
      const message = Array.isArray(r?.message) ? r.message.join('; ') : (r?.message ?? err.message);
      body = { code: status === 400 ? 'VALIDATION' : HttpStatus[status] || 'ERROR', message };
    } else {
      this.logger.error(`${req.method} ${req.url}: ${(err as Error)?.stack ?? String(err)}`);
    }
    res.status(status).json({ statusCode: status, ...body });
  }
}

/** JSON can't hold bigint: money leaves the API as a string of santim plus a birr string for display. */
export function money(minor: bigint) {
  const sign = minor < 0n ? '-' : '';
  const abs = minor < 0n ? -minor : minor;
  const birr = abs / 100n;
  const cents = abs % 100n;
  return {
    minor: minor.toString(),
    birr: `${sign}${birr.toString()}${cents ? '.' + cents.toString().padStart(2, '0') : ''}`,
  };
}

export const isUniqueViolation = (e: unknown) =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

// ─── Auth ───────────────────────────────────────────────────────────────────

export interface AuthUser {
  id: string;
  role: 'PLAYER' | 'ADMIN';
}

export const PUBLIC = 'isPublic';
export const ADMIN_ONLY = 'adminOnly';
/** Route needs no sign-in. */
export const Public = () => SetMetadata(PUBLIC, true);
/** Route needs an ADMIN account. */
export const AdminOnly = () => SetMetadata(ADMIN_ONLY, true);

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest<{ user: AuthUser }>().user,
);

/** Every route needs a valid token unless marked @Public(). */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC, targets)) return true;
    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const user = this.verify(token);
    if (!user) throw new AppError(HttpStatus.UNAUTHORIZED, 'UNAUTHORIZED', 'Please open the game from Telegram again.');
    if (this.reflector.getAllAndOverride<boolean>(ADMIN_ONLY, targets) && user.role !== 'ADMIN') {
      throw new AppError(HttpStatus.FORBIDDEN, 'FORBIDDEN', 'Staff only.');
    }
    req.user = user;
    return true;
  }

  verify(token: string): AuthUser | null {
    if (!token) return null;
    try {
      const p = this.jwt.verify<{ sub: string; role: AuthUser['role'] }>(token);
      return { id: p.sub, role: p.role };
    } catch {
      return null;
    }
  }
}
