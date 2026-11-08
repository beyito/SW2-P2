import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JWTPayload } from 'jose';
import { ISessionRegistry, SESSION_REGISTRY } from '../../ports/outbound/session-registry.port';
import { AuthenticatedUser, IS_PUBLIC, REQUIRED_ROLES, Role } from './auth.decorators';
import { ITokenVerifier, TOKEN_VERIFIER } from './token-verifier';

/**
 * Guard global: exige token válido, sesión vigente y rol suficiente (RF-01, CU-01, CU-02).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(TOKEN_VERIFIER) private readonly verifier: ITokenVerifier,
    @Inject(SESSION_REGISTRY) private readonly sessions: ISessionRegistry,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const claims = await this.verifyToken(request.headers?.authorization);
    const user = this.toUser(claims);
    await this.assertSessionValid(user, Number(claims.auth_time ?? 0));

    const required = this.reflector.getAllAndOverride<Role[]>(REQUIRED_ROLES, targets);
    if (required?.length && !required.some((role) => user.roles.includes(role))) {
      throw new ForbiddenException({ code: 'INSUFFICIENT_ROLE', message: 'Rol insuficiente para esta operación.' });
    }

    request.user = user;
    return true;
  }

  private async verifyToken(header?: string): Promise<JWTPayload> {
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException({ code: 'TOKEN_MISSING', message: 'Token de acceso no proporcionado.' });
    }
    try {
      return await this.verifier.verify(header.slice('Bearer '.length));
    } catch {
      throw new UnauthorizedException({ code: 'TOKEN_INVALID', message: 'Token de acceso inválido o vencido.' });
    }
  }

  private toUser(claims: JWTPayload): AuthenticatedUser {
    const realmAccess = claims.realm_access as { roles?: string[] } | undefined;
    return {
      subject: String(claims.sub),
      id: String(claims.salon_id ?? claims.sub),
      name: String(claims.name ?? claims.preferred_username ?? 'Usuario'),
      roles: realmAccess?.roles ?? [],
      sessionId: claims.sid as string | undefined,
    };
  }

  /** Rechaza sesiones cerradas y aplica sesión única a las cuentas administrativas (ADMIN y RECEPTIONIST): gana el login más reciente. */
  private async assertSessionValid(user: AuthenticatedUser, authTime: number): Promise<void> {
    // Las cuentas de servicio no tienen sesión de usuario
    if (!user.sessionId) return;

    try {
      if (await this.sessions.isRevoked(user.sessionId)) {
        throw new UnauthorizedException({ code: 'SESSION_CLOSED', message: 'La sesión fue cerrada.' });
      }
      const administrative = user.roles.includes('ADMIN') || user.roles.includes('RECEPTIONIST');
      if (administrative && !(await this.holdsActiveSession(user, authTime))) {
        throw new UnauthorizedException({
          code: 'SESSION_SUPERSEDED',
          message: 'Se inició una sesión más reciente en otro dispositivo.',
        });
      }
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException({ code: 'SESSION_UNAVAILABLE', message: 'No se pudo verificar la sesión.' });
    }
  }

  private async holdsActiveSession(user: AuthenticatedUser, authTime: number): Promise<boolean> {
    const active = await this.sessions.findActive(user.subject);
    if (active?.sessionId === user.sessionId) return true;
    if (active && authTime <= active.authTime) return false;
    return this.sessions.claimActive(user.subject, user.sessionId as string, authTime);
  }
}
